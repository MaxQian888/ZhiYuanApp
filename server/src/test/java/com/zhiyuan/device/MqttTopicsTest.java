package com.zhiyuan.device;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The topic layout is part of the device contract, so it is asserted literally.
 *
 * <p>A silent change here would leave firmware publishing where nothing listens.
 */
class MqttTopicsTest {

    private final MqttTopics topics = new MqttTopics("zhiyuan/v1", "zhiyuan-ingest");

    @Test
    void deviceTopicsMatchTheAdr() {
        assertThat(topics.telemetry("UAV-01")).isEqualTo("zhiyuan/v1/uavs/UAV-01/telemetry");
        assertThat(topics.presence("UAV-01")).isEqualTo("zhiyuan/v1/uavs/UAV-01/presence");
        assertThat(topics.commandAcks("UAV-01")).isEqualTo("zhiyuan/v1/uavs/UAV-01/command-acks");
        assertThat(topics.commands("UAV-01")).isEqualTo("zhiyuan/v1/uavs/UAV-01/commands");
        assertThat(topics.platformEvent("telemetry-delta"))
            .isEqualTo("zhiyuan/v1/platform/events/telemetry-delta");
    }

    @Test
    void deviceTrafficUsesASharedSubscriptionSoOnlyOneInstanceIngestsIt() {
        assertThat(topics.sharedDeviceSubscription("telemetry"))
            .isEqualTo("$share/zhiyuan-ingest/zhiyuan/v1/uavs/+/telemetry");
    }

    @Test
    void platformEventsUseAPlainSubscriptionSoEveryInstanceReceivesThem() {
        assertThat(topics.platformEventSubscription()).isEqualTo("zhiyuan/v1/platform/events/+");
        assertThat(topics.platformEventSubscription()).doesNotContain("$share");
    }

    @Test
    void extractsTheDeviceCodeFromAnyDeviceTopic() {
        assertThat(MqttTopics.uavCodeOf("zhiyuan/v1/uavs/UAV-07/telemetry")).isEqualTo("UAV-07");
        assertThat(MqttTopics.uavCodeOf("zhiyuan/v1/uavs/UAV-07/command-acks")).isEqualTo("UAV-07");
        assertThat(MqttTopics.uavCodeOf("zhiyuan/v1/platform/events/alert")).isNull();
    }

    @Test
    void extractsTheEventTypeAndTheTopicLeaf() {
        assertThat(MqttTopics.eventTypeOf("zhiyuan/v1/platform/events/alert")).isEqualTo("alert");
        assertThat(MqttTopics.leafOf("zhiyuan/v1/uavs/UAV-07/presence")).isEqualTo("presence");
        assertThat(MqttTopics.eventTypeOf("noslashes")).isEqualTo("noslashes");
    }
}
