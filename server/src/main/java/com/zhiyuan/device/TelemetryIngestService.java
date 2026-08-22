package com.zhiyuan.device;

import com.zhiyuan.telemetry.TelemetryArchive;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Turns raw device messages into platform state.
 *
 * <p>The ordering here is deliberate and is the whole point of the design (ADR 0002):
 *
 * <ol>
 *   <li>validate — an unknown schema or an impossible value is counted and dropped, never
 *       redelivered, because a malformed message will still be malformed on retry;
 *   <li>write the snapshot <b>and</b> the outbox row in one MySQL transaction, so "the
 *       device moved" and "everyone was told" cannot come apart;
 *   <li>hand the sample to the archive asynchronously.
 * </ol>
 *
 * <p>Step 2 must succeed for the message to be acknowledged — {@link #onTelemetry} throws
 * otherwise, and the MQTT adapter withholds its manual ACK so the broker redelivers.
 * Step 3 must not: the archive is history, and losing live monitoring because a history
 * store is down would be the wrong failure mode. Archive failures are retried from a
 * bounded buffer and counted when that buffer overflows.
 */
@Service
public class TelemetryIngestService implements DeviceEventListener {
    private static final Logger log = LoggerFactory.getLogger(TelemetryIngestService.class);

    /** Batch size for archive writes. 2,500 samples/s at 200 per batch is ~12 flushes/s. */
    private static final int ARCHIVE_BATCH_SIZE = 200;

    private static final long ARCHIVE_FLUSH_MILLIS = 500;

    private final UavAdapter adapter;
    private final DeviceIngestRepository repository;
    private final DeviceRegistry registry;
    private final TelemetryArchive archive;
    private final TransactionTemplate transactions;
    private final boolean archiveRequired;

    private final BlockingQueue<DeviceMessages.Telemetry> archiveQueue;

    private final AtomicLong accepted = new AtomicLong();
    private final AtomicLong rejected = new AtomicLong();
    private final AtomicLong stale = new AtomicLong();
    private final AtomicLong archiveDropped = new AtomicLong();
    private final AtomicLong archiveFailures = new AtomicLong();

    private final ScheduledExecutorService flusher = Executors.newSingleThreadScheduledExecutor(
        runnable -> {
            Thread thread = new Thread(runnable, "telemetry-archive-flush");
            thread.setDaemon(true);
            return thread;
        });

    public TelemetryIngestService(UavAdapter adapter, DeviceIngestRepository repository,
                                  DeviceRegistry registry, TelemetryArchive archive,
                                  PlatformTransactionManager transactionManager,
                                  @Value("${zhiyuan.telemetry.archive-queue:20000}") int queueCapacity,
                                  @Value("${zhiyuan.telemetry.archive-required:false}") boolean archiveRequired) {
        this.adapter = adapter;
        this.repository = repository;
        this.registry = registry;
        this.archive = archive;
        this.transactions = new TransactionTemplate(transactionManager);
        this.archiveQueue = new ArrayBlockingQueue<>(queueCapacity);
        this.archiveRequired = archiveRequired;
    }

    @PostConstruct
    public void start() {
        // Without this the freshness gate never sees a sample and every command is refused.
        adapter.subscribe(this);
        flusher.scheduleWithFixedDelay(this::flushArchive, ARCHIVE_FLUSH_MILLIS,
            ARCHIVE_FLUSH_MILLIS, TimeUnit.MILLISECONDS);
    }

    @Override
    public void onTelemetry(DeviceMessages.Telemetry sample) {
        String problem = validate(sample);
        if (problem != null) {
            reject(sample.uavCode(), "telemetry", problem, sample.eventId());
            return;
        }

        // The registry is updated first and unconditionally: the freshness gate must reflect
        // reality even if the write below is what fails.
        registry.recordTelemetry(sample);

        Boolean applied = transactions.execute(status -> {
            if (!repository.applySnapshot(sample)) return Boolean.FALSE;
            repository.insertOutbox("uav.telemetry", sample.uavCode(), toJson(sample));
            return Boolean.TRUE;
        });

        if (!Boolean.TRUE.equals(applied)) {
            // Older than what we already hold: a duplicate or a reordered redelivery.
            // Not an error — acknowledge it so the broker stops resending.
            stale.incrementAndGet();
            return;
        }

        accepted.incrementAndGet();
        enqueueForArchive(sample);
    }

    @Override
    public void onPresence(DeviceMessages.Presence presence) {
        if (presence.schemaVersion() != DeviceMessages.SCHEMA_VERSION) {
            reject(presence.uavCode(), "presence", "UNKNOWN_SCHEMA",
                "schemaVersion=" + presence.schemaVersion());
            return;
        }
        registry.recordPresence(presence);
        transactions.executeWithoutResult(status ->
            repository.insertOutbox("uav.presence", presence.uavCode(), toJson(presence)));
    }

    @Override
    public void onCommandAck(DeviceMessages.CommandAck ack) {
        // Command acknowledgements are settled by CommandDispatcher; the ingest path only
        // records them so operators can see the device's own words in the audit trail.
        if (ack.schemaVersion() != DeviceMessages.SCHEMA_VERSION) return;
        transactions.executeWithoutResult(status ->
            repository.insertOutbox("uav.command-ack", ack.commandId(), toJson(ack)));
    }

    /**
     * @return null when the sample is usable, otherwise a short machine-readable reason
     */
    static String validate(DeviceMessages.Telemetry sample) {
        if (sample.schemaVersion() != DeviceMessages.SCHEMA_VERSION) return "UNKNOWN_SCHEMA";
        if (sample.uavCode() == null || sample.uavCode().isBlank()) return "MISSING_UAV_CODE";
        if (sample.eventId() == null || sample.eventId().isBlank()) return "MISSING_EVENT_ID";
        if (sample.observedAt() == null) return "MISSING_OBSERVED_AT";
        if (sample.sequence() < 0) return "NEGATIVE_SEQUENCE";
        if (sample.battery() < 0 || sample.battery() > 100) return "BATTERY_OUT_OF_RANGE";
        // WGS-84 bounds. A device reporting (0,0) mid-flight is a GPS fix failure, not a
        // position off the coast of Africa, but that is a fleet-health question rather than
        // a parsing one — reject only what cannot be a coordinate at all.
        if (sample.latitude() < -90 || sample.latitude() > 90) return "LATITUDE_OUT_OF_RANGE";
        if (sample.longitude() < -180 || sample.longitude() > 180) return "LONGITUDE_OUT_OF_RANGE";
        return null;
    }

    private void enqueueForArchive(DeviceMessages.Telemetry sample) {
        if (archiveQueue.offer(sample)) return;
        // The archive is behind and the buffer is full. Dropping the oldest keeps the most
        // recent history, which is what an incident review actually needs.
        archiveQueue.poll();
        if (!archiveQueue.offer(sample)) archiveDropped.incrementAndGet();
        archiveDropped.incrementAndGet();
    }

    /** Drains the buffer into the archive. Never throws; failures are counted and retried. */
    void flushArchive() {
        List<DeviceMessages.Telemetry> batch = new ArrayList<>(ARCHIVE_BATCH_SIZE);
        archiveQueue.drainTo(batch, ARCHIVE_BATCH_SIZE);
        if (batch.isEmpty()) return;
        try {
            archive.append(batch);
        } catch (RuntimeException failure) {
            archiveFailures.incrementAndGet();
            log.warn("Telemetry archive write failed for {} samples; will retry", batch.size(),
                failure);
            // Put them back at the tail. If the buffer has filled meanwhile, the oldest are
            // dropped by enqueueForArchive, which is the bounded-loss behaviour we want.
            batch.forEach(this::enqueueForArchive);
        }
    }

    private void reject(String uavCode, String topic, String reason, String detail) {
        rejected.incrementAndGet();
        try {
            transactions.executeWithoutResult(status ->
                repository.recordRejection(uavCode, topic, reason, detail));
        } catch (RuntimeException unavailable) {
            log.warn("Could not record device message rejection ({})", reason, unavailable);
        }
    }

    private String toJson(Object value) {
        return DeviceJson.write(value);
    }

    public long acceptedCount() {
        return accepted.get();
    }

    public long rejectedCount() {
        return rejected.get();
    }

    public long staleCount() {
        return stale.get();
    }

    public long archiveDroppedCount() {
        return archiveDropped.get();
    }

    public long archiveFailureCount() {
        return archiveFailures.get();
    }

    public int archiveBacklog() {
        return archiveQueue.size();
    }

    /** True when the archive is configured as required and is currently unreachable. */
    public boolean archiveDegraded() {
        return archiveRequired && !archive.healthy();
    }

    public Instant now() {
        return Instant.now();
    }

    @PreDestroy
    public void stop() {
        flusher.shutdownNow();
        flushArchive();
    }
}
