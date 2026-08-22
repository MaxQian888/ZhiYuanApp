package com.zhiyuan.device;

import java.time.Instant;

/**
 * The wire contract between a device and the platform (ADR 0002).
 *
 * <p>Every message carries the same five identity fields:
 *
 * <ul>
 *   <li>{@code schemaVersion} — what shape this message is. Unknown versions are counted
 *       and dropped, never guessed at.
 *   <li>{@code eventId} — unique per emission. QoS 1 redelivers, so the receiver dedupes
 *       on this rather than assuming at-most-once.
 *   <li>{@code uavCode} — the business key. Device firmware never learns our primary keys.
 *   <li>{@code sequence} — device-side monotonic counter. Detects gaps and reordering,
 *       which a timestamp cannot: clocks go backwards, sequences do not.
 *   <li>{@code observedAt} — when the device sampled it, in UTC. Not when we received it.
 * </ul>
 *
 * <p>Coordinates are WGS-84 everywhere (CONTEXT.md §5). Conversion to GCJ-02 happens in
 * the map layer at render time and is never written back.
 */
public final class DeviceMessages {
    private DeviceMessages() {}

    /** The schema version this build emits and accepts. */
    public static final int SCHEMA_VERSION = 1;

    public record Telemetry(int schemaVersion, String eventId, String uavCode, long sequence,
                            Instant observedAt, String status, int battery, double latitude,
                            double longitude, double altitude, double speed) {

        /** True while the device reports itself airborne, which tightens the freshness budget. */
        public boolean airborne() {
            return "FLYING".equals(status);
        }
    }

    /**
     * Connection state, maintained by a retained Last-Will message.
     *
     * <p>Presence and telemetry freshness are two different things (CONTEXT.md §2): a
     * device can hold its MQTT session open while its sensor loop has stalled.
     */
    public record Presence(int schemaVersion, String eventId, String uavCode, long sequence,
                           Instant observedAt, boolean online) {}

    /** A device's answer to one command. */
    public record CommandAck(int schemaVersion, String eventId, String uavCode, long sequence,
                             Instant observedAt, String commandId, String result, String detail) {

        /** Terminal results end the command's life; anything else is a progress report. */
        public boolean terminal() {
            return "EXECUTED".equals(result) || "REJECTED".equals(result) || "FAILED".equals(result);
        }
    }

    /**
     * One command on its way to a device.
     *
     * <p>{@code expiresAt} travels with the command so a device that receives it late can
     * refuse it itself — a "return home" that arrives five minutes after it was issued is
     * more dangerous than no command at all.
     */
    public record Command(int schemaVersion, String eventId, String uavCode, String commandId,
                          String type, String source, Instant issuedAt, Instant expiresAt,
                          String idempotencyKey, Long operatorId) {

        public boolean expired(Instant now) {
            return !now.isBefore(expiresAt);
        }
    }

    /**
     * An adapter's confirmation that it handed a command to the transport.
     *
     * <p>This is <em>not</em> proof the device executed it — that is what a
     * {@link CommandAck} is for. Conflating the two is how an operator ends up believing a
     * drone landed because the broker accepted a publish.
     */
    public record DispatchReceipt(String commandId, String adapter, Instant acceptedAt,
                                  boolean accepted, String reason) {

        public static DispatchReceipt accepted(String commandId, String adapter, Instant at) {
            return new DispatchReceipt(commandId, adapter, at, true, null);
        }

        public static DispatchReceipt rejected(String commandId, String adapter, Instant at,
                                               String reason) {
            return new DispatchReceipt(commandId, adapter, at, false, reason);
        }
    }
}
