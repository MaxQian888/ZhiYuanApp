package com.zhiyuan.device;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Issues commands, then decides what became of them.
 *
 * <p>Three properties matter here, and each one exists because of a specific failure:
 *
 * <ul>
 *   <li><b>Gated.</b> A command is only issued to a device that is online with fresh
 *       telemetry, and a refusal is final rather than queued (ADR 0002).
 *   <li><b>Bounded.</b> Every command carries a deadline and is settled as {@code TIMEOUT}
 *       if no terminal acknowledgement arrives. A command that stays {@code SENT} forever
 *       leaves the operator unable to tell "in progress" from "lost".
 *   <li><b>Idempotent.</b> QoS 1 redelivers, so acknowledgements are deduplicated on
 *       {@code eventId} and a settled command ignores everything that follows. Replaying an
 *       acknowledgement must not write a second flight log.
 * </ul>
 */
@Component
public class CommandDispatcher implements DeviceEventListener {

    /** Matches the acceptance criterion: no terminal ack within 8 seconds is a TIMEOUT. */
    static final Duration COMMAND_DEADLINE = Duration.ofSeconds(8);

    /** How many acknowledgement ids to remember for deduplication. */
    private static final int SEEN_ACK_CAPACITY = 10_000;

    public record Issued(String commandId, DeviceMessages.DispatchReceipt receipt) {}

    /** Raised when the device is not in a state that may be commanded. */
    public static class DeviceNotCommandableException extends RuntimeException {
        private final DeviceRegistry.Readiness readiness;

        public DeviceNotCommandableException(DeviceRegistry.Readiness readiness) {
            super(DeviceRegistry.explain(readiness));
            this.readiness = readiness;
        }

        public DeviceRegistry.Readiness readiness() {
            return readiness;
        }
    }

    private record Pending(DeviceMessages.Command command, ScheduledFuture<?> deadline) {}

    private final UavAdapter adapter;
    private final DeviceRegistry registry;
    private final CommandJournal journal;
    private final Clock clock;
    private final Map<String, Pending> pending = new ConcurrentHashMap<>();

    /**
     * Bounded LRU of acknowledgement ids. A plain set would grow without limit under a
     * redelivery storm, which is exactly when memory matters most.
     */
    private final Set<String> seenAcks = Collections.newSetFromMap(Collections.synchronizedMap(
        new LinkedHashMap<>(1_024, 0.75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
                return size() > SEEN_ACK_CAPACITY;
            }
        }));

    private final ScheduledExecutorService deadlines = Executors.newSingleThreadScheduledExecutor(
        runnable -> {
            Thread thread = new Thread(runnable, "command-deadlines");
            thread.setDaemon(true);
            return thread;
        });

    public CommandDispatcher(UavAdapter adapter, DeviceRegistry registry, CommandJournal journal,
                             Clock clock) {
        this.adapter = adapter;
        this.registry = registry;
        this.journal = journal;
        this.clock = clock;
    }

    @PostConstruct
    public void start() {
        adapter.subscribe(this);
    }

    public String adapterName() {
        return adapter.providerName();
    }

    /**
     * Validates, gates, records and dispatches one command.
     *
     * @throws DeviceNotCommandableException when the device is unknown, offline or stale
     */
    public Issued issue(String uavCode, long uavId, String type, String source, String transcript,
                        Long operatorId, String idempotencyKey) {
        DeviceRegistry.Readiness readiness = registry.readiness(uavCode);
        if (readiness != DeviceRegistry.Readiness.COMMANDABLE) {
            throw new DeviceNotCommandableException(readiness);
        }

        Instant now = clock.instant();
        String commandId = UUID.randomUUID().toString();
        DeviceMessages.Command command = new DeviceMessages.Command(
            DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), uavCode, commandId, type,
            source, now, now.plus(COMMAND_DEADLINE),
            idempotencyKey == null ? commandId : idempotencyKey, operatorId);

        journal.recordQueued(command, uavId, transcript);

        DeviceMessages.DispatchReceipt receipt = adapter.dispatch(command);
        if (!receipt.accepted()) {
            journal.recordStatus(commandId, "FAILED");
            return new Issued(commandId, receipt);
        }

        // Arm the deadline before reporting SENT, so a very fast failure cannot slip
        // through the window between the two.
        pending.put(commandId, new Pending(command,
            deadlines.schedule(() -> expire(commandId), COMMAND_DEADLINE.toMillis(),
                TimeUnit.MILLISECONDS)));
        journal.recordStatus(commandId, "SENT");
        return new Issued(commandId, receipt);
    }

    @Override
    public void onCommandAck(DeviceMessages.CommandAck ack) {
        if (ack.schemaVersion() != DeviceMessages.SCHEMA_VERSION) return;
        // Redelivery: the first copy already settled the command.
        if (!seenAcks.add(ack.eventId())) return;

        Pending settled = pending.remove(ack.commandId());
        // Unknown or already-settled command. Nothing to do — writing a status here would
        // resurrect a command that has already timed out.
        if (settled == null) return;
        settled.deadline().cancel(false);

        if (!ack.terminal()) {
            // Progress report: put it back so the deadline still applies.
            pending.put(ack.commandId(), settled);
            return;
        }

        if ("EXECUTED".equals(ack.result())) {
            journal.recordAcknowledged(ack.commandId(), commandEvent(settled.command().type()),
                settled.command().source() + " · " + ack.commandId());
        } else {
            journal.recordStatus(ack.commandId(), "FAILED");
        }
    }

    @Override
    public void onTelemetry(DeviceMessages.Telemetry telemetry) {
        // Freshness is tracked by the registry; the dispatcher only cares about acks.
    }

    @Override
    public void onPresence(DeviceMessages.Presence presence) {
        // Presence is tracked by the registry.
    }

    /** Settles a command that no device ever answered. */
    private void expire(String commandId) {
        if (pending.remove(commandId) == null) return;
        journal.recordStatus(commandId, "TIMEOUT");
    }

    public int pendingCount() {
        return pending.size();
    }

    static String commandEvent(String type) {
        return switch (type) {
            case "TAKE_OFF" -> "起飞指令";
            case "LAND" -> "降落指令";
            case "RETURN_HOME" -> "返航指令";
            case "STOP" -> "停止任务指令";
            default -> type;
        };
    }

    @PreDestroy
    public void stop() {
        deadlines.shutdownNow();
    }
}
