package com.zhiyuan.device;

import jakarta.annotation.PreDestroy;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * In-process stand-in for the device fleet.
 *
 * <p>It emits telemetry on the same cadence real devices do, so the freshness gate in
 * {@link DeviceRegistry} behaves identically in simulator mode — if it did not, every
 * command would be refused here and the simulator would stop being a useful preview.
 *
 * <p>Commands are acknowledged after a short delay to exercise the asynchronous path. It
 * deliberately does <em>not</em> shortcut straight to a terminal state inside
 * {@link #dispatch}: the dispatch receipt and the acknowledgement are separate events in
 * production and must be separate here too.
 */
public class SimulatorUavAdapter implements UavAdapter {

    /** Airborne devices publish at 5 Hz in production; 1 Hz is plenty to stay inside the gate. */
    private static final long TELEMETRY_PERIOD_MILLIS = 1_000;

    private static final long ACK_DELAY_MILLIS = 450;

    private final DeviceRoster roster;
    private final Clock clock;
    private final List<DeviceEventListener> listeners = new CopyOnWriteArrayList<>();
    private final AtomicLong sequence = new AtomicLong();
    private final Random jitter = new Random(20260822L);

    /** Several components listen; the fleet must still tick exactly once per period. */
    private final java.util.concurrent.atomic.AtomicBoolean started =
        new java.util.concurrent.atomic.AtomicBoolean();

    /**
     * One scheduler for the whole simulated fleet. Per-device threads would not survive
     * 500 devices, and the same reasoning applies to the SSE fan-out.
     */
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(
        runnable -> {
            Thread thread = new Thread(runnable, "uav-simulator");
            thread.setDaemon(true);
            return thread;
        });

    public SimulatorUavAdapter(DeviceRoster roster) {
        this(roster, Clock.systemUTC());
    }

    public SimulatorUavAdapter(DeviceRoster roster, Clock clock) {
        this.roster = roster;
        this.clock = clock;
    }

    @Override
    public String providerName() {
        return "SIMULATOR";
    }

    @Override
    public void subscribe(DeviceEventListener listener) {
        listeners.add(listener);
        // Announce the fleet immediately so the first command does not have to wait a tick
        // for the device to become commandable.
        publishPresence(true);
        publishTelemetry();
        if (started.compareAndSet(false, true)) {
            scheduler.scheduleAtFixedRate(this::publishTelemetry, TELEMETRY_PERIOD_MILLIS,
                TELEMETRY_PERIOD_MILLIS, TimeUnit.MILLISECONDS);
        }
    }

    @Override
    public DeviceMessages.DispatchReceipt dispatch(DeviceMessages.Command command) {
        Instant now = clock.instant();
        if (command.expired(now)) {
            return DeviceMessages.DispatchReceipt.rejected(command.commandId(), providerName(), now,
                "Command expired before it reached the transport");
        }

        scheduler.schedule(() -> emit(new DeviceMessages.CommandAck(
            DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), command.uavCode(),
            sequence.incrementAndGet(), clock.instant(), command.commandId(), "EXECUTED",
            "simulated")), ACK_DELAY_MILLIS, TimeUnit.MILLISECONDS);

        return DeviceMessages.DispatchReceipt.accepted(command.commandId(), providerName(), now);
    }

    /** Drives one telemetry round for every rostered device. */
    public void publishTelemetry() {
        Instant now = clock.instant();
        for (DeviceRoster.Entry device : roster.devices()) {
            if ("OFFLINE".equals(device.status())) continue;
            double drift = device.speed() == 0 ? 0 : (jitter.nextDouble() - 0.5) / 5_000;
            emit(new DeviceMessages.Telemetry(
                DeviceMessages.SCHEMA_VERSION, UUID.randomUUID().toString(), device.uavCode(),
                sequence.incrementAndGet(), now, device.status(), device.battery(),
                device.latitude() + drift, device.longitude() + drift, device.altitude(),
                device.speed()));
        }
    }

    public void publishPresence(boolean online) {
        Instant now = clock.instant();
        for (DeviceRoster.Entry device : roster.devices()) {
            emit(new DeviceMessages.Presence(DeviceMessages.SCHEMA_VERSION,
                UUID.randomUUID().toString(), device.uavCode(), sequence.incrementAndGet(), now,
                online && !"OFFLINE".equals(device.status())));
        }
    }

    private void emit(DeviceMessages.Telemetry telemetry) {
        listeners.forEach(listener -> listener.onTelemetry(telemetry));
    }

    private void emit(DeviceMessages.Presence presence) {
        listeners.forEach(listener -> listener.onPresence(presence));
    }

    private void emit(DeviceMessages.CommandAck ack) {
        listeners.forEach(listener -> listener.onCommandAck(ack));
    }

    @PreDestroy
    public void stop() {
        scheduler.shutdownNow();
    }
}
