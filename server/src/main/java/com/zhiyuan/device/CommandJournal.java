package com.zhiyuan.device;

/**
 * Where a command's life is written down.
 *
 * <p>An outbound port so the device layer never imports the service layer: the dispatcher
 * decides <em>what</em> happened to a command, the journal decides <em>where</em> that is
 * recorded.
 */
public interface CommandJournal {

    /** The command has been created and accepted for dispatch, but not yet sent. */
    void recordQueued(DeviceMessages.Command command, long uavId, String transcript);

    /** A non-terminal move: {@code SENT}, or a terminal {@code FAILED} / {@code TIMEOUT}. */
    void recordStatus(String commandId, String status);

    /** The device confirmed execution; this also writes the flight log entry. */
    void recordAcknowledged(String commandId, String event, String detail);
}
