package com.zhiyuan.device;

import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * What the platform currently believes about each device, and whether it may be commanded.
 *
 * <p>Two independent facts are tracked, because they fail independently (CONTEXT.md §2):
 *
 * <ul>
 *   <li><b>Presence</b> — is the MQTT session up? Maintained by a retained Last-Will.
 *   <li><b>Freshness</b> — how old is the newest telemetry sample?
 * </ul>
 *
 * <p>A device can be present but stale (session alive, sensor loop wedged), or fresh but
 * momentarily absent (message in flight during a reconnect). Commanding on presence alone
 * is the more dangerous of the two mistakes, so both must hold.
 *
 * <p>Rejections are final. A command that cannot be delivered <em>now</em> is not queued —
 * a "return home" that lands five minutes late is worse than one that never arrives,
 * because the operator has long since moved on to another remedy (ADR 0002).
 */
@Component
public class DeviceRegistry {

    /**
     * An airborne device is sampled at 5 Hz, so two seconds is ten missed samples — long
     * past the point where its reported position can be trusted for a control decision.
     * On the ground the position barely changes, so a laxer budget avoids refusing
     * perfectly safe commands during a brief network hiccup.
     */
    static final Duration AIRBORNE_FRESHNESS = Duration.ofSeconds(2);

    static final Duration GROUND_FRESHNESS = Duration.ofSeconds(5);

    /** Why a device cannot be commanded, or {@link #COMMANDABLE} when it can. */
    public enum Readiness {
        COMMANDABLE,
        UNKNOWN_DEVICE,
        OFFLINE,
        STALE_TELEMETRY
    }

    public record DeviceState(String uavCode, boolean online, DeviceMessages.Telemetry lastTelemetry,
                              Instant lastPresenceAt) {}

    private final Map<String, DeviceState> devices = new ConcurrentHashMap<>();
    private final Clock clock;

    public DeviceRegistry(Clock clock) {
        this.clock = clock;
    }

    public void recordPresence(DeviceMessages.Presence presence) {
        devices.compute(presence.uavCode(), (code, existing) -> new DeviceState(
            code, presence.online(),
            existing == null ? null : existing.lastTelemetry(),
            presence.observedAt()));
    }

    /**
     * Records a sample. Telemetry also implies presence: a device cannot publish while
     * disconnected, so a sample arriving after a missed presence message re-establishes it.
     */
    public void recordTelemetry(DeviceMessages.Telemetry telemetry) {
        devices.compute(telemetry.uavCode(), (code, existing) -> {
            // Out-of-order redelivery must not roll the state backwards.
            if (existing != null && existing.lastTelemetry() != null
                && existing.lastTelemetry().sequence() > telemetry.sequence()) {
                return existing;
            }
            return new DeviceState(code, true, telemetry,
                existing == null ? telemetry.observedAt() : existing.lastPresenceAt());
        });
    }

    public Optional<DeviceState> state(String uavCode) {
        return Optional.ofNullable(devices.get(uavCode));
    }

    public boolean isCommandable(String uavCode) {
        return readiness(uavCode) == Readiness.COMMANDABLE;
    }

    /** The single gate every outbound command passes through. */
    public Readiness readiness(String uavCode) {
        DeviceState state = devices.get(uavCode);
        if (state == null) return Readiness.UNKNOWN_DEVICE;
        if (!state.online()) return Readiness.OFFLINE;

        DeviceMessages.Telemetry latest = state.lastTelemetry();
        if (latest == null) return Readiness.STALE_TELEMETRY;

        Duration budget = latest.airborne() ? AIRBORNE_FRESHNESS : GROUND_FRESHNESS;
        Duration age = Duration.between(latest.observedAt(), clock.instant());
        // A sample stamped in the future is a clock-skew symptom, not freshness. Treat the
        // reading as usable but never let a bad clock widen the budget.
        if (age.isNegative()) return Readiness.COMMANDABLE;
        return age.compareTo(budget) <= 0 ? Readiness.COMMANDABLE : Readiness.STALE_TELEMETRY;
    }

    /** Human-readable reason, used verbatim in the 409 an operator sees. */
    public static String explain(Readiness readiness) {
        return switch (readiness) {
            case COMMANDABLE -> "Device is ready";
            case UNKNOWN_DEVICE -> "No telemetry or presence has ever been received for this device";
            case OFFLINE -> "Device is offline; the command was not queued";
            case STALE_TELEMETRY -> "Device telemetry is stale; refusing to command on an unknown position";
        };
    }

    /** Test and diagnostics hook; the ingest path never removes devices. */
    public void clear() {
        devices.clear();
    }

    public int size() {
        return devices.size();
    }
}
