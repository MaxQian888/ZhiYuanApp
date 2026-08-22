package com.zhiyuan.device;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/** The adapter contract, run against the simulator. */
class SimulatorUavAdapterTest extends UavAdapterContract {

    private SimulatorUavAdapter simulator;

    @Override
    protected UavAdapter newAdapter() {
        simulator = new SimulatorUavAdapter(() -> List.of(
            new DeviceRoster.Entry(DEVICE, "FLYING", 80, 32.06, 118.78, 30, 12),
            new DeviceRoster.Entry("UAV-04", "OFFLINE", 0, 30.27, 120.15, 0, 0)));
        return simulator;
    }

    @Override
    protected void emitTelemetry() {
        simulator.publishTelemetry();
    }

    @Override
    protected void emitAck(String commandId, String result) {
        // The simulator answers on its own timer; the contract only needs it to arrive.
    }

    @AfterEach
    void tearDown() {
        simulator.stop();
    }

    @Test
    void announcesTheFleetOnSubscribeSoTheFirstCommandNeedNotWaitForATick() {
        assertThat(listener.presence).isNotEmpty();
        assertThat(listener.telemetry).isNotEmpty();
    }

    @Test
    void neverReportsAnOfflineDeviceAsPresentOrReporting() {
        simulator.publishPresence(true);
        simulator.publishTelemetry();

        assertThat(listener.presence).filteredOn(p -> p.uavCode().equals("UAV-04"))
            .allSatisfy(p -> assertThat(p.online()).isFalse());
        assertThat(listener.telemetry).noneMatch(t -> t.uavCode().equals("UAV-04"));
    }

    @Test
    void acknowledgesADispatchedCommandOnItsOwnSchedule() {
        DeviceMessages.Command command =
            command("LAND", Instant.now(), Instant.now().plusSeconds(8));

        adapter().dispatch(command);

        await().atMost(Duration.ofSeconds(5)).until(() -> listener.acks.stream()
            .anyMatch(ack -> ack.commandId().equals(command.commandId())));
        assertThat(listener.acks).filteredOn(ack -> ack.commandId().equals(command.commandId()))
            .singleElement()
            .satisfies(ack -> {
                assertThat(ack.result()).isEqualTo("EXECUTED");
                assertThat(ack.terminal()).isTrue();
            });
    }

    @Test
    void movesFlyingDevicesAndLeavesParkedOnesStill() {
        SimulatorUavAdapter parked = new SimulatorUavAdapter(
            () -> List.of(new DeviceRoster.Entry("UAV-06", "ONLINE", 91, 32.07, 118.80, 0, 0)));
        RecordingListener parkedListener = new RecordingListener();
        try {
            parked.subscribe(parkedListener);
            parked.publishTelemetry();

            assertThat(parkedListener.telemetry).isNotEmpty();
            assertThat(parkedListener.telemetry).allSatisfy(sample -> {
                assertThat(sample.latitude()).isEqualTo(32.07);
                assertThat(sample.longitude()).isEqualTo(118.80);
            });
        } finally {
            parked.stop();
        }

        // The flying device in this test's own roster does drift.
        simulator.publishTelemetry();
        simulator.publishTelemetry();
        assertThat(listener.telemetry).filteredOn(t -> t.uavCode().equals(DEVICE))
            .extracting(DeviceMessages.Telemetry::latitude)
            .doesNotHaveDuplicates();
    }
}
