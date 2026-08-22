package com.zhiyuan.security;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.OptionalLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * TOTP is checked against RFC 6238's published vectors rather than against itself.
 *
 * <p>That distinction matters: an implementation can be perfectly self-consistent and still
 * produce codes no authenticator app agrees with, and the symptom is an operator who cannot
 * log in with a phone that looks correct.
 */
class TotpTest {

    /** RFC 6238 Appendix B uses the ASCII seed "12345678901234567890" for SHA-1. */
    private static final String RFC_SECRET =
        Totp.base32Encode("12345678901234567890".getBytes(StandardCharsets.US_ASCII));

    @Test
    void producesTheCodesRfc6238Publishes() {
        // The RFC lists 8-digit values; a 6-digit authenticator shows the last six.
        assertThat(Totp.codeAt(RFC_SECRET, Totp.stepAt(Instant.ofEpochSecond(59))))
            .isEqualTo("287082");
        assertThat(Totp.codeAt(RFC_SECRET, Totp.stepAt(Instant.ofEpochSecond(1111111109))))
            .isEqualTo("081804");
        assertThat(Totp.codeAt(RFC_SECRET, Totp.stepAt(Instant.ofEpochSecond(1111111111))))
            .isEqualTo("050471");
        assertThat(Totp.codeAt(RFC_SECRET, Totp.stepAt(Instant.ofEpochSecond(1234567890))))
            .isEqualTo("005924");
        assertThat(Totp.codeAt(RFC_SECRET, Totp.stepAt(Instant.ofEpochSecond(2000000000))))
            .isEqualTo("279037");
    }

    @Test
    void countsThirtySecondStepsFromTheEpoch() {
        assertThat(Totp.stepAt(Instant.ofEpochSecond(0))).isEqualTo(0);
        assertThat(Totp.stepAt(Instant.ofEpochSecond(29))).isEqualTo(0);
        assertThat(Totp.stepAt(Instant.ofEpochSecond(30))).isEqualTo(1);
        assertThat(Totp.stepAt(Instant.ofEpochSecond(59))).isEqualTo(1);
    }

    @Test
    void alwaysReturnsSixDigits() {
        // A code that renders as "5924" instead of "005924" fails against every app.
        String secret = Totp.newSecret();
        for (long step = 0; step < 500; step++) {
            assertThat(Totp.codeAt(secret, step)).hasSize(6).containsOnlyDigits();
        }
    }

    @Test
    void acceptsTheCurrentCodeAndReportsWhichStepItCameFrom() {
        Instant now = Instant.ofEpochSecond(1_700_000_000L);
        String secret = Totp.newSecret();
        String code = Totp.codeAt(secret, Totp.stepAt(now));

        OptionalLong step = Totp.matchingStep(secret, code, now);

        assertThat(step).hasValue(Totp.stepAt(now));
    }

    @Test
    void toleratesOneStepOfClockDriftInEitherDirection() {
        Instant now = Instant.ofEpochSecond(1_700_000_000L);
        String secret = Totp.newSecret();
        long current = Totp.stepAt(now);

        assertThat(Totp.matchingStep(secret, Totp.codeAt(secret, current - 1), now))
            .hasValue(current - 1);
        assertThat(Totp.matchingStep(secret, Totp.codeAt(secret, current + 1), now))
            .hasValue(current + 1);
    }

    @Test
    void refusesACodeTwoStepsAway() {
        // Beyond 90 seconds a code is stale, and widening the window buys nothing but risk.
        Instant now = Instant.ofEpochSecond(1_700_000_000L);
        String secret = Totp.newSecret();
        long current = Totp.stepAt(now);

        assertThat(Totp.matchingStep(secret, Totp.codeAt(secret, current - 2), now)).isEmpty();
        assertThat(Totp.matchingStep(secret, Totp.codeAt(secret, current + 2), now)).isEmpty();
    }

    @Test
    void refusesCodesOfTheWrongShapeWithoutComputingAnything() {
        Instant now = Instant.now();
        String secret = Totp.newSecret();

        assertThat(Totp.matchingStep(secret, "12345", now)).isEmpty();
        assertThat(Totp.matchingStep(secret, "1234567", now)).isEmpty();
        assertThat(Totp.matchingStep(secret, "", now)).isEmpty();
        assertThat(Totp.matchingStep(secret, null, now)).isEmpty();
        assertThat(Totp.matchingStep(null, "123456", now)).isEmpty();
    }

    @Test
    void ignoresSurroundingWhitespaceBecausePeopleCopyAndPasteCodes() {
        Instant now = Instant.ofEpochSecond(1_700_000_000L);
        String secret = Totp.newSecret();
        String code = Totp.codeAt(secret, Totp.stepAt(now));

        assertThat(Totp.matchingStep(secret, "  " + code + " ", now)).isPresent();
    }

    @Test
    void generatesSecretsThatDifferAndDecodeToTheRecommendedLength() {
        String first = Totp.newSecret();
        String second = Totp.newSecret();

        assertThat(first).isNotEqualTo(second);
        assertThat(Totp.base32Decode(first)).hasSize(20);
    }

    @Test
    void roundTripsArbitraryBytesThroughBase32() {
        // Every unpadded length matters: the tail handling is where Base32 goes wrong.
        for (int length = 1; length <= 24; length++) {
            byte[] data = new byte[length];
            for (int index = 0; index < length; index++) data[index] = (byte) (index * 7 + 1);
            assertThat(Totp.base32Decode(Totp.base32Encode(data))).startsWith(data);
        }
    }

    @Test
    void acceptsSecretsThatWereRetypedByHand() {
        byte[] data = "12345678901234567890".getBytes(StandardCharsets.US_ASCII);
        String encoded = Totp.base32Encode(data);

        assertThat(Totp.base32Decode(encoded.toLowerCase())).isEqualTo(data);
        assertThat(Totp.base32Decode(encoded + "==")).isEqualTo(data);
    }

    @Test
    void rejectsASecretThatIsNotBase32() {
        assertThatThrownBy(() -> Totp.base32Decode("not-base-32!"))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void buildsAProvisioningUriAnAuthenticatorCanScan() {
        String uri = Totp.provisioningUri("智鸢运营平台", "admin", "JBSWY3DPEHPK3PXP");

        assertThat(uri).startsWith("otpauth://totp/");
        assertThat(uri).contains("secret=JBSWY3DPEHPK3PXP");
        assertThat(uri).contains("algorithm=SHA1", "digits=6", "period=30");
        // The issuer appears in the label and as a parameter; apps read one or the other.
        assertThat(uri).contains("issuer=");
        assertThat(uri).doesNotContain(" ");
    }
}
