package com.zhiyuan.telemetry;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhiyuan.device.DeviceMessages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.StringJoiner;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * ClickHouse-backed telemetry history, over the HTTP interface.
 *
 * <p>Uses {@code java.net.http.HttpClient} against ClickHouse's HTTP protocol rather than
 * the JDBC driver. Both are supported transports; HTTP keeps the dependency surface at zero
 * new artifacts, speaks TLS natively, and is the same protocol ClickHouse Cloud exposes.
 * The trade-off is that we hand-roll the row encoding, which is why writes go out as
 * {@code JSONEachRow} — a format where a malformed row fails loudly instead of silently
 * shifting columns.
 *
 * <p>Deduplication is the table's job: {@code telemetry_raw} is a {@code ReplacingMergeTree}
 * keyed on {@code (uav_code, observed_at, event_id)}, so a retried batch converges to one
 * row per sample. That is what makes retry safe here (ADR 0003).
 *
 * <p>Activated only when {@code zhiyuan.clickhouse.url} is set; otherwise
 * {@link InMemoryTelemetryArchive} takes its place.
 */
public class ClickHouseTelemetryArchive implements TelemetryArchive {
    private static final Logger log = LoggerFactory.getLogger(ClickHouseTelemetryArchive.class);

    private final HttpClient http;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final String baseUrl;
    private final String database;
    private final String authorization;
    private final Duration timeout;
    private final Clock clock;

    /** Flipped by a failed call, cleared by a successful one. Drives the degraded signal. */
    private final AtomicBoolean reachable = new AtomicBoolean(true);

    public ClickHouseTelemetryArchive(String baseUrl, String database, String username,
                                      String password, long timeoutSeconds) {
        this(baseUrl, database, username, password, timeoutSeconds, Clock.systemUTC());
    }

    ClickHouseTelemetryArchive(String baseUrl, String database, String username, String password,
                               long timeoutSeconds, Clock clock) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.database = database;
        this.authorization = "Basic " + Base64.getEncoder()
            .encodeToString((username + ":" + password).getBytes(StandardCharsets.UTF_8));
        this.timeout = Duration.ofSeconds(timeoutSeconds);
        this.clock = clock;
        this.http = HttpClient.newBuilder().connectTimeout(this.timeout).build();
    }

    @Override
    public String providerName() {
        return "CLICKHOUSE";
    }

    @Override
    public void append(List<DeviceMessages.Telemetry> batch) {
        if (batch.isEmpty()) return;
        StringBuilder rows = new StringBuilder();
        for (DeviceMessages.Telemetry sample : batch) {
            rows.append(row(sample)).append('\n');
        }
        execute("INSERT INTO " + database + ".telemetry_raw FORMAT JSONEachRow", rows.toString());
    }

    @Override
    public List<Point> query(String uavCode, Instant from, Instant to, Resolution resolution) {
        TelemetryArchive.requireWithinRetention(resolution, from, clock.instant());
        String table = resolution == Resolution.RAW ? "telemetry_raw" : "telemetry_1m";
        String timeColumn = resolution == Resolution.RAW ? "observed_at" : "minute";

        // Parameterised so a device code can never be spliced into SQL.
        String sql = "SELECT uav_code, " + timeColumn + " AS observed_at, status, battery,"
            + " latitude, longitude, altitude, speed"
            + " FROM " + database + "." + table
            + " WHERE uav_code = {code:String}"
            + " AND " + timeColumn + " BETWEEN {from:DateTime64(3)} AND {to:DateTime64(3)}"
            + " ORDER BY " + timeColumn
            + " FORMAT JSONEachRow";

        String body = execute(sql + queryParameters(uavCode, from, to), null);
        List<Point> points = new ArrayList<>();
        for (String line : body.split("\n")) {
            if (line.isBlank()) continue;
            try {
                JsonNode node = objectMapper.readTree(line);
                points.add(new Point(node.get("uav_code").asText(),
                    Instant.parse(node.get("observed_at").asText().replace(' ', 'T') + "Z"),
                    node.get("status").asText(), node.get("battery").asInt(),
                    node.get("latitude").asDouble(), node.get("longitude").asDouble(),
                    node.get("altitude").asDouble(), node.get("speed").asDouble()));
            } catch (RuntimeException | IOException malformed) {
                log.warn("Skipping unparseable telemetry row from ClickHouse", malformed);
            }
        }
        return points;
    }

    @Override
    public boolean healthy() {
        try {
            HttpResponse<String> response = http.send(
                HttpRequest.newBuilder(URI.create(baseUrl + "/ping")).timeout(timeout).GET().build(),
                HttpResponse.BodyHandlers.ofString());
            boolean ok = response.statusCode() == 200;
            reachable.set(ok);
            return ok;
        } catch (IOException | InterruptedException unreachable) {
            if (unreachable instanceof InterruptedException) Thread.currentThread().interrupt();
            reachable.set(false);
            return false;
        }
    }

    private String queryParameters(String uavCode, Instant from, Instant to) {
        return "&param_code=" + encode(uavCode)
            + "&param_from=" + encode(from.toString())
            + "&param_to=" + encode(to.toString());
    }

    private String execute(String sql, String body) {
        URI uri = URI.create(baseUrl + "/?query=" + encode(sql));
        HttpRequest request = HttpRequest.newBuilder(uri)
            .timeout(timeout)
            .header("Authorization", authorization)
            .header("Content-Type", "text/plain; charset=utf-8")
            .POST(body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
            .build();
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() >= 300) {
                reachable.set(false);
                throw new ArchiveUnavailableException(
                    "ClickHouse returned " + response.statusCode() + ": " + response.body(), null);
            }
            reachable.set(true);
            return response.body();
        } catch (IOException failure) {
            reachable.set(false);
            throw new ArchiveUnavailableException("ClickHouse request failed", failure);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            reachable.set(false);
            throw new ArchiveUnavailableException("Interrupted talking to ClickHouse", interrupted);
        }
    }

    /** One JSONEachRow line. Field names must match the DDL in clickhouse/schema.sql. */
    private String row(DeviceMessages.Telemetry sample) {
        StringJoiner fields = new StringJoiner(",", "{", "}");
        fields.add(quoted("event_id", sample.eventId()));
        fields.add(quoted("uav_code", sample.uavCode()));
        fields.add("\"sequence\":" + sample.sequence());
        fields.add(quoted("observed_at", sample.observedAt().toString()));
        fields.add(quoted("status", sample.status()));
        fields.add("\"battery\":" + sample.battery());
        fields.add("\"latitude\":" + sample.latitude());
        fields.add("\"longitude\":" + sample.longitude());
        fields.add("\"altitude\":" + sample.altitude());
        fields.add("\"speed\":" + sample.speed());
        return fields.toString();
    }

    private static String quoted(String name, String value) {
        return "\"" + name + "\":\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
