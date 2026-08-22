package com.zhiyuan.telemetry;

import com.zhiyuan.device.DeviceMessages;
import com.zhiyuan.support.MutableClock;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The fake archive must refuse exactly what the real one refuses.
 *
 * <p>A fake that answers a question production would reject teaches the wrong lesson in
 * development and hides the failure until it reaches an operator.
 */
class InMemoryTelemetryArchiveTest {

    private static final Instant NOW = Instant.parse("2026-08-22T04:00:00Z");

    private final MutableClock clock = new MutableClock(NOW);
    private final InMemoryTelemetryArchive archive = new InMemoryTelemetryArchive(clock);

    private static DeviceMessages.Telemetry sample(Instant at, int battery) {
        return new DeviceMessages.Telemetry(DeviceMessages.SCHEMA_VERSION,
            UUID.randomUUID().toString(), "UAV-01", 1, at, "FLYING", battery, 32.06, 118.78, 30, 5);
    }

    @Test
    void storesAndReturnsRawSamplesInTimeOrder() {
        archive.append(List.of(sample(NOW.minusSeconds(2), 80), sample(NOW.minusSeconds(1), 79)));

        List<TelemetryArchive.Point> points = archive.query("UAV-01", NOW.minusSeconds(10), NOW,
            TelemetryArchive.Resolution.RAW);

        assertThat(points).hasSize(2);
        assertThat(points).extracting(TelemetryArchive.Point::battery).containsExactly(80, 79);
    }

    @Test
    void aRetriedBatchDoesNotDuplicateRows() {
        DeviceMessages.Telemetry once = sample(NOW.minusSeconds(1), 80);

        archive.append(List.of(once));
        archive.append(List.of(once));

        assertThat(archive.query("UAV-01", NOW.minusSeconds(10), NOW,
            TelemetryArchive.Resolution.RAW)).hasSize(1);
    }

    @Test
    void oneMinuteResolutionCollapsesEachMinuteToItsLastSample() {
        Instant minute = Instant.parse("2026-08-22T03:59:00Z");
        archive.append(List.of(
            sample(minute.plusSeconds(1), 90),
            sample(minute.plusSeconds(30), 85),
            sample(minute.plusSeconds(59), 80),
            sample(minute.plusSeconds(61), 75)));

        List<TelemetryArchive.Point> points = archive.query("UAV-01", minute, NOW.plusSeconds(120),
            TelemetryArchive.Resolution.ONE_MINUTE);

        assertThat(points).hasSize(2);
        assertThat(points).extracting(TelemetryArchive.Point::battery).containsExactly(80, 75);
    }

    @Test
    void refusesAQueryOlderThanTheResolutionRetains() {
        assertThatThrownBy(() -> archive.query("UAV-01", NOW.minus(Duration.ofDays(8)), NOW,
            TelemetryArchive.Resolution.RAW))
            .isInstanceOf(TelemetryArchive.RetentionExceededException.class)
            .hasMessageContaining("7 days");

        // The downsampled table keeps a year, so the same window is fine there.
        assertThat(archive.query("UAV-01", NOW.minus(Duration.ofDays(8)), NOW,
            TelemetryArchive.Resolution.ONE_MINUTE)).isEmpty();

        assertThatThrownBy(() -> archive.query("UAV-01", NOW.minus(Duration.ofDays(400)), NOW,
            TelemetryArchive.Resolution.ONE_MINUTE))
            .isInstanceOf(TelemetryArchive.RetentionExceededException.class);
    }

    @Test
    void excludesSamplesOutsideTheRequestedWindow() {
        archive.append(List.of(sample(NOW.minusSeconds(120), 90), sample(NOW.minusSeconds(1), 80)));

        assertThat(archive.query("UAV-01", NOW.minusSeconds(10), NOW,
            TelemetryArchive.Resolution.RAW)).hasSize(1);
    }

    @Test
    void anUnknownDeviceHasAnEmptyTrackRatherThanAnError() {
        assertThat(archive.query("UAV-99", NOW.minusSeconds(60), NOW,
            TelemetryArchive.Resolution.RAW)).isEmpty();
    }

    @Test
    void reportsItselfHealthyAndNamed() {
        assertThat(archive.healthy()).isTrue();
        assertThat(archive.providerName()).isEqualTo("IN_MEMORY");
    }

    @Test
    void retentionsMatchTheAdr() {
        assertThat(TelemetryArchive.Resolution.RAW.retention()).isEqualTo(Duration.ofDays(7));
        assertThat(TelemetryArchive.Resolution.ONE_MINUTE.retention()).isEqualTo(Duration.ofDays(365));
    }
}
