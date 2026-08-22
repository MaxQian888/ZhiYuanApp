package com.zhiyuan.security;

import com.zhiyuan.persistence.AdminEntity;
import com.zhiyuan.persistence.AdminMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.OptionalLong;

/**
 * Second-factor enrolment and verification.
 *
 * <p>Enrolment is deliberately two steps. {@link #beginEnrolment} stores a secret but leaves
 * it switched off; only {@link #confirmEnrolment}, which requires a working code from the
 * authenticator, turns it on. An operator who scans the QR code and then drops their phone
 * down a stairwell is inconvenienced, not locked out of the console.
 *
 * <p>Recovery codes are the way back in when the phone is gone for good. They are hashed
 * like passwords, single-use, and shown exactly once — at confirmation and at regeneration.
 */
@Service
public class MfaService {

    /** Enough that losing a few to a notebook does not matter; few enough to print. */
    public static final int RECOVERY_CODE_COUNT = 10;

    /**
     * The alphabet recovery codes are drawn from.
     *
     * <p>No O/0, I/1 or L: these get read aloud down a phone line during exactly the kind of
     * incident where nobody has patience for "was that a letter or a number".
     */
    private static final String CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private static final int CODE_GROUPS = 3;
    private static final int CODE_GROUP_LENGTH = 4;
    private static final SecureRandom RANDOM = new SecureRandom();

    /** Raised when a submitted code is wrong, expired, or already spent. */
    public static class InvalidMfaCodeException extends RuntimeException {
        public InvalidMfaCodeException(String message) {
            super(message);
        }
    }

    public record Enrolment(String secret, String provisioningUri) {}

    private final AdminMapper admins;
    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;
    private final Clock clock;
    private final String issuer;

    public MfaService(AdminMapper admins, JdbcTemplate jdbc, PasswordEncoder passwordEncoder,
                      Clock clock,
                      @org.springframework.beans.factory.annotation.Value("${zhiyuan.mfa-issuer:ZhiYuan}")
                      String issuer) {
        this.admins = admins;
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.clock = clock;
        this.issuer = issuer;
    }

    /**
     * Generates a secret and returns it with a QR-scannable URI. Does not enable anything.
     *
     * <p>Calling this again before confirming replaces the pending secret, which is what an
     * operator who lost their phone mid-enrolment needs to happen.
     */
    public Enrolment beginEnrolment(AdminEntity admin) {
        if (admin.mfaRequired()) {
            throw new IllegalStateException("Second factor is already enabled for this account");
        }
        String secret = Totp.newSecret();
        admins.stageMfaSecret(admin.getId(), secret);
        return new Enrolment(secret, Totp.provisioningUri(issuer, admin.getUsername(), secret));
    }

    /**
     * Turns the second factor on, having proved the authenticator works.
     *
     * @return the recovery codes, in plaintext. This is the only time they exist in that form.
     */
    @Transactional
    public List<String> confirmEnrolment(AdminEntity admin, String code) {
        String secret = admin.getMfaSecret();
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException("Start enrolment before confirming it");
        }
        if (admin.mfaRequired()) {
            throw new IllegalStateException("Second factor is already enabled for this account");
        }
        acceptTotp(admin, secret, code);
        admins.updateMfaEnabled(admin.getId(), true);
        return replaceRecoveryCodes(admin.getId());
    }

    /**
     * Checks a code at sign-in. Accepts a TOTP code or an unused recovery code.
     *
     * <p>Both are tried because the operator using this has already lost access to one of
     * them, and asking them to say which is a needless step in front of someone who is
     * probably having a bad day.
     *
     * @return true when a recovery code was spent, so the caller can warn about the balance
     */
    @Transactional
    public boolean verify(AdminEntity admin, String code) {
        if (!admin.mfaRequired()) {
            throw new IllegalStateException("Second factor is not enabled for this account");
        }
        if (code == null || code.isBlank()) throw new InvalidMfaCodeException("Code is required");
        OptionalLong step = Totp.matchingStep(admin.getMfaSecret(), code, clock.instant());
        if (step.isPresent()) {
            advance(admin, step.getAsLong());
            return false;
        }
        if (spendRecoveryCode(admin.getId(), code)) return true;
        throw new InvalidMfaCodeException("Invalid or expired verification code");
    }

    /** How many recovery codes remain unused. */
    public int remainingRecoveryCodes(long adminId) {
        Integer count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM mfa_recovery_codes WHERE admin_id = ? AND used_at IS NULL",
            Integer.class, adminId);
        return count == null ? 0 : count;
    }

    /** Issues a fresh set, invalidating every previous one. */
    @Transactional
    public List<String> regenerateRecoveryCodes(AdminEntity admin) {
        if (!admin.mfaRequired()) {
            throw new IllegalStateException("Second factor is not enabled for this account");
        }
        return replaceRecoveryCodes(admin.getId());
    }

    /** Removes the second factor entirely, along with its recovery codes. */
    @Transactional
    public void disable(long adminId) {
        admins.clearMfa(adminId);
        jdbc.update("DELETE FROM mfa_recovery_codes WHERE admin_id = ?", adminId);
    }

    private void acceptTotp(AdminEntity admin, String secret, String code) {
        OptionalLong step = Totp.matchingStep(secret, code, clock.instant());
        if (step.isEmpty()) throw new InvalidMfaCodeException("Invalid or expired verification code");
        advance(admin, step.getAsLong());
    }

    /**
     * Records the step, refusing a code that has already been used.
     *
     * <p>The guard is a conditional UPDATE rather than a read-then-write, so two instances
     * racing on the same code cannot both see "not used yet".
     */
    private void advance(AdminEntity admin, long step) {
        if (admins.advanceMfaStep(admin.getId(), step) == 0) {
            throw new InvalidMfaCodeException("This code has already been used");
        }
        admin.setMfaLastStep(step);
    }

    private boolean spendRecoveryCode(long adminId, String submitted) {
        String normalised = normalise(submitted);
        if (normalised.isEmpty()) return false;
        List<Map<String, Object>> candidates = jdbc.queryForList(
            "SELECT id, code_hash FROM mfa_recovery_codes WHERE admin_id = ? AND used_at IS NULL",
            adminId);
        for (Map<String, Object> row : candidates) {
            if (!passwordEncoder.matches(normalised, (String) row.get("code_hash"))) continue;
            long id = ((Number) row.get("id")).longValue();
            // Conditional so a code cannot be spent twice by two concurrent requests.
            int spent = jdbc.update(
                "UPDATE mfa_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL",
                Timestamp.from(clock.instant()), id);
            return spent == 1;
        }
        return false;
    }

    private List<String> replaceRecoveryCodes(long adminId) {
        jdbc.update("DELETE FROM mfa_recovery_codes WHERE admin_id = ?", adminId);
        List<String> codes = new ArrayList<>();
        for (int index = 0; index < RECOVERY_CODE_COUNT; index++) {
            String code = newRecoveryCode();
            codes.add(code);
            jdbc.update(
                "INSERT INTO mfa_recovery_codes (admin_id, code_hash, created_at) VALUES (?, ?, ?)",
                adminId, passwordEncoder.encode(normalise(code)), Timestamp.from(clock.instant()));
        }
        return codes;
    }

    private static String newRecoveryCode() {
        StringBuilder code = new StringBuilder();
        for (int group = 0; group < CODE_GROUPS; group++) {
            if (group > 0) code.append('-');
            for (int index = 0; index < CODE_GROUP_LENGTH; index++) {
                code.append(CODE_ALPHABET.charAt(RANDOM.nextInt(CODE_ALPHABET.length())));
            }
        }
        return code.toString();
    }

    /** Strips the formatting a human will inevitably get wrong: case, dashes, spaces. */
    private static String normalise(String code) {
        return code == null ? "" : code.replaceAll("[\\s-]", "").toUpperCase(java.util.Locale.ROOT);
    }
}
