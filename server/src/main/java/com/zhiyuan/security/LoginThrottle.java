package com.zhiyuan.security;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * Rate limiting for sign-in attempts: five failures per username and IP in fifteen minutes.
 *
 * <p>Counted in the database rather than in process memory, because the platform runs
 * several instances behind a load balancer. An in-memory counter would give an attacker one
 * budget per instance — and the number of instances changes when we scale, so the effective
 * limit would be a number nobody could state.
 *
 * <p>The key is the pair, not either half alone. Keying on username only lets one attacker
 * lock every operator out of the console during an incident, which is a denial of service
 * dressed as a security control. Keying on IP only lets a shared office address exhaust
 * everyone's budget at once.
 */
@Component
public class LoginThrottle {

    public static final int MAX_FAILURES = 5;
    public static final Duration WINDOW = Duration.ofMinutes(15);

    /** Raised when a username/IP pair has spent its budget. Carries how long is left. */
    public static class LockedOutException extends RuntimeException {
        private final Duration retryAfter;

        public LockedOutException(Duration retryAfter) {
            super("Too many sign-in attempts. Try again in " + Math.max(1, retryAfter.toSeconds())
                + " seconds.");
            this.retryAfter = retryAfter;
        }

        public Duration retryAfter() {
            return retryAfter;
        }
    }

    /** Attempts older than this are pruned; well past the window so nothing is lost early. */
    private static final Duration RETENTION = Duration.ofDays(1);

    private final JdbcTemplate jdbc;
    private final Clock clock;

    public LoginThrottle(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /** How long until this pair may try again, or empty if it may try now. */
    public Optional<Duration> lockout(String username, String ipAddress) {
        Instant since = clock.instant().minus(WINDOW);
        Integer failures = jdbc.queryForObject(
            "SELECT COUNT(*) FROM login_attempts WHERE username = ? AND ip_address = ?"
                + " AND occurred_at > ?",
            Integer.class, key(username), key(ipAddress), Timestamp.from(since));
        if (failures == null || failures < MAX_FAILURES) return Optional.empty();

        // The lockout expires when the oldest failure inside the window does, so a blocked
        // caller gets one attempt back at a time rather than five at once. Serving the
        // remaining time as Retry-After also means an honest operator who mistyped is told
        // when to come back instead of being left to guess.
        Timestamp oldest = jdbc.queryForObject(
            "SELECT MIN(occurred_at) FROM login_attempts WHERE username = ? AND ip_address = ?"
                + " AND occurred_at > ?",
            Timestamp.class, key(username), key(ipAddress), Timestamp.from(since));
        if (oldest == null) return Optional.empty();
        Duration remaining = Duration.between(clock.instant(), oldest.toInstant().plus(WINDOW));
        return remaining.isNegative() || remaining.isZero()
            ? Optional.empty()
            : Optional.of(remaining);
    }

    /** Throws {@link LockedOutException} when this pair has to wait. */
    public void requireAllowed(String username, String ipAddress) {
        lockout(username, ipAddress).ifPresent(remaining -> {
            throw new LockedOutException(remaining);
        });
    }

    public void recordFailure(String username, String ipAddress) {
        jdbc.update("INSERT INTO login_attempts (username, ip_address, occurred_at) VALUES (?, ?, ?)",
            key(username), key(ipAddress), Timestamp.from(clock.instant()));
    }

    /**
     * Forgets this pair's failures after a successful sign-in.
     *
     * <p>Without it, an operator who mistypes four times and then succeeds spends the next
     * fifteen minutes one typo away from being locked out of a console they are already
     * signed into. Whoever cleared the counter proved they know the password, so there is
     * nothing left to protect against here.
     */
    public void clear(String username, String ipAddress) {
        jdbc.update("DELETE FROM login_attempts WHERE username = ? AND ip_address = ?",
            key(username), key(ipAddress));
    }

    /** Drops attempts old enough that no window can still reach them. */
    public int prune() {
        return jdbc.update("DELETE FROM login_attempts WHERE occurred_at < ?",
            Timestamp.from(clock.instant().minus(RETENTION)));
    }

    /**
     * Normalises a key component.
     *
     * <p>Usernames are lower-cased so "Admin" and "admin" share one budget — otherwise the
     * limit is trivially bypassed by changing the case of a letter. The length cap matches
     * the column, so an oversized value is truncated rather than failing the insert and
     * silently costing an attacker nothing.
     */
    private static String key(String value) {
        if (value == null || value.isBlank()) return "unknown";
        String trimmed = value.trim().toLowerCase(java.util.Locale.ROOT);
        return trimmed.substring(0, Math.min(trimmed.length(), 64));
    }
}
