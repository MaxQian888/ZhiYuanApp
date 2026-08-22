package com.zhiyuan.security;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Locale;

/**
 * Time-based one-time passwords, RFC 6238.
 *
 * <p>Written out rather than pulled in as a dependency. The algorithm is eighty lines and
 * fully specified, and the RFC publishes test vectors — so the correctness of this file is
 * something the test suite can actually establish, which is more than can be said for a
 * transitive library we would then have to keep audited. The Base32 codec below exists for
 * the same reason: it is the only part of the format authenticator apps care about.
 *
 * <p>All three parameters are fixed at the values every authenticator app assumes: SHA-1,
 * six digits, thirty-second steps. They are not configurable because a mismatch produces
 * codes that are wrong in a way nobody can debug from the phone's side.
 */
public final class Totp {

    /** The window each code is valid for. */
    public static final Duration STEP = Duration.ofSeconds(30);

    /**
     * How many steps either side of "now" are accepted.
     *
     * <p>One step, so a code stays usable for at most 90 seconds. That covers a phone whose
     * clock has drifted a little and an operator who types slowly; widening it further trades
     * real security for convenience nobody asked for.
     */
    public static final int DRIFT_STEPS = 1;

    private static final int DIGITS = 6;
    private static final String ALGORITHM = "HmacSHA1";
    private static final String BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    private static final SecureRandom RANDOM = new SecureRandom();

    private Totp() {}

    /** A fresh 160-bit secret, Base32-encoded — the size RFC 4226 recommends for SHA-1. */
    public static String newSecret() {
        byte[] bytes = new byte[20];
        RANDOM.nextBytes(bytes);
        return base32Encode(bytes);
    }

    /** The time step a given instant falls in. This is what gets stored to prevent replay. */
    public static long stepAt(Instant when) {
        return Math.floorDiv(when.getEpochSecond(), STEP.getSeconds());
    }

    /** The six-digit code for one specific step. */
    public static String codeAt(String secret, long step) {
        byte[] key = base32Decode(secret);
        byte[] counter = ByteBuffer.allocate(8).putLong(step).array();
        byte[] digest;
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(key, ALGORITHM));
            digest = mac.doFinal(counter);
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("HMAC-SHA1 is required by the platform", failure);
        }
        int offset = digest[digest.length - 1] & 0x0f;
        int binary = ((digest[offset] & 0x7f) << 24)
            | ((digest[offset + 1] & 0xff) << 16)
            | ((digest[offset + 2] & 0xff) << 8)
            | (digest[offset + 3] & 0xff);
        int code = binary % 1_000_000;
        return String.format(Locale.ROOT, "%0" + DIGITS + "d", code);
    }

    /**
     * The step a submitted code belongs to, or empty if it matches none of the accepted steps.
     *
     * <p>Returns the step rather than a boolean so the caller can record it and refuse the
     * same code a second time. A one-time password that can be used twice is not one.
     */
    public static java.util.OptionalLong matchingStep(String secret, String code, Instant when) {
        if (secret == null || code == null) return java.util.OptionalLong.empty();
        String submitted = code.trim();
        if (submitted.length() != DIGITS) return java.util.OptionalLong.empty();
        long current = stepAt(when);
        for (long step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step++) {
            if (constantTimeEquals(codeAt(secret, step), submitted)) {
                return java.util.OptionalLong.of(step);
            }
        }
        return java.util.OptionalLong.empty();
    }

    /**
     * The `otpauth://` URI an authenticator app scans.
     *
     * <p>The issuer appears twice — once as a label prefix and once as a parameter — because
     * older apps read one and newer apps read the other, and an entry that says only
     * "admin" is useless on a phone with three work accounts on it.
     */
    public static String provisioningUri(String issuer, String account, String secret) {
        return "otpauth://totp/" + encode(issuer) + ":" + encode(account)
            + "?secret=" + secret
            + "&issuer=" + encode(issuer)
            + "&algorithm=SHA1&digits=" + DIGITS + "&period=" + STEP.getSeconds();
    }

    private static String encode(String value) {
        return java.net.URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }

    /**
     * Compares without leaking where the mismatch was.
     *
     * <p>With six digits and a 90-second window a timing attack is not the realistic threat,
     * but the cost here is one loop and the alternative is explaining why a secret comparison
     * short-circuits.
     */
    private static boolean constantTimeEquals(String left, String right) {
        if (left.length() != right.length()) return false;
        int difference = 0;
        for (int index = 0; index < left.length(); index++) {
            difference |= left.charAt(index) ^ right.charAt(index);
        }
        return difference == 0;
    }

    static String base32Encode(byte[] data) {
        StringBuilder out = new StringBuilder();
        int buffer = 0;
        int bits = 0;
        for (byte value : data) {
            buffer = (buffer << 8) | (value & 0xff);
            bits += 8;
            while (bits >= 5) {
                out.append(BASE32_ALPHABET.charAt((buffer >> (bits - 5)) & 0x1f));
                bits -= 5;
            }
        }
        if (bits > 0) out.append(BASE32_ALPHABET.charAt((buffer << (5 - bits)) & 0x1f));
        return out.toString();
    }

    static byte[] base32Decode(String encoded) {
        // Padding and case are stripped: users retype these secrets by hand, and rejecting
        // "abc def=" when "ABCDEF" would have worked is a support ticket, not a defence.
        String cleaned = encoded.replace("=", "").replace(" ", "").toUpperCase(Locale.ROOT);
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        int buffer = 0;
        int bits = 0;
        for (char symbol : cleaned.toCharArray()) {
            int value = BASE32_ALPHABET.indexOf(symbol);
            if (value < 0) throw new IllegalArgumentException("Not a Base32 secret");
            buffer = (buffer << 5) | value;
            bits += 5;
            if (bits >= 8) {
                out.write((buffer >> (bits - 8)) & 0xff);
                bits -= 8;
            }
        }
        return out.toByteArray();
    }
}
