package com.zhiyuan.realtime;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhiyuan.device.DeviceIngestRepository;
import com.zhiyuan.service.PlatformStore;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Drains the outbox and turns its rows into events operators can consume.
 *
 * <p>Two behaviours here are load-bearing:
 *
 * <p><b>Coalescing.</b> A poll may find hundreds of telemetry rows for the same device.
 * Publishing each one would push the fleet's full sample rate at every browser. Instead the
 * batch is reduced to the set of devices that changed and one delta event is emitted for
 * the batch — operators need the current position, not every position.
 *
 * <p><b>Periodic resync.</b> Deltas are cheap but lossy for a client that missed more than
 * the replay buffer holds. A full snapshot on a slow cadence bounds how wrong a client can
 * be, and keeps clients that predate {@code telemetry-delta} working (ADR 0004).
 */
@Component
public class OutboxPublisher {
    private static final Logger log = LoggerFactory.getLogger(OutboxPublisher.class);

    private static final int BATCH_SIZE = 500;

    private final DeviceIngestRepository repository;
    private final PlatformEventTransport transport;
    private final PlatformStore store;
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final long pollMillis;
    private final long resyncSeconds;
    private final Duration retention;

    private final AtomicLong published = new AtomicLong();
    private final AtomicLong failures = new AtomicLong();

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(
        runnable -> {
            Thread thread = new Thread(runnable, "outbox-publisher");
            thread.setDaemon(true);
            return thread;
        });

    public OutboxPublisher(DeviceIngestRepository repository, PlatformEventTransport transport,
                           PlatformStore store,
                           @Value("${zhiyuan.realtime.outbox-poll-millis:200}") long pollMillis,
                           @Value("${zhiyuan.realtime.resync-seconds:30}") long resyncSeconds,
                           @Value("${zhiyuan.realtime.outbox-retention-hours:24}") long retentionHours) {
        this.repository = repository;
        this.transport = transport;
        this.store = store;
        this.pollMillis = pollMillis;
        this.resyncSeconds = resyncSeconds;
        this.retention = Duration.ofHours(retentionHours);
    }

    @PostConstruct
    public void start() {
        scheduler.scheduleWithFixedDelay(this::drainQuietly, pollMillis, pollMillis,
            TimeUnit.MILLISECONDS);
        scheduler.scheduleWithFixedDelay(this::resyncQuietly, resyncSeconds, resyncSeconds,
            TimeUnit.SECONDS);
        scheduler.scheduleWithFixedDelay(this::pruneQuietly, 1, 1, TimeUnit.HOURS);
    }

    /**
     * Publishes one batch of pending outbox rows.
     *
     * @return how many rows were published
     */
    public int drain() {
        List<DeviceIngestRepository.OutboxRow> pending = repository.pendingOutbox(BATCH_SIZE);
        if (pending.isEmpty()) return 0;

        Set<String> movedDevices = new LinkedHashSet<>();
        boolean commandsChanged = false;
        List<Long> handled = new ArrayList<>(pending.size());

        for (DeviceIngestRepository.OutboxRow row : pending) {
            switch (row.eventType()) {
                case "uav.telemetry" -> movedDevices.add(row.aggregateId());
                case "uav.presence" -> {
                    movedDevices.add(row.aggregateId());
                    forward("presence", row);
                }
                case "uav.command-ack" -> commandsChanged = true;
                default -> forward(row.eventType(), row);
            }
            handled.add(row.id());
        }

        if (!movedDevices.isEmpty()) {
            // One query, one event, however many samples the batch contained.
            store.refreshDevices();
            List<?> changed = store.uavs("", "", "").stream()
                .filter(uav -> movedDevices.contains(uav.code()))
                .toList();
            if (!changed.isEmpty()) publish("telemetry-delta", changed);
        }
        if (commandsChanged) publish("command-status", store.commands());

        repository.markPublished(handled);
        published.addAndGet(handled.size());
        return handled.size();
    }

    /**
     * Sends the complete current state.
     *
     * <p>Also what a brand-new subscriber receives, so one code path defines "everything a
     * client needs to be correct".
     */
    public List<PlatformEventBus.Event> snapshotEvents() {
        store.refreshDevices();
        return List.of(
            new PlatformEventBus.Event(0, "telemetry", store.uavs("", "", ""), Instant.now()),
            new PlatformEventBus.Event(0, "alert", store.alerts(""), Instant.now()),
            new PlatformEventBus.Event(0, "command-status", store.commands(), Instant.now()),
            new PlatformEventBus.Event(0, "task-status", store.tasks(""), Instant.now()));
    }

    /** Periodic full state, bounding how far a client that missed deltas can drift. */
    public void resync() {
        store.refreshDevices();
        publish("telemetry", store.uavs("", "", ""));
        publish("alert", store.alerts(""));
        publish("task-status", store.tasks(""));
    }

    private void forward(String eventType, DeviceIngestRepository.OutboxRow row) {
        try {
            transport.broadcast(eventType, row.aggregateId(), row.payload());
        } catch (RuntimeException failure) {
            failures.incrementAndGet();
            repository.markAttempted(row.id());
            log.warn("Failed to broadcast outbox row {}", row.id(), failure);
        }
    }

    private void publish(String eventType, Object payload) {
        try {
            transport.broadcast(eventType, eventType, objectMapper.writeValueAsString(payload));
        } catch (Exception failure) {
            failures.incrementAndGet();
            log.warn("Failed to broadcast {}", eventType, failure);
        }
    }

    private void drainQuietly() {
        try {
            drain();
        } catch (RuntimeException failure) {
            failures.incrementAndGet();
            log.warn("Outbox drain failed; will retry on the next poll", failure);
        }
    }

    private void resyncQuietly() {
        try {
            resync();
        } catch (RuntimeException failure) {
            log.warn("Realtime resync failed", failure);
        }
    }

    private void pruneQuietly() {
        try {
            int removed = repository.prunePublished(Instant.now().minus(retention));
            if (removed > 0) log.info("Pruned {} published outbox rows", removed);
        } catch (RuntimeException failure) {
            log.warn("Outbox prune failed", failure);
        }
    }

    /** Parses a stored payload; exposed for diagnostics and tests. */
    JsonNode parse(String payload) {
        try {
            return objectMapper.readTree(payload);
        } catch (com.fasterxml.jackson.core.JsonProcessingException malformed) {
            throw new IllegalArgumentException("Outbox payload is not valid JSON", malformed);
        }
    }

    public long publishedCount() {
        return published.get();
    }

    public long failureCount() {
        return failures.get();
    }

    @PreDestroy
    public void stop() {
        scheduler.shutdownNow();
    }
}
