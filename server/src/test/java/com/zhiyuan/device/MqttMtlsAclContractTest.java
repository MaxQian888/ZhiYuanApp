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
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

/** Real EMQX proof that certificate identity, topic identity and ACLs cannot diverge. */
@EnabledIfEnvironmentVariable(named = "MQTT_MTLS_URL", matches = ".+")
class MqttMtlsAclContractTest extends UavAdapterContract {

    private static final String TOPIC_ROOT = MqttTopics.WIRE_ROOT;
    private static final String STORE_PASSWORD = "changeit";

    private final MqttTopics topics = new MqttTopics(TOPIC_ROOT, "zhiyuan-mtls-contract");
    private final AtomicLong sequence = new AtomicLong();

    private MqttUavAdapter adapter;
    private MqttClient device;
    private MqttClient legacyDevice;

    @Override
    protected UavAdapter newAdapter() {
        String url = required("MQTT_MTLS_URL");
        adapter = new MqttUavAdapter(new MqttConnectionConfiguration(url, "zhiyuan-mtls-test",
            "", "", "zhiyuan-mtls-contract", TOPIC_ROOT,
            tls(required("MQTT_MTLS_PLATFORM_KEY_STORE")).socketFactory()));
        device = connect("device-uav-01-" + UUID.randomUUID(),
            tls(required("MQTT_MTLS_DEVICE_KEY_STORE")), "UAV-02");
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

    @Test
    void certificateCommonNameCannotPublishForAnotherUav() {
        MqttMessage forged = new MqttMessage(DeviceJson.writeBytes(new DeviceMessages.Telemetry(
            DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), "UAV-02",
            sequence.incrementAndGet(), Instant.now(), "FLYING", 80, 32.06, 118.78, 30, 12)));
        forged.setQos(1);

        try {
            device.publish(topics.telemetry("UAV-02"), forged);
        } catch (MqttException deniedImmediately) {
            // deny_action=disconnect may surface before publish returns.
        }

        await().atMost(Duration.ofSeconds(10)).until(() -> !device.isConnected());
    }

    @Test
    void certificateCommonNameCannotSubscribeToAnotherUavsCommands() {
        try {
            device.subscribe(topics.commands("UAV-02"), 1);
        } catch (MqttException deniedImmediately) {
            // deny_action=disconnect may surface before subscribe returns.
        }

        await().atMost(Duration.ofSeconds(10)).until(() -> !device.isConnected());
    }

    @Test
    void certificateCommonNameCanReceiveItsOwnCommand() throws MqttException {
        AtomicReference<String> received = new AtomicReference<>();
        device.subscribe(topics.commands(DEVICE), 1,
            (topic, message) -> received.set(
                new String(message.getPayload(), StandardCharsets.UTF_8)));
        DeviceMessages.Command command =
            command("RETURN_HOME", Instant.now(), Instant.now().plusSeconds(8));

        DeviceMessages.DispatchReceipt receipt = adapter.dispatch(command);

        assertThat(receipt.accepted()).isTrue();
        await().atMost(Duration.ofSeconds(10)).until(() -> received.get() != null);
        DeviceMessages.Command delivered =
            DeviceJson.read(received.get(), DeviceMessages.Command.class);
        assertThat(delivered.commandId()).isEqualTo(command.commandId());
    }

    @Test
    void aDeviceCannotClaimAnotherUavInsideItsOwnAllowedTopic() {
        publish(topics.telemetry(DEVICE), new DeviceMessages.Telemetry(
            DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), "UAV-02",
            sequence.incrementAndGet(), Instant.now(), "FLYING", 80, 32.06, 118.78, 30, 12));

        await().atMost(Duration.ofSeconds(10)).until(() -> adapter.invalidMessageCount() > 0);
        assertThat(listener.telemetry).noneMatch(sample -> "UAV-02".equals(sample.uavCode()));
    }

    @Test
    void aClientWithoutAPrivateCertificateCannotCompleteTheHandshake() {
        MqttClient anonymous = client("anonymous-" + UUID.randomUUID());
        try {
            MqttConnectionOptions options = options(
                tls(required("MQTT_MTLS_TRUST_STORE")));

            assertThatThrownBy(() -> anonymous.connect(options))
                .isInstanceOf(MqttException.class);
            assertThat(anonymous.isConnected()).isFalse();
        } finally {
            close(anonymous);
        }
    }

    @Test
    void authenticatedLegacyDeviceSharesRoutingWithTheMtlsPlatform() {
        legacyDevice = connectLegacy("legacy-uav-02-" + UUID.randomUUID(),
            "UAV-02", "contract-only");

        publish(legacyDevice, topics.telemetry("UAV-02"), new DeviceMessages.Telemetry(
            DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), "UAV-02",
            sequence.incrementAndGet(), Instant.now(), "FLYING", 70, 32.06, 118.78, 30, 12));

        await().atMost(Duration.ofSeconds(10)).until(() -> listener.telemetry.stream()
            .anyMatch(sample -> "UAV-02".equals(sample.uavCode())));
    }

    @Test
    void legacyMigrationListenerRejectsAnonymousClients() {
        MqttClient anonymous = client(required("MQTT_MTLS_LEGACY_URL"),
            "legacy-anonymous-" + UUID.randomUUID());
        try {
            MqttConnectionOptions options = new MqttConnectionOptions();
            options.setCleanStart(true);

            assertThatThrownBy(() -> anonymous.connect(options))
                .isInstanceOf(MqttException.class);
        } finally {
            close(anonymous);
        }
    }

    @AfterEach
    void tearDown() {
        close(device);
        close(legacyDevice);
        if (adapter != null) adapter.stop();
    }

    private MqttClient connect(String clientId, MqttTlsConfiguration tls, String claimedUsername) {
        MqttClient client = client(clientId);
        try {
            MqttConnectionOptions options = options(tls);
            options.setUserName(claimedUsername);
            client.connect(options);
            return client;
        } catch (MqttException failure) {
            close(client);
            throw new IllegalStateException("Test client could not establish mTLS", failure);
        }
    }

    private MqttClient client(String clientId) {
        return client(required("MQTT_MTLS_URL"), clientId);
    }

    private MqttClient client(String url, String clientId) {
        try {
            return new MqttClient(url, clientId, new MemoryPersistence());
        } catch (MqttException failure) {
            throw new IllegalStateException("Could not create MQTT contract client", failure);
        }
    }

    private MqttClient connectLegacy(String clientId, String username, String password) {
        MqttClient client = client(required("MQTT_MTLS_LEGACY_URL"), clientId);
        try {
            MqttConnectionOptions options = new MqttConnectionOptions();
            options.setCleanStart(true);
            options.setUserName(username);
            options.setPassword(password.getBytes(StandardCharsets.UTF_8));
            client.connect(options);
            return client;
        } catch (MqttException failure) {
            close(client);
            throw new IllegalStateException("Legacy contract client could not connect", failure);
        }
    }

    private static MqttConnectionOptions options(MqttTlsConfiguration tls) {
        MqttConnectionOptions options = new MqttConnectionOptions();
        options.setCleanStart(true);
        options.setSocketFactory(tls.socketFactory());
        options.setHttpsHostnameVerificationEnabled(true);
        return options;
    }

    private static MqttTlsConfiguration tls(String keyStore) {
        return new MqttTlsConfiguration(keyStore, STORE_PASSWORD,
            required("MQTT_MTLS_TRUST_STORE"), STORE_PASSWORD);
    }

    private void publish(String topic, Object payload) {
        publish(device, topic, payload);
    }

    private void publish(MqttClient publisher, String topic, Object payload) {
        try {
            MqttMessage message = new MqttMessage(
                DeviceJson.write(payload).getBytes(StandardCharsets.UTF_8));
            message.setQos(1);
            publisher.publish(topic, message);
        } catch (MqttException failure) {
            throw new IllegalStateException("Test device could not publish to " + topic, failure);
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " is required");
        return value;
    }

    private static void close(MqttClient client) {
        if (client == null) return;
        try {
            if (client.isConnected()) client.disconnect();
            client.close();
        } catch (MqttException ignored) {
            // The denial tests deliberately let the broker close the connection first.
        }
    }
}
