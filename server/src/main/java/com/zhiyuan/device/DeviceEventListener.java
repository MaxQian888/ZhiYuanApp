package com.zhiyuan.device;

/**
 * Receives everything a device sends.
 *
 * <p>Implementations must be safe to call from an adapter's own threads and must not throw
 * for a message they simply do not like: a malformed or unknown-schema message is counted
 * and dropped, because redelivering it would only produce the same failure forever.
 */
public interface DeviceEventListener {

    void onTelemetry(DeviceMessages.Telemetry telemetry);

    void onPresence(DeviceMessages.Presence presence);

    void onCommandAck(DeviceMessages.CommandAck ack);
}
