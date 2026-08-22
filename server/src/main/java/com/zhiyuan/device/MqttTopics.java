package com.zhiyuan.device;

/**
 * The topic layout from ADR 0002, bound to a configured root such as {@code zhiyuan/v1}.
 *
 * <p>Devices are addressed by {@code uavCode}, never by a database id: firmware must not
 * depend on our primary keys, and a code survives a database restore that renumbers rows.
 *
 * <p>The {@code v1} segment versions the <em>wire protocol</em> and moves independently of
 * the HTTP API version — a device fleet upgrades on a different schedule from a browser.
 */
public record MqttTopics(String root, String shareGroup) {

    public String telemetry(String uavCode) {
        return root + "/uavs/" + uavCode + "/telemetry";
    }

    public String presence(String uavCode) {
        return root + "/uavs/" + uavCode + "/presence";
    }

    public String commandAcks(String uavCode) {
        return root + "/uavs/" + uavCode + "/command-acks";
    }

    public String commands(String uavCode) {
        return root + "/uavs/" + uavCode + "/commands";
    }

    public String platformEvent(String eventType) {
        return root + "/platform/events/" + eventType;
    }

    /**
     * Device streams are consumed through a shared subscription so each message is handled
     * by exactly one instance. Without this, scaling out would multiply the ingest work
     * rather than divide it.
     */
    public String sharedDeviceSubscription(String leaf) {
        return "$share/" + shareGroup + "/" + root + "/uavs/+/" + leaf;
    }

    /**
     * Platform events use an ordinary subscription: every instance must receive them so it
     * can fan out to its own SSE clients.
     */
    public String platformEventSubscription() {
        return root + "/platform/events/+";
    }

    /** Extracts the device code from any {@code .../uavs/{code}/...} topic. */
    public static String uavCodeOf(String topic) {
        String[] segments = topic.split("/");
        for (int index = 0; index < segments.length - 1; index++) {
            if ("uavs".equals(segments[index])) return segments[index + 1];
        }
        return null;
    }

    /** Extracts the event type from a {@code .../platform/events/{type}} topic. */
    public static String eventTypeOf(String topic) {
        int slash = topic.lastIndexOf('/');
        return slash < 0 ? topic : topic.substring(slash + 1);
    }

    /** The last segment, used to tell telemetry from presence from acks. */
    public static String leafOf(String topic) {
        return eventTypeOf(topic);
    }
}
