package com.zhiyuan.device;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The device wire format is a contract with firmware we cannot redeploy on demand, so it is
 * pinned here rather than left to whichever Jackson modules happen to be on the classpath.
 */
class DeviceWireFormatTest {

    private static final Instant OBSERVED = Instant.parse("2026-08-22T04:00:00Z");

    @Test
    void timestampsAreIso8601Utc() {
        DeviceMessages.Telemetry sample = new DeviceMessages.Telemetry(1, "e1", "UAV-01", 42,
            OBSERVED, "FLYING", 80, 32.06, 118.78, 30, 5.2);

        assertThat(DeviceJson.write(sample)).contains("\"observedAt\":\"2026-08-22T04:00:00Z\"");
    }

    @Test
    void telemetryRoundTrips() {
        DeviceMessages.Telemetry sample = new DeviceMessages.Telemetry(1, "e1", "UAV-01", 42,
            OBSERVED, "FLYING", 80, 32.06, 118.78, 30, 5.2);

        assertThat(DeviceJson.read(DeviceJson.write(sample), DeviceMessages.Telemetry.class))
            .isEqualTo(sample);
    }

    @Test
    void presenceAndAcksRoundTrip() {
        DeviceMessages.Presence presence =
            new DeviceMessages.Presence(1, "e2", "UAV-01", 43, OBSERVED, false);
        DeviceMessages.CommandAck ack =
            new DeviceMessages.CommandAck(1, "e3", "UAV-01", 44, OBSERVED, "cmd-1", "EXECUTED", "ok");

        assertThat(DeviceJson.read(DeviceJson.write(presence), DeviceMessages.Presence.class))
            .isEqualTo(presence);
        assertThat(DeviceJson.read(DeviceJson.write(ack), DeviceMessages.CommandAck.class))
            .isEqualTo(ack);
    }

    @Test
    void anUnknownFieldFromNewerFirmwareIsIgnoredRatherThanFatal() {
        String payload = """
            {"schemaVersion":1,"eventId":"e1","uavCode":"UAV-01","sequence":1,
             "observedAt":"2026-08-22T04:00:00Z","status":"FLYING","battery":80,
             "latitude":32.06,"longitude":118.78,"altitude":30,"speed":5.2,
             "windSpeed":3.4}
            """;

        assertThat(DeviceJson.read(payload, DeviceMessages.Telemetry.class).uavCode())
            .isEqualTo("UAV-01");
    }

    @Test
    void aMalformedPayloadIsReportedAsPermanentlyBadRatherThanRetryable() {
        assertThatThrownBy(() -> DeviceJson.read("{not json", DeviceMessages.Telemetry.class))
            .isInstanceOf(DeviceJson.MalformedDeviceMessageException.class);

        assertThatThrownBy(() -> DeviceJson.read(
            "{\"observedAt\":\"yesterday\"}", DeviceMessages.Telemetry.class))
            .isInstanceOf(DeviceJson.MalformedDeviceMessageException.class);
    }

    @Test
    void airborneIsDerivedFromTheReportedStatus() {
        assertThat(new DeviceMessages.Telemetry(1, "e", "UAV-01", 1, OBSERVED, "FLYING", 1, 0, 0, 0, 0)
            .airborne()).isTrue();
        assertThat(new DeviceMessages.Telemetry(1, "e", "UAV-01", 1, OBSERVED, "ONLINE", 1, 0, 0, 0, 0)
            .airborne()).isFalse();
    }

    @Test
    void onlyTerminalResultsEndACommandsLife() {
        assertThat(ack("EXECUTED").terminal()).isTrue();
        assertThat(ack("REJECTED").terminal()).isTrue();
        assertThat(ack("FAILED").terminal()).isTrue();
        assertThat(ack("RECEIVED").terminal()).isFalse();
    }

    @Test
    void aCommandKnowsWhenItHasExpired() {
        DeviceMessages.Command command = new DeviceMessages.Command(1, "e", "UAV-01", "cmd-1",
            "LAND", "MANUAL", OBSERVED, OBSERVED.plusSeconds(8), "key", 1L);

        assertThat(command.expired(OBSERVED.plusSeconds(7))).isFalse();
        assertThat(command.expired(OBSERVED.plusSeconds(8))).isTrue();
        assertThat(command.expired(OBSERVED.plusSeconds(9))).isTrue();
    }

    private static DeviceMessages.CommandAck ack(String result) {
        return new DeviceMessages.CommandAck(1, "e", "UAV-01", 1, OBSERVED, "cmd-1", result, null);
    }
}
