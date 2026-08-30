package com.zhiyuan.device;

import javax.net.SocketFactory;

/** All connection-level MQTT settings passed to the adapter as one coherent value. */
public record MqttConnectionConfiguration(
    String serverUri,
    String clientIdPrefix,
    String username,
    String password,
    String shareGroup,
    String topicRoot,
    SocketFactory socketFactory
) {
}
