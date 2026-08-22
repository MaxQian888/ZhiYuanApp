package com.zhiyuan.security;

import com.zhiyuan.persistence.AdminEntity;
import com.zhiyuan.persistence.AdminMapper;
import com.zhiyuan.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Enrolment, verification, replay and recovery, against the real tables. */
@SpringBootTest
class MfaServiceTest {

    @Autowired AdminMapper admins;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwordEncoder;

    private static final AtomicInteger SEQUENCE = new AtomicInteger();

    private final MutableClock clock = new MutableClock(Instant.parse("2026-08-22T09:00:00Z"));
    private MfaService mfa;

    @BeforeEach
    void setUp() {
        mfa = new MfaService(admins, jdbc, passwordEncoder, clock, "ZhiYuan");
    }

    /** A fresh account each time: the suite shares one database across test classes. */
    private AdminEntity newAdmin() {
        int index = SEQUENCE.incrementAndGet();
        AdminEntity admin = new AdminEntity();
        admin.setUsername("mfa-user-" + index);
        admin.setPasswordHash(passwordEncoder.encode("password-" + index));
        admin.setDisplayName("MFA Tester " + index);
        admin.setRole("manager");
        admin.setPhone("139" + String.format("%08d", 40_000_000 + index));
        admin.setEnabled(true);
        admins.insert(admin);
        return admins.findById(admin.getId());
    }

    private AdminEntity enrolled(AdminEntity admin) {
        MfaService.Enrolment enrolment = mfa.beginEnrolment(admin);
        AdminEntity staged = admins.findById(admin.getId());
        mfa.confirmEnrolment(staged, Totp.codeAt(enrolment.secret(), Totp.stepAt(clock.instant())));
        clock.advance(Totp.STEP);
        return admins.findById(admin.getId());
    }

    private String currentCode(AdminEntity admin) {
        return Totp.codeAt(admin.getMfaSecret(), Totp.stepAt(clock.instant()));
    }

    @Test
    void enrolmentStoresASecretWithoutTurningTheFactorOn() {
        // An operator who scans the code and then loses their phone before confirming must
        // not be locked out of an account that never actually gained a second factor.
        AdminEntity admin = newAdmin();

        MfaService.Enrolment enrolment = mfa.beginEnrolment(admin);

        AdminEntity stored = admins.findById(admin.getId());
        assertThat(stored.getMfaSecret()).isEqualTo(enrolment.secret());
        assertThat(stored.mfaRequired()).isFalse();
        assertThat(enrolment.provisioningUri()).contains("otpauth://totp/", enrolment.secret());
    }

    @Test
    void restartingEnrolmentReplacesThePendingSecret() {
        AdminEntity admin = newAdmin();
        String first = mfa.beginEnrolment(admin).secret();

        String second = mfa.beginEnrolment(admins.findById(admin.getId())).secret();

        assertThat(second).isNotEqualTo(first);
        assertThat(admins.findById(admin.getId()).getMfaSecret()).isEqualTo(second);
    }

    @Test
    void confirmationRequiresAWorkingCodeAndThenIssuesRecoveryCodes() {
        AdminEntity admin = newAdmin();
        MfaService.Enrolment enrolment = mfa.beginEnrolment(admin);
        AdminEntity staged = admins.findById(admin.getId());

        List<String> codes = mfa.confirmEnrolment(staged,
            Totp.codeAt(enrolment.secret(), Totp.stepAt(clock.instant())));

        assertThat(codes).hasSize(MfaService.RECOVERY_CODE_COUNT).doesNotHaveDuplicates();
        assertThat(admins.findById(admin.getId()).mfaRequired()).isTrue();
        assertThat(mfa.remainingRecoveryCodes(admin.getId()))
            .isEqualTo(MfaService.RECOVERY_CODE_COUNT);
    }

    @Test
    void confirmationWithAWrongCodeLeavesTheFactorOff() {
        AdminEntity admin = newAdmin();
        mfa.beginEnrolment(admin);
        AdminEntity staged = admins.findById(admin.getId());

        assertThatThrownBy(() -> mfa.confirmEnrolment(staged, "000000"))
            .isInstanceOf(MfaService.InvalidMfaCodeException.class);

        assertThat(admins.findById(admin.getId()).mfaRequired()).isFalse();
    }

    @Test
    void confirmingWithoutStartingIsRefused() {
        AdminEntity admin = newAdmin();

        assertThatThrownBy(() -> mfa.confirmEnrolment(admin, "123456"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Start enrolment");
    }

    @Test
    void enrollingTwiceIsRefusedRatherThanSilentlyResettingTheSecret() {
        AdminEntity admin = enrolled(newAdmin());

        assertThatThrownBy(() -> mfa.beginEnrolment(admin))
            .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void acceptsTheCurrentCode() {
        AdminEntity admin = enrolled(newAdmin());

        assertThat(mfa.verify(admin, currentCode(admin))).isFalse();
    }

    @Test
    void refusesTheSameCodeASecondTime() {
        // A one-time password that works twice is not one: anyone who sees a code over a
        // shoulder or in a proxy log otherwise has the whole window to replay it.
        AdminEntity admin = enrolled(newAdmin());
        String code = currentCode(admin);
        mfa.verify(admin, code);

        assertThatThrownBy(() -> mfa.verify(admins.findById(admin.getId()), code))
            .isInstanceOf(MfaService.InvalidMfaCodeException.class)
            .hasMessageContaining("already been used");
    }

    @Test
    void refusesACodeFromAnEarlierStepThanOneAlreadySpent() {
        AdminEntity admin = enrolled(newAdmin());
        long step = Totp.stepAt(clock.instant());
        mfa.verify(admin, Totp.codeAt(admin.getMfaSecret(), step));

        // The previous step is still inside the drift window, but it is behind the guard.
        assertThatThrownBy(() -> mfa.verify(admins.findById(admin.getId()),
            Totp.codeAt(admin.getMfaSecret(), step - 1)))
            .isInstanceOf(MfaService.InvalidMfaCodeException.class);
    }

    @Test
    void acceptsTheNextCodeOnceTheClockMovesOn() {
        AdminEntity admin = enrolled(newAdmin());
        mfa.verify(admin, currentCode(admin));

        clock.advance(Totp.STEP);
        AdminEntity reloaded = admins.findById(admin.getId());

        assertThat(mfa.verify(reloaded, currentCode(reloaded))).isFalse();
    }

    @Test
    void refusesAnEmptyOrMissingCodeWithoutTouchingTheGuard() {
        AdminEntity admin = enrolled(newAdmin());
        // Confirmation itself spends a step — that code cannot be replayed either — so the
        // guard already holds a value. A rejected submission must not move it.
        Long before = admins.findById(admin.getId()).getMfaLastStep();
        assertThat(before).isNotNull();

        assertThatThrownBy(() -> mfa.verify(admin, "  "))
            .isInstanceOf(MfaService.InvalidMfaCodeException.class);

        assertThat(admins.findById(admin.getId()).getMfaLastStep()).isEqualTo(before);
    }

    @Test
    void verifyingAnAccountWithoutTheFactorIsAProgrammingErrorNotABadCode() {
        AdminEntity admin = newAdmin();

        assertThatThrownBy(() -> mfa.verify(admin, "123456"))
            .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void acceptsARecoveryCodeWhenTheAuthenticatorIsGone() {
        AdminEntity admin = newAdmin();
        MfaService.Enrolment enrolment = mfa.beginEnrolment(admin);
        List<String> codes = mfa.confirmEnrolment(admins.findById(admin.getId()),
            Totp.codeAt(enrolment.secret(), Totp.stepAt(clock.instant())));
        AdminEntity reloaded = admins.findById(admin.getId());

        assertThat(mfa.verify(reloaded, codes.get(0))).isTrue();
        assertThat(mfa.remainingRecoveryCodes(admin.getId()))
            .isEqualTo(MfaService.RECOVERY_CODE_COUNT - 1);
    }

    @Test
    void spendsEachRecoveryCodeOnlyOnce() {
        AdminEntity admin = newAdmin();
        MfaService.Enrolment enrolment = mfa.beginEnrolment(admin);
        List<String> codes = mfa.confirmEnrolment(admins.findById(admin.getId()),
            Totp.codeAt(enrolment.secret(), Totp.stepAt(clock.instant())));
        AdminEntity reloaded = admins.findById(admin.getId());
        mfa.verify(reloaded, codes.get(0));

        assertThatThrownBy(() -> mfa.verify(reloaded, codes.get(0)))
            .isInstanceOf(MfaService.InvalidMfaCodeException.class);
    }

    @Test
    void acceptsARecoveryCodeHoweverTheOperatorRetypesIt() {
        // These get read down a phone line during an incident. Case and dashes are noise.
        AdminEntity admin = newAdmin();
        MfaService.Enrolment enrolment = mfa.beginEnrolment(admin);
        List<String> codes = mfa.confirmEnrolment(admins.findById(admin.getId()),
            Totp.codeAt(enrolment.secret(), Totp.stepAt(clock.instant())));

        String messy = " " + codes.get(1).toLowerCase().replace("-", " ") + " ";

        assertThat(mfa.verify(admins.findById(admin.getId()), messy)).isTrue();
    }

    @Test
    void storesRecoveryCodesHashedSoTheTableIsNotAListOfCredentials() {
        AdminEntity admin = newAdmin();
        MfaService.Enrolment enrolment = mfa.beginEnrolment(admin);
        List<String> codes = mfa.confirmEnrolment(admins.findById(admin.getId()),
            Totp.codeAt(enrolment.secret(), Totp.stepAt(clock.instant())));

        List<String> stored = jdbc.queryForList(
            "SELECT code_hash FROM mfa_recovery_codes WHERE admin_id = ?", String.class,
            admin.getId());

        assertThat(stored).noneMatch(hash -> codes.contains(hash));
        assertThat(stored).allMatch(hash -> hash.startsWith("$2"));
    }

    @Test
    void regenerationInvalidatesEveryPreviousCode() {
        AdminEntity admin = newAdmin();
        MfaService.Enrolment enrolment = mfa.beginEnrolment(admin);
        List<String> original = mfa.confirmEnrolment(admins.findById(admin.getId()),
            Totp.codeAt(enrolment.secret(), Totp.stepAt(clock.instant())));
        AdminEntity reloaded = admins.findById(admin.getId());

        List<String> replacement = mfa.regenerateRecoveryCodes(reloaded);

        assertThat(replacement).hasSize(MfaService.RECOVERY_CODE_COUNT)
            .doesNotContainAnyElementsOf(original);
        assertThatThrownBy(() -> mfa.verify(reloaded, original.get(0)))
            .isInstanceOf(MfaService.InvalidMfaCodeException.class);
    }

    @Test
    void disablingRemovesTheSecretAndEveryRecoveryCode() {
        AdminEntity admin = enrolled(newAdmin());

        mfa.disable(admin.getId());

        AdminEntity cleared = admins.findById(admin.getId());
        assertThat(cleared.mfaRequired()).isFalse();
        assertThat(cleared.getMfaSecret()).isNull();
        assertThat(mfa.remainingRecoveryCodes(admin.getId())).isZero();
    }

    @Test
    void aSpentRecoveryCodeIsKeptRatherThanDeleted() {
        // "Already spent" and "never existed" are different answers, and during an incident
        // the difference tells you whether someone else got there first.
        AdminEntity admin = newAdmin();
        MfaService.Enrolment enrolment = mfa.beginEnrolment(admin);
        List<String> codes = mfa.confirmEnrolment(admins.findById(admin.getId()),
            Totp.codeAt(enrolment.secret(), Totp.stepAt(clock.instant())));
        mfa.verify(admins.findById(admin.getId()), codes.get(0));

        Integer used = jdbc.queryForObject(
            "SELECT COUNT(*) FROM mfa_recovery_codes WHERE admin_id = ? AND used_at IS NOT NULL",
            Integer.class, admin.getId());

        assertThat(used).isEqualTo(1);
    }

    @Test
    void recoveryCodesAvoidCharactersThatGetMisreadAloud() {
        AdminEntity admin = newAdmin();
        MfaService.Enrolment enrolment = mfa.beginEnrolment(admin);

        List<String> codes = mfa.confirmEnrolment(admins.findById(admin.getId()),
            Totp.codeAt(enrolment.secret(), Totp.stepAt(clock.instant())));

        assertThat(codes).allSatisfy(code -> {
            assertThat(code).matches("[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}");
            assertThat(code).doesNotContain("O", "I", "L");
        });
    }

    @Test
    void aDeadlineDoesNotStopAnEnrolmentThatSpansAStepBoundary() {
        AdminEntity admin = newAdmin();
        MfaService.Enrolment enrolment = mfa.beginEnrolment(admin);
        String code = Totp.codeAt(enrolment.secret(), Totp.stepAt(clock.instant()));

        // The operator takes twenty seconds to type it; still inside the drift window.
        clock.advance(Duration.ofSeconds(20));

        assertThat(mfa.confirmEnrolment(admins.findById(admin.getId()), code)).isNotEmpty();
    }
}
