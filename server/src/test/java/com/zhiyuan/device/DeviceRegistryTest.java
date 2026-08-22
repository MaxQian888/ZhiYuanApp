package com.zhiyuan.device;

import com.zhiyuan.support.MutableClock;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The command gate.
 *
 * <p>Every case here corresponds to a way a device can look available while being unsafe to
 * command, which is the failure this class exists to prevent.
 */
class DeviceRegistryTest {

    private static final Instant NOW = Instant.parse("2026-08-22T04:00:00Z");

    private final MutableClock clock = new MutableClock(NOW);
    private final DeviceRegistry registry = new DeviceRegistry(clock);

    private static DeviceMessages.Telemetry sample(String code, long sequence, Instant observedAt,
                                                   String status) {
        return new DeviceMessages.Telemetry(DeviceMessages.SCHEMA_VERSION, "event-" + sequence, code,
            sequence, observedAt, status, 80, 32.06, 118.78, 30, 5);
    }

    private static DeviceMessages.Presence presence(String code, boolean online, Instant at) {
        return new DeviceMessages.Presence(DeviceMessages.SCHEMA_VERSION, "presence-" + at, code, 1,
            at, online);
    }

    @Test
    void anUnseenDeviceIsNotCommandable() {
        assertThat(registry.readiness("UAV-99")).isEqualTo(DeviceRegistry.Readiness.UNKNOWN_DEVICE);
        assertThat(registry.isCommandable("UAV-99")).isFalse();
    }

    @Test
    void freshTelemetryFromAnOnlineDeviceIsCommandable() {
        registry.recordPresence(presence("UAV-01", true, NOW));
        registry.recordTelemetry(sample("UAV-01", 1, NOW, "ONLINE"));

        assertThat(registry.readiness("UAV-01")).isEqualTo(DeviceRegistry.Readiness.COMMANDABLE);
    }

    @Test
    void anAirborneDeviceGetsTheTighterFreshnessBudget() {
        registry.recordTelemetry(sample("UAV-02", 1, NOW, "FLYING"));

        clock.advance(Duration.ofMillis(1_900));
        assertThat(registry.readiness("UAV-02")).isEqualTo(DeviceRegistry.Readiness.COMMANDABLE);

        clock.advance(Duration.ofMillis(200));
        assertThat(registry.readiness("UAV-02")).isEqualTo(DeviceRegistry.Readiness.STALE_TELEMETRY);
    }

    @Test
    void aGroundedDeviceGetsTheLooserBudget() {
        registry.recordTelemetry(sample("UAV-01", 1, NOW, "ONLINE"));

        // Well past the airborne limit, comfortably inside the ground limit.
        clock.advance(Duration.ofSeconds(4));
        assertThat(registry.readiness("UAV-01")).isEqualTo(DeviceRegistry.Readiness.COMMANDABLE);

        clock.advance(Duration.ofSeconds(2));
        assertThat(registry.readiness("UAV-01")).isEqualTo(DeviceRegistry.Readiness.STALE_TELEMETRY);
    }

    @Test
    void aDeviceThatWentOfflineIsRefusedEvenWhileItsLastSampleIsStillFresh() {
        registry.recordTelemetry(sample("UAV-01", 1, NOW, "ONLINE"));
        registry.recordPresence(presence("UAV-01", false, NOW));

        assertThat(registry.readiness("UAV-01")).isEqualTo(DeviceRegistry.Readiness.OFFLINE);
    }

    @Test
    void presenceWithoutTelemetryIsNotEnough() {
        registry.recordPresence(presence("UAV-01", true, NOW));

        assertThat(registry.readiness("UAV-01")).isEqualTo(DeviceRegistry.Readiness.STALE_TELEMETRY);
    }

    @Test
    void telemetryReestablishesPresenceBecauseADisconnectedDeviceCannotPublish() {
        registry.recordPresence(presence("UAV-01", false, NOW));
        registry.recordTelemetry(sample("UAV-01", 5, NOW, "ONLINE"));

        assertThat(registry.readiness("UAV-01")).isEqualTo(DeviceRegistry.Readiness.COMMANDABLE);
    }

    @Test
    void anOutOfOrderRedeliveryDoesNotRollTheStateBackwards() {
        Instant later = NOW.plusSeconds(1);
        registry.recordTelemetry(sample("UAV-01", 10, later, "ONLINE"));
        registry.recordTelemetry(sample("UAV-01", 4, NOW.minusSeconds(30), "OFFLINE"));

        DeviceRegistry.DeviceState state = registry.state("UAV-01").orElseThrow();
        assertThat(state.lastTelemetry().sequence()).isEqualTo(10);
        assertThat(state.lastTelemetry().status()).isEqualTo("ONLINE");
    }

    @Test
    void aSampleStampedInTheFutureIsTreatedAsUsableRatherThanExpandingTheBudget() {
        registry.recordTelemetry(sample("UAV-02", 1, NOW.plusSeconds(30), "FLYING"));
        assertThat(registry.readiness("UAV-02")).isEqualTo(DeviceRegistry.Readiness.COMMANDABLE);

        // Once real time catches up and passes the budget, it goes stale as normal.
        clock.advance(Duration.ofSeconds(40));
        assertThat(registry.readiness("UAV-02")).isEqualTo(DeviceRegistry.Readiness.STALE_TELEMETRY);
    }

    @Test
    void everyReadinessHasAnOperatorFacingExplanation() {
        for (DeviceRegistry.Readiness readiness : DeviceRegistry.Readiness.values()) {
            assertThat(DeviceRegistry.explain(readiness)).isNotBlank();
        }
        assertThat(DeviceRegistry.explain(DeviceRegistry.Readiness.OFFLINE))
            .contains("not queued");
    }
}
