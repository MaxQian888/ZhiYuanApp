package com.zhiyuan.telemetry;

import com.zhiyuan.device.DeviceMessages;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/** Contract against the real ClickHouse container used by remote CI. */
class ClickHouseTelemetryArchiveContractTest {

    @Test
    void writesAndQueriesRawAndOneMinuteTelemetry() {
        String url = System.getenv("CLICKHOUSE_URL");
        assumeTrue(url != null && !url.isBlank(), "CLICKHOUSE_URL is only set by the contract job");

        ClickHouseTelemetryArchive archive = new ClickHouseTelemetryArchive(url, "zhiyuan",
            environment("CLICKHOUSE_USERNAME", "zhiyuan"),
            environment("CLICKHOUSE_PASSWORD", "zhiyuan-dev"), 10);
        String uavCode = "CONTRACT-" + UUID.randomUUID();
        Instant observedAt = Instant.now().truncatedTo(ChronoUnit.MILLIS);
        DeviceMessages.Telemetry sample = new DeviceMessages.Telemetry(
            DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), uavCode, 1,
            observedAt, "FLYING", 73, 32.06, 118.78, 48.5, 12.3);

        archive.append(List.of(sample));

        Instant from = observedAt.minusSeconds(60);
        Instant to = observedAt.plusSeconds(60);
        assertThat(archive.query(uavCode, from, to, TelemetryArchive.Resolution.RAW))
            .singleElement()
            .satisfies(point -> {
                assertThat(point.uavCode()).isEqualTo(uavCode);
                assertThat(point.battery()).isEqualTo(73);
                assertThat(point.observedAt()).isEqualTo(observedAt);
            });
        assertThat(archive.query(uavCode, from, to, TelemetryArchive.Resolution.ONE_MINUTE))
            .singleElement()
            .satisfies(point -> assertThat(point.uavCode()).isEqualTo(uavCode));
        assertThat(archive.healthy()).isTrue();
    }

    private static String environment(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value;
    }
}
