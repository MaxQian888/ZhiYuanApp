package com.zhiyuan.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhiyuan.device.CommandDispatcher;
import com.zhiyuan.device.DeviceMessages;
import com.zhiyuan.device.DeviceRegistry;
import com.zhiyuan.device.MqttTopics;
import com.zhiyuan.device.MqttUavAdapter;
import com.zhiyuan.device.UavAdapter;
import com.zhiyuan.telemetry.TelemetryArchive;
import org.eclipse.paho.mqttv5.client.MqttClient;
import org.eclipse.paho.mqttv5.client.MqttConnectionOptions;
import org.eclipse.paho.mqttv5.client.persist.MemoryPersistence;
import org.eclipse.paho.mqttv5.common.MqttMessage;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * One real-infrastructure proof for the reliability path used by the remote E2E job.
 *
 * <p>The smaller MySQL, MQTT and ClickHouse contracts identify a broken dependency more
 * precisely. This test deliberately crosses their boundaries: a device publishes over MQTT,
 * MySQL and ClickHouse receive the sample, the durable outbox reaches the event bus that backs
 * SSE, and replaying a command idempotency key produces only one physical MQTT command.
 */
@SpringBootTest(properties = {
    "zhiyuan.mqtt.topic-root=zhiyuan/remote-contract",
    "zhiyuan.mqtt.share-group=zhiyuan-remote-contract",
    "zhiyuan.realtime.publisher-enabled=true",
    "zhiyuan.realtime.outbox-poll-millis=50",
    "zhiyuan.telemetry.archive-required=true"
})
@EnabledIfEnvironmentVariable(named = "REMOTE_RELIABILITY_CONTRACT", matches = "true")
class RemoteReliabilityContractTest {

    private static final String UAV_CODE = "UAV-01";
    private static final String TOPIC_ROOT = "zhiyuan/remote-contract";

    @Autowired
    private UavAdapter adapter;

    @Autowired
    private DeviceRegistry registry;

    @Autowired
    private CommandDispatcher commands;

    @Autowired
    private PlatformEventBus events;

    @Autowired
    private TelemetryArchive archive;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private ObjectMapper json;

    @Test
    void mqttTelemetryTraversesStorageOutboxAndSseWhileCommandReplayDispatchesOnce()
        throws Exception {
        assertThat(adapter).isInstanceOf(MqttUavAdapter.class);
        assertThat(archive.providerName()).isEqualTo("CLICKHOUSE");
        await().atMost(Duration.ofSeconds(10))
            .until(() -> ((MqttUavAdapter) adapter).connected());

        String mqttUrl = requiredEnvironment("MQTT_URL");
        MqttTopics topics = new MqttTopics(TOPIC_ROOT, "zhiyuan-remote-contract");
        MqttClient device = new MqttClient(mqttUrl, "contract-device-" + UUID.randomUUID(),
            new MemoryPersistence());
        try {
            MqttConnectionOptions options = new MqttConnectionOptions();
            options.setCleanStart(true);
            device.connect(options);

            AtomicInteger receivedCommands = new AtomicInteger();
            device.subscribe(topics.commands(UAV_CODE), 1,
                (topic, message) -> receivedCommands.incrementAndGet());

            long sequence = jdbc.queryForObject(
                "SELECT last_sequence FROM uavs WHERE code = ?", Long.class, UAV_CODE) + 1;
            Instant observedAt = Instant.now();
            String telemetryEventId = UUID.randomUUID().toString();
            publish(device, topics.presence(UAV_CODE), new DeviceMessages.Presence(
                DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), UAV_CODE,
                sequence, observedAt, true));
            publish(device, topics.telemetry(UAV_CODE), new DeviceMessages.Telemetry(
                DeviceMessages.SCHEMA_VERSION, telemetryEventId, UAV_CODE,
                sequence + 1, observedAt, "FLYING", 67, 32.0601, 118.7801, 51.5, 9.2));

            await().atMost(Duration.ofSeconds(15)).untilAsserted(() -> {
                assertThat(jdbc.queryForObject(
                    "SELECT battery FROM uavs WHERE code = ?", Integer.class, UAV_CODE))
                    .isEqualTo(67);
                assertThat(registry.isCommandable(UAV_CODE)).isTrue();
            });
            await().atMost(Duration.ofSeconds(15)).untilAsserted(() ->
                assertThat(archive.query(UAV_CODE, observedAt.minusSeconds(30),
                    observedAt.plusSeconds(30), TelemetryArchive.Resolution.RAW))
                    .anyMatch(point -> point.battery() == 67));
            await().atMost(Duration.ofSeconds(15)).untilAsserted(() ->
                assertThat(archive.query(UAV_CODE, observedAt.minusSeconds(30),
                    observedAt.plusSeconds(30), TelemetryArchive.Resolution.ONE_MINUTE))
                    .hasSize(1));
            await().atMost(Duration.ofSeconds(15)).untilAsserted(() ->
                assertThat(events.replaySince("0"))
                    .anyMatch(event -> "telemetry-delta".equals(event.name())
                        && json.valueToTree(event.payload()).toString()
                            .contains("\"battery\":67")));
            await().atMost(Duration.ofSeconds(15)).untilAsserted(() ->
                assertThat(jdbc.queryForObject("""
                    SELECT COUNT(*) FROM outbox
                    WHERE event_type = 'uav.telemetry' AND aggregate_id = ?
                      AND payload LIKE ? AND published_at IS NOT NULL
                    """, Integer.class, UAV_CODE, "%" + telemetryEventId + "%")).isEqualTo(1));

            String key = "remote-contract-" + UUID.randomUUID();
            CommandDispatcher.Issued first = commands.issue(
                UAV_CODE, 1L, "RETURN_HOME", "MANUAL", null, 1L, key);
            CommandDispatcher.Issued replay = commands.issue(
                UAV_CODE, 1L, "RETURN_HOME", "MANUAL", null, 1L, key);

            assertThat(replay.commandId()).isEqualTo(first.commandId());
            await().during(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(10))
                .untilAsserted(() -> assertThat(receivedCommands).hasValue(1));
        } finally {
            if (device.isConnected()) device.disconnect();
            device.close();
        }
    }

    private void publish(MqttClient device, String topic, Object payload) throws Exception {
        MqttMessage message = new MqttMessage(
            json.writeValueAsString(payload).getBytes(StandardCharsets.UTF_8));
        message.setQos(1);
        device.publish(topic, message);
    }

    private static String requiredEnvironment(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required by the remote contract");
        }
        return value;
    }
}
