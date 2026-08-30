package com.zhiyuan.device;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** Storage for the device link: current snapshots, the outbox, and rejected messages. */
@Repository
public class DeviceIngestRepository {

    public record OutboxRow(long id, String eventType, String aggregateId, String payload,
                            Instant createdAt, int attempts) {
        public OutboxRow(long id, String eventType, String aggregateId, String payload) {
            this(id, eventType, aggregateId, payload, Instant.EPOCH, 0);
        }
    }

    public record OutboxStats(long pending, long retrying, long oldestPendingSeconds) {}

    private final JdbcTemplate jdbc;

    /** uavCode → id. Codes never change, so this is safe to hold for the process lifetime. */
    private final Map<String, Long> idsByCode = new ConcurrentHashMap<>();

    public DeviceIngestRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<Long> idForCode(String uavCode) {
        Long cached = idsByCode.get(uavCode);
        if (cached != null) return Optional.of(cached);
        List<Long> found = jdbc.queryForList("SELECT id FROM uavs WHERE code = ?", Long.class, uavCode);
        if (found.isEmpty()) return Optional.empty();
        idsByCode.put(uavCode, found.get(0));
        return Optional.of(found.get(0));
    }

    /**
     * Overwrites the device's snapshot, but only with a newer sample.
     *
     * <p>The sequence guard lives in the {@code WHERE} clause so two instances processing a
     * redelivered message concurrently cannot interleave into an older position winning.
     *
     * @return false when the sample was stale and nothing was written
     */
    public boolean applySnapshot(DeviceMessages.Telemetry sample) {
        return jdbc.update(
            "UPDATE uavs SET status = ?, battery = ?, latitude = ?, longitude = ?, altitude = ?,"
                + " speed = ?, last_sequence = ?, observed_at = ?, updated_at = CURRENT_TIMESTAMP"
                + " WHERE code = ? AND last_sequence < ?",
            sample.status(), sample.battery(), sample.latitude(), sample.longitude(),
            sample.altitude(), sample.speed(), sample.sequence(),
            Timestamp.from(sample.observedAt()), sample.uavCode(), sample.sequence()) == 1;
    }

    /** Persists connectivity so the SSE device delta agrees with the presence event. */
    public boolean applyPresence(DeviceMessages.Presence presence) {
        return jdbc.update(
            "UPDATE uavs SET status = CASE WHEN ? THEN"
                + " CASE WHEN status = 'OFFLINE' THEN 'ONLINE' ELSE status END"
                + " ELSE 'OFFLINE' END, updated_at = ? WHERE code = ?",
            presence.online(), Timestamp.from(presence.observedAt()), presence.uavCode()) == 1;
    }

    public void insertOutbox(String eventType, String aggregateId, String payloadJson) {
        jdbc.update("INSERT INTO outbox (event_type, aggregate_id, payload) VALUES (?, ?, ?)",
            eventType, aggregateId, payloadJson);
    }

    /** Oldest-first so consumers observe events in the order they were produced. */
    public List<OutboxRow> pendingOutbox(int limit) {
        return jdbc.query(
            "SELECT id, event_type, aggregate_id, payload, created_at, attempts FROM outbox"
                + " WHERE published_at IS NULL ORDER BY id LIMIT " + Math.max(1, Math.min(limit, 1000)),
            (rs, row) -> mapOutboxRow(rs));
    }

    /** Claims a due batch in one short transaction; network publication happens afterwards. */
    @Transactional
    public List<OutboxRow> claimOutbox(String claimToken, Instant now, Duration lease, int limit) {
        int bounded = Math.max(1, Math.min(limit, 1000));
        List<OutboxRow> rows = jdbc.query(
            "SELECT id, event_type, aggregate_id, payload, created_at, attempts FROM outbox"
                + " WHERE published_at IS NULL AND next_attempt_at <= ?"
                + " AND (claim_until IS NULL OR claim_until <= ?)"
                + " ORDER BY id LIMIT " + bounded + " FOR UPDATE SKIP LOCKED",
            (rs, row) -> mapOutboxRow(rs), Timestamp.from(now), Timestamp.from(now));
        rows.forEach(row -> jdbc.update(
            "UPDATE outbox SET claim_token = ?, claim_until = ?"
                + " WHERE id = ? AND published_at IS NULL",
            claimToken, Timestamp.from(now.plus(lease)), row.id()));
        return rows;
    }

    public int markPublished(String claimToken, List<Long> ids) {
        if (ids.isEmpty()) return 0;
        return ids.stream().mapToInt(id -> jdbc.update(
            "UPDATE outbox SET published_at = CURRENT_TIMESTAMP, claim_token = NULL,"
                + " claim_until = NULL WHERE id = ? AND claim_token = ?", id, claimToken)).sum();
    }

    /** Persists retry state so restarts do not reset a failing row into a hot loop. */
    public void markFailed(String claimToken, List<OutboxRow> rows, Instant failedAt) {
        rows.forEach(row -> {
            long delaySeconds = retryDelaySeconds(row.attempts());
            jdbc.update("UPDATE outbox SET attempts = attempts + 1, next_attempt_at = ?,"
                    + " claim_token = NULL, claim_until = NULL WHERE id = ? AND claim_token = ?",
                Timestamp.from(failedAt.plusSeconds(delaySeconds)), row.id(), claimToken);
        });
    }

    static long retryDelaySeconds(int attempts) {
        return Math.min(60, 1L << Math.min(attempts, 6));
    }

    public OutboxStats outboxStats(Instant now) {
        Map<String, Object> row = jdbc.queryForMap(
            "SELECT COUNT(*) AS pending,"
                + " SUM(CASE WHEN attempts > 0 THEN 1 ELSE 0 END) AS retrying,"
                + " MIN(created_at) AS oldest FROM outbox WHERE published_at IS NULL");
        long pending = ((Number) row.get("pending")).longValue();
        Object retryingValue = row.get("retrying");
        long retrying = retryingValue == null ? 0 : ((Number) retryingValue).longValue();
        Timestamp oldest = (Timestamp) row.get("oldest");
        long age = oldest == null ? 0 : Math.max(0, Duration.between(oldest.toInstant(), now).toSeconds());
        return new OutboxStats(pending, retrying, age);
    }

    /** Removes published rows older than the cutoff so the table does not grow without bound. */
    public int prunePublished(Instant olderThan) {
        return jdbc.update("DELETE FROM outbox WHERE published_at IS NOT NULL AND published_at < ?",
            Timestamp.from(olderThan));
    }

    public void recordRejection(String uavCode, String topic, String reason, String detail) {
        jdbc.update(
            "INSERT INTO device_message_rejections (uav_code, topic, reason, detail) VALUES (?, ?, ?, ?)",
            uavCode, topic, reason, detail == null ? null
                : detail.substring(0, Math.min(detail.length(), 512)));
    }

    public long countRejectionsSince(Instant since) {
        Long count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM device_message_rejections WHERE occurred_at >= ?", Long.class,
            Timestamp.from(since));
        return count == null ? 0 : count;
    }

    private static OutboxRow mapOutboxRow(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new OutboxRow(rs.getLong("id"), rs.getString("event_type"),
            rs.getString("aggregate_id"), rs.getString("payload"),
            rs.getTimestamp("created_at").toInstant(), rs.getInt("attempts"));
    }
}
