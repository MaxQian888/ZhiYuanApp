package com.zhiyuan.telemetry;

import com.zhiyuan.device.DeviceMessages;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Where telemetry history lives (ADR 0003).
 *
 * <p>MySQL keeps only the current snapshot of each device; the series lives here. The
 * split is by access pattern, not by data type: 500 devices at 5 Hz is roughly 200 million
 * rows a day, which would wreck the transactional database's buffer pool, backup window
 * and point-in-time recovery — for data that needs no transactions at all.
 *
 * <p>This archive is explicitly <b>not</b> on the critical path. If it is unavailable,
 * ingest continues and live monitoring is unaffected; only history queries degrade.
 */
public interface TelemetryArchive {

    /** Raw samples are kept for a week — long enough for almost every incident review. */
    Duration RAW_RETENTION = Duration.ofDays(7);

    /** One-minute rollups are kept for a year, for trends and capacity work. */
    Duration DOWNSAMPLED_RETENTION = Duration.ofDays(365);

    enum Resolution {
        /** Every sample, as the device sent it. */
        RAW,
        /** One row per device per minute. */
        ONE_MINUTE;

        public Duration retention() {
            return this == RAW ? RAW_RETENTION : DOWNSAMPLED_RETENTION;
        }
    }

    /** One point on a device's track. Averaged fields are only meaningful at ONE_MINUTE. */
    record Point(String uavCode, Instant observedAt, String status, int battery, double latitude,
                 double longitude, double altitude, double speed) {}

    /** Raised when a query reaches past what the requested resolution retains. */
    class RetentionExceededException extends RuntimeException {
        public RetentionExceededException(Resolution resolution, Instant from) {
            super("Resolution " + resolution + " retains " + resolution.retention().toDays()
                + " days; " + from + " is older than that");
        }
    }

    /** Raised when the archive cannot be reached. Callers turn this into a 503, not a 500. */
    class ArchiveUnavailableException extends RuntimeException {
        public ArchiveUnavailableException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    /**
     * Appends a batch.
     *
     * <p>Batched rather than per-sample because 2,500 writes a second one at a time is a
     * network round trip per drone position. Implementations must be idempotent on
     * {@code (uavCode, observedAt, eventId)} so a retried batch does not duplicate rows.
     */
    void append(List<DeviceMessages.Telemetry> batch);

    List<Point> query(String uavCode, Instant from, Instant to, Resolution resolution);

    /** False when the archive is unreachable. Reported as degraded, never as unhealthy. */
    boolean healthy();

    String providerName();

    /** Shared guard so every implementation refuses out-of-retention windows identically. */
    static void requireWithinRetention(Resolution resolution, Instant from, Instant now) {
        if (from.isBefore(now.minus(resolution.retention()))) {
            throw new RetentionExceededException(resolution, from);
        }
    }
}
