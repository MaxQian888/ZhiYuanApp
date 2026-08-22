package com.zhiyuan.device;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import com.zhiyuan.support.MutableClock;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

/** The command lifecycle: gated on the way out, bounded and idempotent on the way back. */
class CommandDispatcherTest {

    private static final Instant NOW = Instant.parse("2026-08-22T04:00:00Z");

    private final MutableClock clock = new MutableClock(NOW);
    private final DeviceRegistry registry = new DeviceRegistry(clock);
    private final RecordingJournal journal = new RecordingJournal();
    private final CapturingAdapter adapter = new CapturingAdapter();
    private CommandDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        dispatcher = new CommandDispatcher(adapter, registry, journal, clock);
        dispatcher.start();
        registry.recordPresence(new DeviceMessages.Presence(DeviceMessages.SCHEMA_VERSION, "p1",
            "UAV-01", 1, NOW, true));
        registry.recordTelemetry(new DeviceMessages.Telemetry(DeviceMessages.SCHEMA_VERSION, "t1",
            "UAV-01", 1, NOW, "ONLINE", 80, 32.06, 118.78, 0, 0));
    }

    @AfterEach
    void tearDown() {
        dispatcher.stop();
    }

    private CommandDispatcher.Issued issue() {
        return dispatcher.issue("UAV-01", 1L, "RETURN_HOME", "MANUAL", null, 7L, null);
    }

    @Test
    void issuesACommandToACommandableDeviceAndRecordsItsProgress() {
        CommandDispatcher.Issued issued = issue();

        assertThat(issued.receipt().accepted()).isTrue();
        assertThat(adapter.dispatched).singleElement().satisfies(command -> {
            assertThat(command.uavCode()).isEqualTo("UAV-01");
            assertThat(command.type()).isEqualTo("RETURN_HOME");
            assertThat(command.operatorId()).isEqualTo(7L);
            assertThat(command.expiresAt()).isEqualTo(NOW.plus(CommandDispatcher.COMMAND_DEADLINE));
        });
        assertThat(journal.events).containsExactly("QUEUED", "SENT");
    }

    @Test
    void refusesAnOfflineDeviceAndNeverReachesTheTransport() {
        registry.recordPresence(new DeviceMessages.Presence(DeviceMessages.SCHEMA_VERSION, "p2",
            "UAV-01", 2, NOW, false));

        assertThatThrownBy(this::issue)
            .isInstanceOf(CommandDispatcher.DeviceNotCommandableException.class)
            .hasMessageContaining("offline");

        assertThat(adapter.dispatched).isEmpty();
        assertThat(journal.events).isEmpty();
    }

    @Test
    void refusesADeviceWhoseTelemetryHasGoneStale() {
        clock.advance(Duration.ofSeconds(10));

        assertThatThrownBy(this::issue)
            .isInstanceOf(CommandDispatcher.DeviceNotCommandableException.class)
            .hasMessageContaining("stale");
        assertThat(adapter.dispatched).isEmpty();
    }

    @Test
    void aRejectedDispatchIsRecordedAsFailedRatherThanLeftPending() {
        adapter.rejectNext("broker unreachable");

        CommandDispatcher.Issued issued = issue();

        assertThat(issued.receipt().accepted()).isFalse();
        assertThat(issued.receipt().reason()).isEqualTo("broker unreachable");
        assertThat(journal.events).containsExactly("QUEUED", "FAILED");
        assertThat(dispatcher.pendingCount()).isZero();
    }

    @Test
    void anExecutedAcknowledgementSettlesTheCommandAndWritesTheFlightLog() {
        CommandDispatcher.Issued issued = issue();

        dispatcher.onCommandAck(ack(issued.commandId(), "EXECUTED"));

        assertThat(journal.events).containsExactly("QUEUED", "SENT", "ACKNOWLEDGED");
        assertThat(journal.acknowledgedEvents).containsExactly("返航指令");
        assertThat(dispatcher.pendingCount()).isZero();
    }

    @Test
    void aRedeliveredAcknowledgementDoesNotWriteASecondFlightLog() {
        CommandDispatcher.Issued issued = issue();
        DeviceMessages.CommandAck acknowledgement = ack(issued.commandId(), "EXECUTED");

        dispatcher.onCommandAck(acknowledgement);
        dispatcher.onCommandAck(acknowledgement);

        assertThat(journal.acknowledgedEvents).hasSize(1);
    }

    @Test
    void aSecondDistinctAcknowledgementForASettledCommandIsIgnored() {
        CommandDispatcher.Issued issued = issue();
        dispatcher.onCommandAck(ack(issued.commandId(), "EXECUTED"));

        // Same command, different eventId: the device retried its answer.
        dispatcher.onCommandAck(ack(issued.commandId(), "EXECUTED"));

        assertThat(journal.acknowledgedEvents).hasSize(1);
        assertThat(journal.events).containsExactly("QUEUED", "SENT", "ACKNOWLEDGED");
    }

    @Test
    void aRejectionFromTheDeviceIsRecordedAsFailed() {
        CommandDispatcher.Issued issued = issue();

        dispatcher.onCommandAck(ack(issued.commandId(), "REJECTED"));

        assertThat(journal.events).containsExactly("QUEUED", "SENT", "FAILED");
        assertThat(journal.acknowledgedEvents).isEmpty();
    }

    @Test
    void aProgressReportKeepsTheCommandPendingSoTheDeadlineStillApplies() {
        CommandDispatcher.Issued issued = issue();

        dispatcher.onCommandAck(ack(issued.commandId(), "RECEIVED"));

        assertThat(dispatcher.pendingCount()).isOne();
        assertThat(journal.events).containsExactly("QUEUED", "SENT");
    }

    @Test
    void anAcknowledgementForAnUnknownCommandIsIgnored() {
        dispatcher.onCommandAck(ack("never-issued", "EXECUTED"));
        assertThat(journal.events).isEmpty();
    }

    @Test
    void anAcknowledgementWithAnUnknownSchemaIsIgnored() {
        CommandDispatcher.Issued issued = issue();
        dispatcher.onCommandAck(new DeviceMessages.CommandAck(99, UUID.randomUUID().toString(),
            "UAV-01", 1, NOW, issued.commandId(), "EXECUTED", null));

        assertThat(journal.events).containsExactly("QUEUED", "SENT");
        assertThat(dispatcher.pendingCount()).isOne();
    }

    @Test
    void aCommandNobodyAnswersBecomesATimeout() {
        issue();

        // The deadline runs on real time, so wait for it rather than moving the test clock.
        await().atMost(Duration.ofSeconds(12))
            .until(() -> journal.events.contains("TIMEOUT"));

        assertThat(journal.events).containsExactly("QUEUED", "SENT", "TIMEOUT");
        assertThat(dispatcher.pendingCount()).isZero();
    }

    @Test
    void theSuppliedIdempotencyKeyTravelsWithTheCommand() {
        dispatcher.issue("UAV-01", 1L, "LAND", "VOICE", "无人机一号降落", 7L, "key-123");
        assertThat(adapter.dispatched).singleElement()
            .extracting(DeviceMessages.Command::idempotencyKey).isEqualTo("key-123");
    }

    @Test
    void withoutAKeyTheCommandIdIsUsedSoEveryCommandStillHasOne() {
        CommandDispatcher.Issued issued = issue();
        assertThat(adapter.dispatched).singleElement()
            .extracting(DeviceMessages.Command::idempotencyKey).isEqualTo(issued.commandId());
    }

    private DeviceMessages.CommandAck ack(String commandId, String result) {
        return new DeviceMessages.CommandAck(DeviceMessages.SCHEMA_VERSION,
            UUID.randomUUID().toString(), "UAV-01", 1, clock.instant(), commandId, result, null);
    }

    /** Captures dispatches and can be told to refuse the next one. */
    static final class CapturingAdapter implements UavAdapter {
        final List<DeviceMessages.Command> dispatched = new CopyOnWriteArrayList<>();
        private volatile String rejection;

        void rejectNext(String reason) {
            this.rejection = reason;
        }

        @Override
        public String providerName() {
            return "CAPTURING";
        }

        @Override
        public DeviceMessages.DispatchReceipt dispatch(DeviceMessages.Command command) {
            if (rejection != null) {
                String reason = rejection;
                rejection = null;
                return DeviceMessages.DispatchReceipt.rejected(command.commandId(), providerName(),
                    Instant.now(), reason);
            }
            dispatched.add(command);
            return DeviceMessages.DispatchReceipt.accepted(command.commandId(), providerName(),
                Instant.now());
        }

        @Override
        public void subscribe(DeviceEventListener listener) {
            // The test drives acknowledgements directly.
        }
    }

    static final class RecordingJournal implements CommandJournal {
        final List<String> events = new CopyOnWriteArrayList<>();
        final List<String> acknowledgedEvents = new ArrayList<>();

        @Override
        public void recordQueued(DeviceMessages.Command command, long uavId, String transcript) {
            events.add("QUEUED");
        }

        @Override
        public void recordStatus(String commandId, String status) {
            events.add(status);
        }

        @Override
        public void recordAcknowledged(String commandId, String event, String detail) {
            events.add("ACKNOWLEDGED");
            acknowledgedEvents.add(event);
        }
    }
}
