package com.zhiyuan.device;

import java.util.List;

/**
 * The devices the platform knows about, as the simulator needs to see them.
 *
 * <p>Exists so {@link SimulatorUavAdapter} can synthesise telemetry without importing the
 * service layer. Real adapters never call this — a production device announces itself by
 * connecting, and the platform learns about it from the wire, not from a table.
 */
public interface DeviceRoster {

    record Entry(String uavCode, String status, int battery, double latitude, double longitude,
                 double altitude, double speed) {}

    List<Entry> devices();
}
