package com.zhiyuan.device;

/**
 * The whole device link, in three methods.
 *
 * <p>An adapter moves bytes; it holds no policy. Whether a command is <em>allowed</em> is
 * decided upstream by {@link DeviceRegistry}, and whether it <em>succeeded</em> is decided
 * by the {@link DeviceMessages.CommandAck} that arrives later. Keeping the port this thin
 * is what lets the simulator and the MQTT adapter run the same contract tests, and it is
 * what stops "works in the simulator" from diverging from "works against real hardware".
 */
public interface UavAdapter {

    /** Identifies this adapter in dispatch receipts and audit rows, e.g. {@code SIMULATOR}. */
    String providerName();

    /**
     * Hands one command to the transport.
     *
     * <p>Returns as soon as the transport has taken ownership. Implementations must not
     * block waiting for the device — the acknowledgement arrives asynchronously through
     * {@link DeviceEventListener#onCommandAck}.
     */
    DeviceMessages.DispatchReceipt dispatch(DeviceMessages.Command command);

    /**
     * Registers the sink for everything flowing from devices to the platform.
     *
     * <p>Called once during startup. Adapters may deliver on any thread; the listener is
     * responsible for its own safety.
     */
    void subscribe(DeviceEventListener listener);
}
