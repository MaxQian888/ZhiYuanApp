package com.zhiyuan.device;

import org.eclipse.paho.mqttv5.client.MqttClient;
import org.eclipse.paho.mqttv5.client.MqttConnectionOptions;
import org.eclipse.paho.mqttv5.client.persist.MemoryPersistence;
import org.eclipse.paho.mqttv5.common.MqttException;
import org.eclipse.paho.mqttv5.common.MqttMessage;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * The adapter contract, run against a real broker.
 *
 * <p>Enabled only when {@code MQTT_URL} is set, which CI does via the EMQX service in
 * {@code docker-compose.yml}. Skipping locally is deliberate: a test that silently passes
 * without a broker would give false confidence about the one code path we cannot exercise
 * any other way.
 *
 * <p>Run it locally with:
 *
 * <pre>
 *   docker compose up -d --wait mqtt
 *   MQTT_URL=tcp://localhost:1883 mvn -f server/pom.xml test -Dtest=MqttUavAdapterTest
 * </pre>
 */
@EnabledIfEnvironmentVariable(named = "MQTT_URL", matches = ".+")
class MqttUavAdapterTest extends UavAdapterContract {

    private static final String TOPIC_ROOT = "zhiyuan/test";

    private MqttUavAdapter adapter;

    /** Stands in for the device firmware: publishes on the device's own topics. */
    private MqttClient device;

    private final MqttTopics topics = new MqttTopics(TOPIC_ROOT, "zhiyuan-test-ingest");
    private final AtomicLong sequence = new AtomicLong();

    @Override
    protected UavAdapter newAdapter() {
        String url = System.getenv("MQTT_URL");
        adapter = new MqttUavAdapter(url, "zhiyuan-test", "", "", "zhiyuan-test-ingest", TOPIC_ROOT);
        try {
            device = new MqttClient(url, "device-" + UUID.randomUUID(), new MemoryPersistence());
            MqttConnectionOptions options = new MqttConnectionOptions();
            options.setCleanStart(true);
            device.connect(options);
        } catch (MqttException failure) {
            throw new IllegalStateException("Test device could not reach the broker", failure);
        }
        return adapter;
    }

    @Override
    protected void emitTelemetry() {
        publish(topics.telemetry(DEVICE), new DeviceMessages.Telemetry(
            DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), DEVICE,
            sequence.incrementAndGet(), Instant.now(), "FLYING", 80, 32.06, 118.78, 30, 12));
    }

    @Override
    protected void emitAck(String commandId, String result) {
        publish(topics.commandAcks(DEVICE), new DeviceMessages.CommandAck(
            DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), DEVICE,
            sequence.incrementAndGet(), Instant.now(), commandId, result, null));
    }

    @AfterEach
    void tearDown() throws MqttException {
        if (device != null && device.isConnected()) device.disconnect();
        if (device != null) device.close();
        if (adapter != null) adapter.stop();
    }

    @Test
    void aCommandReachesTheDeviceTopic() throws Exception {
        java.util.concurrent.atomic.AtomicReference<String> received =
            new java.util.concurrent.atomic.AtomicReference<>();
        device.subscribe(topics.commands(DEVICE), 1,
            (topic, message) -> received.set(new String(message.getPayload(), StandardCharsets.UTF_8)));

        DeviceMessages.Command command =
            command("RETURN_HOME", Instant.now(), Instant.now().plusSeconds(8));
        adapter.dispatch(command);

        await().atMost(Duration.ofSeconds(10)).until(() -> received.get() != null);
        DeviceMessages.Command delivered =
            DeviceJson.read(received.get(), DeviceMessages.Command.class);
        assertThat(delivered.commandId()).isEqualTo(command.commandId());
        assertThat(delivered.type()).isEqualTo("RETURN_HOME");
        assertThat(delivered.expiresAt()).isEqualTo(command.expiresAt());
    }

    @Test
    void aPayloadThatClaimsAnotherDeviceIsRejected() {
        // The broker ACL enforces this too, but the platform must not trust the payload
        // over the topic it arrived on.
        publish(topics.telemetry(DEVICE), new DeviceMessages.Telemetry(
            DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), "UAV-99",
            sequence.incrementAndGet(), Instant.now(), "FLYING", 80, 32.06, 118.78, 30, 12));

        await().atMost(Duration.ofSeconds(10)).until(() -> adapter.invalidMessageCount() > 0);
        assertThat(listener.telemetry).noneMatch(sample -> "UAV-99".equals(sample.uavCode()));
    }

    @Test
    void anUnparseablePayloadIsCountedAndDroppedRatherThanRedelivered() {
        publishRaw(topics.telemetry(DEVICE), "{not json");

        await().atMost(Duration.ofSeconds(10)).until(() -> adapter.invalidMessageCount() > 0);
        // The subscription keeps working afterwards, which is the point of dropping it.
        emitTelemetry();
        await().atMost(Duration.ofSeconds(10)).until(() -> !listener.telemetry.isEmpty());
    }

    @Test
    void presenceIsDelivered() {
        publish(topics.presence(DEVICE), new DeviceMessages.Presence(
            DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), DEVICE,
            sequence.incrementAndGet(), Instant.now(), true));

        await().atMost(Duration.ofSeconds(10)).until(() -> !listener.presence.isEmpty());
        assertThat(listener.presence.get(0).online()).isTrue();
    }

    @Test
    void reportsItselfConnected() {
        assertThat(adapter.connected()).isTrue();
        assertThat(adapter.providerName()).isEqualTo("MQTT");
    }

    private void publish(String topic, Object payload) {
        publishRaw(topic, DeviceJson.write(payload));
    }

    private void publishRaw(String topic, String payload) {
        try {
            MqttMessage message = new MqttMessage(payload.getBytes(StandardCharsets.UTF_8));
            message.setQos(1);
            device.publish(topic, message);
        } catch (MqttException failure) {
            throw new IllegalStateException("Test device could not publish to " + topic, failure);
        }
    }
}
