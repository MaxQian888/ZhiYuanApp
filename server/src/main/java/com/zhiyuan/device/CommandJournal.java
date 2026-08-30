package com.zhiyuan.device;

/**
 * Where a command's life is written down.
 *
 * <p>An outbound port so the device layer never imports the service layer: the dispatcher
 * decides <em>what</em> happened to a command, the journal decides <em>where</em> that is
 * recorded.
 */
public interface CommandJournal {

    record Reservation(boolean created, String commandId,
                       DeviceMessages.DispatchReceipt receipt) {}

    record Recovery(String commandId, String type, String source, java.time.Instant expiresAt) {}

    /** Atomically reserves an idempotency key and records the queued command. */
    Reservation reserve(DeviceMessages.Command command, long uavId, String transcript,
                        String requestFingerprint, String idempotencyKey);

    /** Persists the transport receipt used by future idempotent replays. */
    void recordDispatch(String commandId, DeviceMessages.DispatchReceipt receipt);

    /** Non-terminal commands whose deadlines must be restored after a process restart. */
    default java.util.List<Recovery> recoverable() {
        return java.util.List.of();
    }

    /** A non-terminal move: {@code SENT}, or a terminal {@code FAILED} / {@code TIMEOUT}. */
    void recordStatus(String commandId, String status);

    /** The device confirmed execution; this also writes the flight log entry. */
    void recordAcknowledged(String commandId, String event, String detail);
}
