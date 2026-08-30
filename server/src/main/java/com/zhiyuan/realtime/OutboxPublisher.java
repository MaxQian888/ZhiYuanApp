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
import java.time.Clock;
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
    private final ObjectMapper objectMapper;
    private final BackgroundFailureReporter backgroundFailures;

    private final long pollMillis;
    private final long resyncSeconds;
    private final Duration retention;
    private final Duration lease;
    private final Clock clock;
    private final boolean enabled;
    private final String claimToken = java.util.UUID.randomUUID().toString();

    private final AtomicLong published = new AtomicLong();
    private final AtomicLong failures = new AtomicLong();

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(
        runnable -> {
            Thread thread = new Thread(runnable, "outbox-publisher");
            thread.setDaemon(true);
            return thread;
        });

    public OutboxPublisher(DeviceIngestRepository repository, PlatformEventTransport transport,
                           PlatformStore store, ObjectMapper objectMapper,
                           BackgroundFailureReporter backgroundFailures, Clock clock,
                           @Value("${zhiyuan.realtime.outbox-poll-millis:200}") long pollMillis,
                           @Value("${zhiyuan.realtime.resync-seconds:30}") long resyncSeconds,
                           @Value("${zhiyuan.realtime.outbox-retention-hours:24}") long retentionHours,
                           @Value("${zhiyuan.realtime.outbox-lease-seconds:30}") long leaseSeconds,
                           @Value("${zhiyuan.realtime.publisher-enabled:false}") boolean enabled) {
        this.repository = repository;
        this.transport = transport;
        this.store = store;
        this.objectMapper = objectMapper;
        this.backgroundFailures = backgroundFailures;
        this.clock = clock;
        this.pollMillis = pollMillis;
        this.resyncSeconds = resyncSeconds;
        this.retention = Duration.ofHours(retentionHours);
        this.lease = Duration.ofSeconds(leaseSeconds);
        this.enabled = enabled;
    }

    @PostConstruct
    public void start() {
        if (!enabled) return;
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
        List<DeviceIngestRepository.OutboxRow> pending = repository.claimOutbox(
            claimToken, clock.instant(), lease, BATCH_SIZE);
        if (pending.isEmpty()) return 0;

        List<DeviceIngestRepository.OutboxRow> telemetry = new ArrayList<>();
        List<DeviceIngestRepository.OutboxRow> commandAcks = new ArrayList<>();
        List<Long> publishedIds = new ArrayList<>(pending.size());

        for (DeviceIngestRepository.OutboxRow row : pending) {
            switch (row.eventType()) {
                case "uav.telemetry" -> telemetry.add(row);
                case "uav.command-ack" -> commandAcks.add(row);
                case "uav.presence" -> processGroup(List.of(row), () -> {
                    forward("presence", row);
                    publishChangedDevices(Set.of(row.aggregateId()));
                }, publishedIds);
                default -> processGroup(List.of(row), () -> forward(row.eventType(), row),
                    publishedIds);
            }
        }

        processGroup(telemetry, () -> publishChangedDevices(telemetry.stream()
            .map(DeviceIngestRepository.OutboxRow::aggregateId)
            .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new))), publishedIds);
        processGroup(commandAcks, () -> publish("command-status", store.commands()), publishedIds);

        int acknowledged = repository.markPublished(claimToken, publishedIds);
        published.addAndGet(acknowledged);
        return acknowledged;
    }

    private void publishChangedDevices(Set<String> movedDevices) {
        if (movedDevices.isEmpty()) return;
        store.refreshDevices();
        List<?> changed = store.uavs("", "", "").stream()
            .filter(uav -> movedDevices.contains(uav.code()))
            .toList();
        if (changed.size() != movedDevices.size()) {
            throw new IllegalStateException("Missing current device state for outbox delta");
        }
        publish("telemetry-delta", changed);
    }

    private void processGroup(List<DeviceIngestRepository.OutboxRow> rows, Runnable action,
                              List<Long> publishedIds) {
        if (rows.isEmpty()) return;
        try {
            action.run();
            rows.stream().map(DeviceIngestRepository.OutboxRow::id).forEach(publishedIds::add);
        } catch (RuntimeException failure) {
            failures.incrementAndGet();
            repository.markFailed(claimToken, rows, clock.instant());
            log.warn("Failed to broadcast outbox group beginning at row {}", rows.get(0).id(), failure);
        }
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
        transport.broadcast(eventType, row.aggregateId(), row.payload());
    }

    private void publish(String eventType, Object payload) {
        try {
            transport.broadcast(eventType, eventType, objectMapper.writeValueAsString(payload));
        } catch (Exception failure) {
            throw new IllegalStateException("Failed to broadcast " + eventType, failure);
        }
    }

    private void drainQuietly() {
        try {
            drain();
        } catch (RuntimeException failure) {
            failures.incrementAndGet();
            backgroundFailures.report("outbox-drain", failure);
            log.warn("Outbox drain failed; will retry on the next poll", failure);
        }
    }

    private void resyncQuietly() {
        try {
            resync();
        } catch (RuntimeException failure) {
            backgroundFailures.report("outbox-resync", failure);
            log.warn("Realtime resync failed", failure);
        }
    }

    private void pruneQuietly() {
        try {
            int removed = repository.prunePublished(Instant.now().minus(retention));
            if (removed > 0) log.info("Pruned {} published outbox rows", removed);
        } catch (RuntimeException failure) {
            backgroundFailures.report("outbox-prune", failure);
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
