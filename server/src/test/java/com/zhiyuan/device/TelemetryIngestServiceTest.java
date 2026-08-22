package com.zhiyuan.device;

import com.zhiyuan.realtime.OutboxPublisher;
import com.zhiyuan.telemetry.TelemetryArchive;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The ingest path, end to end against the real database.
 *
 * <p>The properties worth pinning are the ones that only show up under redelivery and
 * failure: a stale sample must not overwrite a newer one, a malformed sample must be
 * recorded rather than silently swallowed, and the snapshot and the outbox row must land
 * together or not at all.
 */
@SpringBootTest
class TelemetryIngestServiceTest {

    @Autowired TelemetryIngestService ingest;
    @Autowired DeviceIngestRepository repository;
    @Autowired DeviceRegistry registry;
    @Autowired OutboxPublisher publisher;
    @Autowired TelemetryArchive archive;
    @Autowired JdbcTemplate jdbc;

    private static DeviceMessages.Telemetry sample(String code, long sequence, int battery) {
        return new DeviceMessages.Telemetry(DeviceMessages.SCHEMA_VERSION,
            UUID.randomUUID().toString(), code, sequence, Instant.now(), "FLYING", battery,
            32.06, 118.78, 30, 12);
    }

    private long nextSequence(String code) {
        Long current = jdbc.queryForObject("SELECT last_sequence FROM uavs WHERE code = ?",
            Long.class, code);
        return (current == null ? 0 : current) + 1;
    }

    @Test
    void acceptsASampleAndWritesBothTheSnapshotAndAnOutboxRow() {
        long sequence = nextSequence("UAV-02");
        long outboxBefore = countOutbox();

        ingest.onTelemetry(sample("UAV-02", sequence, 41));

        assertThat(jdbc.queryForObject("SELECT battery FROM uavs WHERE code = 'UAV-02'",
            Integer.class)).isEqualTo(41);
        assertThat(jdbc.queryForObject("SELECT last_sequence FROM uavs WHERE code = 'UAV-02'",
            Long.class)).isEqualTo(sequence);
        assertThat(countOutbox()).isGreaterThan(outboxBefore);
        assertThat(registry.isCommandable("UAV-02")).isTrue();
    }

    @Test
    void aStaleRedeliveryDoesNotOverwriteANewerSnapshot() {
        long sequence = nextSequence("UAV-05");
        ingest.onTelemetry(sample("UAV-05", sequence, 63));
        long staleCountBefore = ingest.staleCount();

        // Same device, older sequence — a QoS 1 redelivery arriving out of order.
        ingest.onTelemetry(sample("UAV-05", sequence - 1, 5));

        assertThat(jdbc.queryForObject("SELECT battery FROM uavs WHERE code = 'UAV-05'",
            Integer.class)).isEqualTo(63);
        assertThat(ingest.staleCount()).isGreaterThan(staleCountBefore);
    }

    @Test
    void anExactRedeliveryIsAlsoTreatedAsStaleRatherThanReapplied() {
        long sequence = nextSequence("UAV-06");
        DeviceMessages.Telemetry once = sample("UAV-06", sequence, 91);

        ingest.onTelemetry(once);
        long outboxAfterFirst = countOutbox();
        ingest.onTelemetry(once);

        assertThat(countOutbox()).isEqualTo(outboxAfterFirst);
    }

    @Test
    void aMalformedSampleIsRecordedRatherThanSilentlyDropped() {
        long before = repository.countRejectionsSince(Instant.now().minusSeconds(60));

        ingest.onTelemetry(new DeviceMessages.Telemetry(DeviceMessages.SCHEMA_VERSION,
            UUID.randomUUID().toString(), "UAV-01", 1, Instant.now(), "FLYING", 250, 32.06, 118.78,
            30, 12));

        assertThat(repository.countRejectionsSince(Instant.now().minusSeconds(60)))
            .isGreaterThan(before);
    }

    @Test
    void validationCoversEveryFieldThatCouldPoisonTheSnapshot() {
        Instant now = Instant.now();
        assertThat(TelemetryIngestService.validate(sample("UAV-01", 1, 80))).isNull();

        assertThat(TelemetryIngestService.validate(new DeviceMessages.Telemetry(99, "e", "UAV-01", 1,
            now, "FLYING", 80, 0, 0, 0, 0))).isEqualTo("UNKNOWN_SCHEMA");
        assertThat(TelemetryIngestService.validate(new DeviceMessages.Telemetry(1, "e", " ", 1,
            now, "FLYING", 80, 0, 0, 0, 0))).isEqualTo("MISSING_UAV_CODE");
        assertThat(TelemetryIngestService.validate(new DeviceMessages.Telemetry(1, "", "UAV-01", 1,
            now, "FLYING", 80, 0, 0, 0, 0))).isEqualTo("MISSING_EVENT_ID");
        assertThat(TelemetryIngestService.validate(new DeviceMessages.Telemetry(1, "e", "UAV-01", 1,
            null, "FLYING", 80, 0, 0, 0, 0))).isEqualTo("MISSING_OBSERVED_AT");
        assertThat(TelemetryIngestService.validate(new DeviceMessages.Telemetry(1, "e", "UAV-01", -1,
            now, "FLYING", 80, 0, 0, 0, 0))).isEqualTo("NEGATIVE_SEQUENCE");
        assertThat(TelemetryIngestService.validate(new DeviceMessages.Telemetry(1, "e", "UAV-01", 1,
            now, "FLYING", 101, 0, 0, 0, 0))).isEqualTo("BATTERY_OUT_OF_RANGE");
        assertThat(TelemetryIngestService.validate(new DeviceMessages.Telemetry(1, "e", "UAV-01", 1,
            now, "FLYING", 80, 91, 0, 0, 0))).isEqualTo("LATITUDE_OUT_OF_RANGE");
        assertThat(TelemetryIngestService.validate(new DeviceMessages.Telemetry(1, "e", "UAV-01", 1,
            now, "FLYING", 80, 0, 181, 0, 0))).isEqualTo("LONGITUDE_OUT_OF_RANGE");
    }

    @Test
    void samplesReachTheArchiveOnceTheBatchIsFlushed() {
        long sequence = nextSequence("UAV-03");
        Instant from = Instant.now().minusSeconds(30);

        ingest.onTelemetry(sample("UAV-03", sequence, 15));
        ingest.flushArchive();

        assertThat(archive.query("UAV-03", from, Instant.now().plusSeconds(30),
            TelemetryArchive.Resolution.RAW)).isNotEmpty();
    }

    @Test
    void presenceIsRecordedForTheGateAndForTheOutbox() {
        long outboxBefore = countOutbox();

        ingest.onPresence(new DeviceMessages.Presence(DeviceMessages.SCHEMA_VERSION,
            UUID.randomUUID().toString(), "UAV-06", 1, Instant.now(), false));

        assertThat(registry.readiness("UAV-06")).isEqualTo(DeviceRegistry.Readiness.OFFLINE);
        assertThat(countOutbox()).isGreaterThan(outboxBefore);
    }

    @Test
    void aPresenceMessageWithAnUnknownSchemaIsRejectedRatherThanApplied() {
        long before = repository.countRejectionsSince(Instant.now().minusSeconds(60));

        ingest.onPresence(new DeviceMessages.Presence(99, UUID.randomUUID().toString(), "UAV-06", 1,
            Instant.now(), true));

        assertThat(repository.countRejectionsSince(Instant.now().minusSeconds(60)))
            .isGreaterThan(before);
    }

    @Test
    void drainingTheOutboxCoalescesManySamplesIntoOnePublishedBatch() {
        long sequence = nextSequence("UAV-02");
        for (int index = 0; index < 20; index++) {
            ingest.onTelemetry(sample("UAV-02", sequence + index, 40 + (index % 5)));
        }

        int published = publisher.drain();

        assertThat(published).isGreaterThanOrEqualTo(20);
        // Everything drained is marked, so a second pass has nothing left to do for these.
        assertThat(repository.pendingOutbox(100))
            .noneMatch(row -> row.aggregateId().equals("UAV-02"));
    }

    @Test
    void resolvesADeviceCodeToItsIdAndCachesIt() {
        assertThat(repository.idForCode("UAV-01")).contains(1L);
        assertThat(repository.idForCode("UAV-01")).contains(1L);
        assertThat(repository.idForCode("NOT-A-DEVICE")).isEmpty();
    }

    @Test
    void prunesOnlyPublishedOutboxRows() {
        // Rows inserted directly rather than through ingest: the publisher runs on a 200ms
        // timer and would otherwise mark the test's own rows published mid-assertion, which
        // is a race the test would lose about as often as it won.
        jdbc.update("INSERT INTO outbox (event_type, aggregate_id, payload, published_at)"
            + " VALUES ('test.pruned', 'PRUNE-ME', '{}', ?)",
            java.sql.Timestamp.from(Instant.now().minusSeconds(3600)));
        jdbc.update("INSERT INTO outbox (event_type, aggregate_id, payload) VALUES"
            + " ('test.pending', 'KEEP-ME', '{}')");

        int removed = repository.prunePublished(Instant.now());

        assertThat(removed).isGreaterThanOrEqualTo(1);
        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM outbox WHERE aggregate_id = 'PRUNE-ME'", Integer.class)).isZero();
        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM outbox WHERE aggregate_id = 'KEEP-ME'", Integer.class))
            .isEqualTo(1);
    }

    @Test
    void leavesAPublishedRowThatIsStillInsideTheRetentionWindow() {
        // Pruning aggressively would delete the replay history a reconnecting client needs.
        jdbc.update("INSERT INTO outbox (event_type, aggregate_id, payload, published_at)"
            + " VALUES ('test.recent', 'RECENT', '{}', CURRENT_TIMESTAMP)");

        repository.prunePublished(Instant.now().minusSeconds(3600));

        assertThat(jdbc.queryForObject(
            "SELECT COUNT(*) FROM outbox WHERE aggregate_id = 'RECENT'", Integer.class))
            .isEqualTo(1);
    }

    private long countOutbox() {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM outbox", Long.class);
        return count == null ? 0 : count;
    }

    @Test
    void theOutboxPayloadIsTheDeviceEnvelopeItself() {
        long sequence = nextSequence("UAV-03");
        DeviceMessages.Telemetry emitted = sample("UAV-03", sequence, 15);

        ingest.onTelemetry(emitted);

        List<DeviceIngestRepository.OutboxRow> pending = repository.pendingOutbox(1000);
        assertThat(pending).anySatisfy(row -> {
            if (!"uav.telemetry".equals(row.eventType())) return;
            assertThat(row.payload()).contains(emitted.eventId());
        });
    }
}
