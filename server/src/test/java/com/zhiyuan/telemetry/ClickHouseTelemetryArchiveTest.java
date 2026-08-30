package com.zhiyuan.telemetry;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ClickHouseTelemetryArchiveTest {

    private static final Instant NOW = Instant.parse("2026-08-30T12:00:00Z");

    private final AtomicReference<URI> requestUri = new AtomicReference<>();
    private final AtomicReference<String> responseBody = new AtomicReference<>(
        "{\"uav_code\":\"UAV-01\","
            + "\"observed_at\":\"2026-08-30 11:59:00.000\","
            + "\"status\":\"FLYING\",\"battery\":73,"
            + "\"latitude\":32.06,\"longitude\":118.78,"
            + "\"altitude\":48.5,\"speed\":12.3}\n");
    private HttpServer server;
    private ClickHouseTelemetryArchive archive;

    @BeforeEach
    void setUp() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requestUri.set(exchange.getRequestURI());
            byte[] response = responseBody.get()
                .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        archive = new ClickHouseTelemetryArchive(
            "http://127.0.0.1:" + server.getAddress().getPort(), "zhiyuan", "user", "password",
            2, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    @Test
    void sendsTypedQueryValuesAsHttpParametersRatherThanSqlText() {
        assertThat(archive.query("UAV-01", NOW.minusSeconds(120), NOW,
            TelemetryArchive.Resolution.RAW)).hasSize(1);

        assertThat(requestUri.get().getRawQuery())
            .contains("&param_code=UAV-01", "&param_from=", "&param_to=")
            .doesNotContain("%26param_code%3D");
    }

    @Test
    void rejectsAMalformedResponseRatherThanReturningAPartialTrack() {
        responseBody.set("{\"uav_code\":\"UAV-01\"}\n__exception__\nquery failed\n");

        assertThatThrownBy(() -> archive.query("UAV-01", NOW.minusSeconds(120), NOW,
            TelemetryArchive.Resolution.RAW))
            .isInstanceOf(TelemetryArchive.ArchiveUnavailableException.class)
            .hasMessageContaining("malformed telemetry response");
    }

    @Test
    void rawQueriesApplyReplacingMergeTreeDeduplicationAtReadTime() {
        archive.query("UAV-01", NOW.minusSeconds(120), NOW, TelemetryArchive.Resolution.RAW);

        assertThat(decodedQuery()).contains("FROM zhiyuan.telemetry_raw FINAL");
    }

    @Test
    void oneMinuteQueriesMergeAggregatePartsAtReadTime() {
        archive.query("UAV-01", NOW.minusSeconds(120), NOW,
            TelemetryArchive.Resolution.ONE_MINUTE);

        assertThat(decodedQuery())
            .contains("FROM zhiyuan.telemetry_1m")
            .contains("argMaxMerge(status) AS status")
            .contains("argMaxMerge(battery) AS battery")
            .contains("argMaxMerge(latitude) AS latitude")
            .contains("argMaxMerge(longitude) AS longitude")
            .contains("maxMerge(altitude) AS altitude")
            .contains("maxMerge(speed) AS speed")
            .doesNotContain("anyLast")
            .contains("GROUP BY uav_code, minute");
    }

    @Test
    void rejectsAnUnsafeDatabaseIdentifier() {
        assertThatThrownBy(() -> new ClickHouseTelemetryArchive(
            "http://127.0.0.1:8123", "zhiyuan; DROP TABLE telemetry_raw", "user", "password",
            2, Clock.fixed(NOW, ZoneOffset.UTC)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("database");
    }

    private String decodedQuery() {
        String rawQuery = requestUri.get().getRawQuery();
        String marker = "&query=";
        String encodedSql = rawQuery.substring(rawQuery.indexOf(marker) + marker.length())
            .split("&", 2)[0];
        return URLDecoder.decode(encodedSql, StandardCharsets.UTF_8);
    }
}
