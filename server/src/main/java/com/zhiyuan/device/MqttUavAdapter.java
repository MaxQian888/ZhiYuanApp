package com.zhiyuan.device;

import com.zhiyuan.realtime.PlatformEventBus;
import com.zhiyuan.realtime.PlatformEventTransport;
import jakarta.annotation.PreDestroy;
import org.eclipse.paho.mqttv5.client.IMqttToken;
import org.eclipse.paho.mqttv5.client.MqttAsyncClient;
import org.eclipse.paho.mqttv5.client.MqttCallback;
import org.eclipse.paho.mqttv5.client.MqttConnectionOptions;
import org.eclipse.paho.mqttv5.client.MqttDisconnectResponse;
import org.eclipse.paho.mqttv5.client.persist.MemoryPersistence;
import org.eclipse.paho.mqttv5.common.MqttException;
import org.eclipse.paho.mqttv5.common.MqttMessage;
import org.eclipse.paho.mqttv5.common.packet.MqttProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;

/**
 * The real device link (ADR 0002).
 *
 * <p>Four properties are worth calling out, because each is a decision rather than a detail:
 *
 * <p><b>Manual acknowledgement.</b> The broker is told a message is handled only after the
 * listener returns normally. If the transactional write fails, no acknowledgement is sent
 * and the broker redelivers. Auto-acknowledgement would turn every downstream failure into
 * silent data loss.
 *
 * <p><b>Shared subscription for device traffic.</b> {@code $share/<group>/...} means one
 * instance handles each sample. Platform events use an ordinary subscription instead,
 * because every instance needs those to serve its own SSE clients.
 *
 * <p><b>QoS 1 throughout, never QoS 2.</b> QoS 2's four-way handshake roughly halves
 * throughput, and we must be idempotent anyway — devices reboot and replay, and the broker
 * redelivers. Deduplication on {@code eventId} is the real defence; QoS 2 would be an
 * expensive second lock on a door we already bolted.
 *
 * <p><b>Bad messages are dropped, not retried.</b> A payload that fails to parse will fail
 * identically forever; redelivering it would wedge the subscription. It is acknowledged,
 * counted, and recorded in {@code device_message_rejections}.
 *
 * <p>This class cannot be exercised without a broker, so its behaviour is covered by the
 * shared adapter contract tests plus an integration test that runs against the EMQX
 * container in CI.
 */
public class MqttUavAdapter implements UavAdapter, MqttCallback {
    private static final Logger log = LoggerFactory.getLogger(MqttUavAdapter.class);

    private static final int QOS = 1;

    private final MqttTopics topics;
    private final String serverUri;
    private final String username;
    private final String password;
    private final String clientId;
    private final Clock clock;

    private final List<DeviceEventListener> listeners = new CopyOnWriteArrayList<>();
    private final AtomicLong invalidMessages = new AtomicLong();
    private final AtomicLong received = new AtomicLong();

    private volatile MqttAsyncClient client;
    private volatile PlatformEventBus platformBus;

    public MqttUavAdapter(String serverUri, String clientIdPrefix, String username, String password,
                          String shareGroup, String topicRoot) {
        this(serverUri, clientIdPrefix, username, password, shareGroup, topicRoot, Clock.systemUTC());
    }

    MqttUavAdapter(String serverUri, String clientIdPrefix, String username, String password,
                   String shareGroup, String topicRoot, Clock clock) {
        this.serverUri = serverUri;
        this.username = username;
        this.password = password;
        this.topics = new MqttTopics(topicRoot, shareGroup);
        this.clock = clock;
        // Unique per instance: two instances sharing a client id would repeatedly evict
        // each other from the broker, which looks exactly like a flapping network.
        this.clientId = clientIdPrefix + "-" + hostname() + "-" + UUID.randomUUID();
    }

    @Override
    public String providerName() {
        return "MQTT";
    }

    @Override
    public void subscribe(DeviceEventListener listener) {
        listeners.add(listener);
        if (client == null) connect();
    }

    private synchronized void connect() {
        if (client != null) return;
        try {
            MqttAsyncClient created = new MqttAsyncClient(serverUri, clientId, new MemoryPersistence());
            // The broker must not consider a message handled until we say so.
            created.setManualAcks(true);
            created.setCallback(this);

            MqttConnectionOptions options = new MqttConnectionOptions();
            options.setAutomaticReconnect(true);
            options.setCleanStart(false);
            // Survive a short outage without losing queued device messages, but do not let
            // an instance that is gone for good accumulate a session forever.
            options.setSessionExpiryInterval(300L);
            options.setKeepAliveInterval(30);
            if (!username.isBlank()) {
                options.setUserName(username);
                options.setPassword(password.getBytes(StandardCharsets.UTF_8));
            }

            created.connect(options).waitForCompletion(30_000);
            created.subscribe(topics.sharedDeviceSubscription("telemetry"), QOS).waitForCompletion();
            created.subscribe(topics.sharedDeviceSubscription("presence"), QOS).waitForCompletion();
            created.subscribe(topics.sharedDeviceSubscription("command-acks"), QOS).waitForCompletion();
            created.subscribe(topics.platformEventSubscription(), QOS).waitForCompletion();
            this.client = created;
            log.info("MQTT device link connected as {}", clientId);
        } catch (MqttException failure) {
            throw new IllegalStateException("Could not establish the MQTT device link", failure);
        }
    }

    @Override
    public DeviceMessages.DispatchReceipt dispatch(DeviceMessages.Command command) {
        Instant now = clock.instant();
        if (command.expired(now)) {
            return DeviceMessages.DispatchReceipt.rejected(command.commandId(), providerName(), now,
                "Command expired before it reached the transport");
        }
        if (client == null || !client.isConnected()) {
            return DeviceMessages.DispatchReceipt.rejected(command.commandId(), providerName(), now,
                "MQTT device link is not connected");
        }
        try {
            MqttMessage message = new MqttMessage(DeviceJson.writeBytes(command));
            message.setQos(QOS);
            MqttProperties properties = new MqttProperties();
            // Trace context rides in user properties rather than the payload, so a device
            // that ignores it is unaffected and the payload stays purely business data.
            properties.setUserProperties(List.of(
                new org.eclipse.paho.mqttv5.common.packet.UserProperty("commandId", command.commandId()),
                new org.eclipse.paho.mqttv5.common.packet.UserProperty("idempotencyKey",
                    command.idempotencyKey())));
            // The device may discard a command it receives after this instant.
            properties.setMessageExpiryInterval(
                Math.max(1, java.time.Duration.between(now, command.expiresAt()).getSeconds()));
            message.setProperties(properties);

            client.publish(topics.commands(command.uavCode()), message);
            return DeviceMessages.DispatchReceipt.accepted(command.commandId(), providerName(), now);
        } catch (MqttException failure) {
            log.warn("Failed to publish command {}", command.commandId(), failure);
            return DeviceMessages.DispatchReceipt.rejected(command.commandId(), providerName(), now,
                failure.getMessage());
        }
    }

    // ---------------------------------------------------------- MqttCallback

    @Override
    public void messageArrived(String topic, MqttMessage message) {
        received.incrementAndGet();
        try {
            if (topic.contains("/platform/events/")) {
                deliverPlatformEvent(topic, message);
            } else {
                deliverDeviceMessage(topic, message);
            }
            acknowledge(message);
        } catch (DeviceJson.MalformedDeviceMessageException | InvalidDeviceMessageException invalid) {
            // Permanent: acknowledge so the broker stops resending, and count it so a
            // firmware regression is visible rather than looking like a quiet fleet.
            invalidMessages.incrementAndGet();
            log.warn("Dropping invalid message on {}: {}", topic, invalid.getMessage());
            acknowledge(message);
        } catch (RuntimeException transientFailure) {
            // Transient: leave it unacknowledged so the broker redelivers it.
            log.error("Failed to handle message on {}; leaving it unacknowledged", topic,
                transientFailure);
        }
    }

    private void deliverDeviceMessage(String topic, MqttMessage message) {
        String leaf = MqttTopics.leafOf(topic);
        String payload = new String(message.getPayload(), StandardCharsets.UTF_8);
        switch (leaf) {
            case "telemetry" -> {
                DeviceMessages.Telemetry telemetry =
                    DeviceJson.read(payload, DeviceMessages.Telemetry.class);
                requireMatchingCode(topic, telemetry.uavCode());
                listeners.forEach(listener -> listener.onTelemetry(telemetry));
            }
            case "presence" -> {
                DeviceMessages.Presence presence =
                    DeviceJson.read(payload, DeviceMessages.Presence.class);
                requireMatchingCode(topic, presence.uavCode());
                listeners.forEach(listener -> listener.onPresence(presence));
            }
            case "command-acks" -> {
                DeviceMessages.CommandAck ack =
                    DeviceJson.read(payload, DeviceMessages.CommandAck.class);
                requireMatchingCode(topic, ack.uavCode());
                listeners.forEach(listener -> listener.onCommandAck(ack));
            }
            default -> throw new InvalidDeviceMessageException("Unknown topic leaf " + leaf);
        }
    }

    private void deliverPlatformEvent(String topic, MqttMessage message) {
        PlatformEventBus bus = platformBus;
        if (bus == null) return;
        bus.publish(MqttTopics.eventTypeOf(topic),
            DeviceJson.read(new String(message.getPayload(), StandardCharsets.UTF_8),
                com.fasterxml.jackson.databind.JsonNode.class));
    }

    /**
     * A device may only speak for itself.
     *
     * <p>The broker's ACL enforces this too, but a platform that trusts the payload over the
     * topic would be one misconfigured ACL away from letting a compromised device report
     * positions for the whole fleet.
     */
    private static void requireMatchingCode(String topic, String claimedCode) {
        String topicCode = MqttTopics.uavCodeOf(topic);
        if (topicCode == null || !topicCode.equals(claimedCode)) {
            throw new InvalidDeviceMessageException(
                "Payload claims " + claimedCode + " but arrived on " + topic);
        }
    }

    private void acknowledge(MqttMessage message) {
        try {
            MqttAsyncClient current = client;
            if (current != null) current.messageArrivedComplete(message.getId(), message.getQos());
        } catch (MqttException failure) {
            log.warn("Could not acknowledge message {}", message.getId(), failure);
        }
    }

    @Override
    public void disconnected(MqttDisconnectResponse response) {
        log.warn("MQTT device link disconnected: {}", response.getReasonString());
    }

    @Override
    public void mqttErrorOccurred(MqttException exception) {
        log.warn("MQTT device link error", exception);
    }

    @Override
    public void deliveryComplete(IMqttToken token) {
        // Publishing is fire-and-forget at QoS 1; the device's ack is what matters.
    }

    @Override
    public void connectComplete(boolean reconnect, String serverUri) {
        if (reconnect) log.info("MQTT device link reconnected to {}", serverUri);
    }

    @Override
    public void authPacketArrived(int reasonCode, MqttProperties properties) {
        // Enhanced authentication is not used; mTLS handles device identity.
    }

    /**
     * Broadcasts outbox events to every instance.
     *
     * <p>Deliberately an ordinary topic, not a shared subscription: unlike device traffic,
     * every instance must see these.
     */
    public PlatformEventTransport platformEventTransport(PlatformEventBus bus) {
        this.platformBus = bus;
        return new PlatformEventTransport() {
            @Override
            public String providerName() {
                return "MQTT";
            }

            @Override
            public void broadcast(String eventType, String aggregateId, String payloadJson) {
                MqttAsyncClient current = client;
                if (current == null || !current.isConnected()) {
                    throw new IllegalStateException("MQTT platform event transport is not connected");
                }
                try {
                    MqttMessage message =
                        new MqttMessage(payloadJson.getBytes(StandardCharsets.UTF_8));
                    message.setQos(QOS);
                    current.publish(topics.platformEvent(eventType), message);
                } catch (MqttException failure) {
                    throw new IllegalStateException("Failed to broadcast " + eventType, failure);
                }
            }
        };
    }

    public long invalidMessageCount() {
        return invalidMessages.get();
    }

    public long receivedCount() {
        return received.get();
    }

    public boolean connected() {
        MqttAsyncClient current = client;
        return current != null && current.isConnected();
    }

    /** A payload that will never become valid. Acknowledged and dropped, never retried. */
    static class InvalidDeviceMessageException extends RuntimeException {
        InvalidDeviceMessageException(String message) {
            super(message);
        }
    }

    private static String hostname() {
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (UnknownHostException unknown) {
            return "unknown";
        }
    }

    @PreDestroy
    public void stop() {
        MqttAsyncClient current = client;
        if (current == null) return;
        try {
            current.disconnect().waitForCompletion(5_000);
            current.close();
        } catch (MqttException ignored) {
            // Shutting down; a failure to say goodbye politely is not worth reporting.
        }
    }
}
