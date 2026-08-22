package com.zhiyuan.security;

import com.zhiyuan.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The sign-in rate limit, against the real table.
 *
 * <p>Exercised through a hand-moved clock rather than real waiting: the window is fifteen
 * minutes, and the only alternative is a suite that either sleeps or lies.
 */
@SpringBootTest
class LoginThrottleTest {

    @Autowired JdbcTemplate jdbc;

    private final MutableClock clock = new MutableClock(Instant.parse("2026-08-22T09:00:00Z"));
    private LoginThrottle throttle;

    @BeforeEach
    void setUp() {
        throttle = new LoginThrottle(jdbc, clock);
        jdbc.update("DELETE FROM login_attempts");
    }

    private void fail(String username, String ip, int times) {
        for (int index = 0; index < times; index++) throttle.recordFailure(username, ip);
    }

    @Test
    void allowsAnAccountThatHasNeverFailed() {
        assertThat(throttle.lockout("admin", "10.0.0.1")).isEmpty();
    }

    @Test
    void allowsAttemptsRightUpToTheLimit() {
        fail("admin", "10.0.0.1", LoginThrottle.MAX_FAILURES - 1);

        assertThat(throttle.lockout("admin", "10.0.0.1")).isEmpty();
    }

    @Test
    void locksOutOnTheFifthFailure() {
        fail("admin", "10.0.0.1", LoginThrottle.MAX_FAILURES);

        assertThat(throttle.lockout("admin", "10.0.0.1")).isPresent();
        assertThatThrownBy(() -> throttle.requireAllowed("admin", "10.0.0.1"))
            .isInstanceOf(LoginThrottle.LockedOutException.class)
            .hasMessageContaining("Try again in");
    }

    @Test
    void reportsHowLongIsLeftSoTheCallerCanSendRetryAfter() {
        fail("admin", "10.0.0.1", LoginThrottle.MAX_FAILURES);
        clock.advance(Duration.ofMinutes(5));

        Duration remaining = throttle.lockout("admin", "10.0.0.1").orElseThrow();

        // Ten minutes left of the fifteen-minute window that started with the oldest failure.
        assertThat(remaining).isBetween(Duration.ofMinutes(9), Duration.ofMinutes(10));
    }

    @Test
    void releasesTheLockOneAttemptAtATimeAsFailuresAgeOut() {
        // The oldest failure expiring is what frees the next attempt — the whole window does
        // not reset at once, so a patient attacker gains one try per fifteen minutes.
        fail("admin", "10.0.0.1", LoginThrottle.MAX_FAILURES);
        assertThat(throttle.lockout("admin", "10.0.0.1")).isPresent();

        clock.advance(LoginThrottle.WINDOW.plusSeconds(1));

        assertThat(throttle.lockout("admin", "10.0.0.1")).isEmpty();
    }

    @Test
    void countsTheUsernameAndAddressTogether() {
        // Keying on the username alone would let one attacker lock every operator out of the
        // console during an incident — a denial of service wearing a security control's hat.
        fail("admin", "10.0.0.1", LoginThrottle.MAX_FAILURES);

        assertThat(throttle.lockout("admin", "10.0.0.2")).isEmpty();
        assertThat(throttle.lockout("manager", "10.0.0.1")).isEmpty();
    }

    @Test
    void treatsUsernamesCaseInsensitivelySoTheLimitCannotBeSidestepped() {
        fail("Admin", "10.0.0.1", 3);
        fail("ADMIN", "10.0.0.1", 2);

        assertThat(throttle.lockout("admin", "10.0.0.1")).isPresent();
    }

    @Test
    void forgetsFailuresOnceTheOperatorSignsInSuccessfully() {
        // Otherwise someone who mistyped four times spends the next quarter of an hour one
        // typo away from being locked out of a console they are already signed into.
        fail("admin", "10.0.0.1", LoginThrottle.MAX_FAILURES - 1);

        throttle.clear("admin", "10.0.0.1");

        assertThat(throttle.lockout("admin", "10.0.0.1")).isEmpty();
    }

    @Test
    void clearingOneAccountLeavesTheOthersAlone() {
        fail("admin", "10.0.0.1", LoginThrottle.MAX_FAILURES);
        fail("manager", "10.0.0.2", LoginThrottle.MAX_FAILURES);

        throttle.clear("admin", "10.0.0.1");

        assertThat(throttle.lockout("manager", "10.0.0.2")).isPresent();
    }

    @Test
    void survivesAMissingAddressRatherThanFailingTheLogin() {
        // A request with no resolvable address must still be counted, not crash the handler.
        throttle.recordFailure("admin", null);
        fail("admin", null, LoginThrottle.MAX_FAILURES - 1);

        assertThat(throttle.lockout("admin", null)).isPresent();
    }

    @Test
    void truncatesAnOversizedKeyInsteadOfFailingTheInsert() {
        // An attacker supplying a 10KB username must not get a free attempt out of a failed
        // insert. The column is 64 characters; anything longer is cut to fit.
        String huge = "x".repeat(5000);
        fail(huge, "10.0.0.1", LoginThrottle.MAX_FAILURES);

        assertThat(throttle.lockout(huge, "10.0.0.1")).isPresent();
    }

    @Test
    void prunesOnlyAttemptsTooOldForAnyWindowToReach() {
        fail("admin", "10.0.0.1", 2);
        clock.advance(Duration.ofDays(2));
        fail("manager", "10.0.0.2", 2);

        assertThat(throttle.prune()).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM login_attempts", Integer.class))
            .isEqualTo(2);
    }
}
