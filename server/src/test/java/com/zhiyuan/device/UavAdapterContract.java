package com.zhiyuan.device;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * What every device link must do, regardless of transport.
 *
 * <p>The simulator and the MQTT adapter are interchangeable only if they agree on this, and
 * "works in the simulator" is worth nothing otherwise. The MQTT subclass needs a broker, so
 * it runs against the container in CI; the simulator subclass runs everywhere.
 */
abstract class UavAdapterContract {

    protected static final String DEVICE = "UAV-01";

    private UavAdapter adapter;
    protected final RecordingListener listener = new RecordingListener();

    /** A fresh adapter, already able to reach {@link #DEVICE}. */
    protected abstract UavAdapter newAdapter();

    /** Makes the device emit one telemetry sample, however this transport arranges that. */
    protected abstract void emitTelemetry();

    /** Makes the device answer {@code commandId}, however this transport arranges that. */
    protected abstract void emitAck(String commandId, String result);

    @BeforeEach
    void setUp() {
        adapter = newAdapter();
        adapter.subscribe(listener);
    }

    protected UavAdapter adapter() {
        return adapter;
    }

    protected DeviceMessages.Command command(String type, Instant issuedAt, Instant expiresAt) {
        String commandId = UUID.randomUUID().toString();
        return new DeviceMessages.Command(DeviceMessages.SCHEMA_VERSION,
            UUID.randomUUID().toString(), DEVICE, commandId, type, "MANUAL", issuedAt, expiresAt,
            commandId, 1L);
    }

    @Test
    void namesItself() {
        assertThat(adapter.providerName()).isNotBlank();
    }

    @Test
    void acceptsAValidCommandAndReturnsAReceiptForIt() {
        DeviceMessages.Command command =
            command("RETURN_HOME", Instant.now(), Instant.now().plusSeconds(8));

        DeviceMessages.DispatchReceipt receipt = adapter.dispatch(command);

        assertThat(receipt.accepted()).isTrue();
        assertThat(receipt.commandId()).isEqualTo(command.commandId());
        assertThat(receipt.adapter()).isEqualTo(adapter.providerName());
        assertThat(receipt.reason()).isNull();
    }

    @Test
    void refusesAnAlreadyExpiredCommandRatherThanSendingItLate() {
        DeviceMessages.Command stale = command("LAND", Instant.now().minusSeconds(30),
            Instant.now().minusSeconds(1));

        DeviceMessages.DispatchReceipt receipt = adapter.dispatch(stale);

        assertThat(receipt.accepted()).isFalse();
        assertThat(receipt.reason()).containsIgnoringCase("expired");
    }

    @Test
    void aReceiptIsNotAnAcknowledgement() {
        DeviceMessages.Command command =
            command("TAKE_OFF", Instant.now(), Instant.now().plusSeconds(8));

        adapter.dispatch(command);

        // The receipt says the transport took it. Whether the device executed it is a
        // separate event that arrives later, if at all.
        assertThat(listener.acks).noneMatch(ack -> ack.commandId().equals(command.commandId())
            && ack.terminal() && ack.observedAt().isBefore(Instant.now().minusSeconds(1)));
    }

    @Test
    void deliversTelemetryToTheSubscriber() {
        emitTelemetry();

        await().atMost(Duration.ofSeconds(5)).until(() -> !listener.telemetry.isEmpty());
        DeviceMessages.Telemetry sample = listener.telemetry.get(0);
        assertThat(sample.schemaVersion()).isEqualTo(DeviceMessages.SCHEMA_VERSION);
        assertThat(sample.eventId()).isNotBlank();
        assertThat(sample.uavCode()).isNotBlank();
        assertThat(sample.observedAt()).isNotNull();
    }

    @Test
    void everyTelemetryEventCarriesADistinctIdAndAdvancingSequence() {
        emitTelemetry();
        emitTelemetry();

        await().atMost(Duration.ofSeconds(5)).until(() -> listener.telemetry.size() >= 2);
        List<DeviceMessages.Telemetry> samples = List.copyOf(listener.telemetry);
        assertThat(samples).extracting(DeviceMessages.Telemetry::eventId).doesNotHaveDuplicates();
        assertThat(samples.get(samples.size() - 1).sequence())
            .isGreaterThan(samples.get(0).sequence());
    }

    @Test
    void deliversCommandAcknowledgements() {
        DeviceMessages.Command command =
            command("STOP", Instant.now(), Instant.now().plusSeconds(8));
        adapter.dispatch(command);

        emitAck(command.commandId(), "EXECUTED");

        await().atMost(Duration.ofSeconds(5))
            .until(() -> listener.acks.stream()
                .anyMatch(ack -> ack.commandId().equals(command.commandId())));
        assertThat(listener.acks).filteredOn(ack -> ack.commandId().equals(command.commandId()))
            .allSatisfy(ack -> assertThat(ack.terminal()).isTrue());
    }

    static final class RecordingListener implements DeviceEventListener {
        final List<DeviceMessages.Telemetry> telemetry = new CopyOnWriteArrayList<>();
        final List<DeviceMessages.Presence> presence = new CopyOnWriteArrayList<>();
        final List<DeviceMessages.CommandAck> acks = new CopyOnWriteArrayList<>();

        @Override
        public void onTelemetry(DeviceMessages.Telemetry sample) {
            telemetry.add(sample);
        }

        @Override
        public void onPresence(DeviceMessages.Presence value) {
            presence.add(value);
        }

        @Override
        public void onCommandAck(DeviceMessages.CommandAck ack) {
            acks.add(ack);
        }
    }
}
