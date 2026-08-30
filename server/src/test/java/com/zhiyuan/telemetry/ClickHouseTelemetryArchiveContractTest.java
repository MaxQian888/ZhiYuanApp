package com.zhiyuan.telemetry;

import com.zhiyuan.device.DeviceMessages;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** Contract against the real ClickHouse container used by remote CI. */
@EnabledIfEnvironmentVariable(named = "CLICKHOUSE_URL", matches = ".+")
class ClickHouseTelemetryArchiveContractTest {

    @Test
    void writesAndQueriesRawAndOneMinuteTelemetry() {
        String url = System.getenv("CLICKHOUSE_URL");
        ClickHouseTelemetryArchive archive = new ClickHouseTelemetryArchive(url, "zhiyuan",
            environment("CLICKHOUSE_USERNAME", "zhiyuan"),
            environment("CLICKHOUSE_PASSWORD", "zhiyuan-dev"), 10);
        String uavCode = "CONTRACT-" + UUID.randomUUID();
        Instant minute = Instant.now().truncatedTo(ChronoUnit.MINUTES);
        DeviceMessages.Telemetry first = new DeviceMessages.Telemetry(
            DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), uavCode, 1,
            minute.plusSeconds(10), "ONLINE", 73, 32.06, 118.78, 48.5, 12.3);
        DeviceMessages.Telemetry second = new DeviceMessages.Telemetry(
            DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), uavCode, 2,
            minute.plusSeconds(20), "FLYING", 62, 32.07, 118.79, 58.5, 14.3);

        archive.append(List.of(first));
        archive.append(List.of(second));
        // A transport retry may arrive after the newer sample and in a different order.
        archive.append(List.of(second, first));

        Instant from = minute.minusSeconds(60);
        Instant to = minute.plusSeconds(60);
        assertThat(archive.query(uavCode, from, to, TelemetryArchive.Resolution.RAW))
            .hasSize(2)
            .extracting(TelemetryArchive.Point::battery)
            .containsExactly(73, 62);
        assertThat(archive.query(uavCode, from, to, TelemetryArchive.Resolution.ONE_MINUTE))
            .singleElement()
            .satisfies(point -> {
                assertThat(point.uavCode()).isEqualTo(uavCode);
                assertThat(point.observedAt()).isEqualTo(minute);
                assertThat(point.status()).isEqualTo("FLYING");
                assertThat(point.battery()).isEqualTo(62);
                assertThat(point.latitude()).isEqualTo(32.07);
                assertThat(point.longitude()).isEqualTo(118.79);
                assertThat(point.altitude()).isEqualTo(58.5);
                assertThat(point.speed()).isEqualTo(14.3);
            });
        assertThat(archive.healthy()).isTrue();
    }

    private static String environment(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
