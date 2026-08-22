package com.zhiyuan.device;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/** Storage for the device link: current snapshots, the outbox, and rejected messages. */
@Repository
public class DeviceIngestRepository {

    public record OutboxRow(long id, String eventType, String aggregateId, String payload) {}

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

    public void insertOutbox(String eventType, String aggregateId, String payloadJson) {
        jdbc.update("INSERT INTO outbox (event_type, aggregate_id, payload) VALUES (?, ?, ?)",
            eventType, aggregateId, payloadJson);
    }

    /** Oldest-first so consumers observe events in the order they were produced. */
    public List<OutboxRow> pendingOutbox(int limit) {
        return jdbc.query(
            "SELECT id, event_type, aggregate_id, payload FROM outbox"
                + " WHERE published_at IS NULL ORDER BY id LIMIT " + Math.max(1, Math.min(limit, 1000)),
            (rs, row) -> new OutboxRow(rs.getLong("id"), rs.getString("event_type"),
                rs.getString("aggregate_id"), rs.getString("payload")));
    }

    public void markPublished(List<Long> ids) {
        if (ids.isEmpty()) return;
        ids.forEach(id -> jdbc.update(
            "UPDATE outbox SET published_at = CURRENT_TIMESTAMP WHERE id = ?", id));
    }

    public void markAttempted(long id) {
        jdbc.update("UPDATE outbox SET attempts = attempts + 1 WHERE id = ?", id);
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
}
