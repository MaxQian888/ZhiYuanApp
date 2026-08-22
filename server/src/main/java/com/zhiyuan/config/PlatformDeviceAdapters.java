package com.zhiyuan.config;

import com.zhiyuan.device.CommandJournal;
import com.zhiyuan.device.DeviceMessages;
import com.zhiyuan.device.DeviceRoster;
import com.zhiyuan.domain.Models;
import com.zhiyuan.service.PlatformStore;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.ZoneOffset;

/**
 * Binds the device layer's outbound ports to the service layer.
 *
 * <p>Kept here rather than as annotations on the implementations so
 * {@code com.zhiyuan.device} never imports {@code com.zhiyuan.service}. The dependency runs
 * one way: the device link knows nothing about orders, tasks or audit trails, and can be
 * tested without any of them.
 */
@Configuration
public class PlatformDeviceAdapters {

    /**
     * Presents the persisted fleet to the simulator.
     *
     * <p>Real adapters never use this — production devices announce themselves by
     * connecting, and the platform learns of them from the wire.
     */
    @Bean
    public DeviceRoster deviceRoster(PlatformStore store) {
        return () -> store.devices().stream()
            .map(uav -> new DeviceRoster.Entry(uav.code(), uav.status(), uav.battery(),
                uav.latitude(), uav.longitude(), uav.altitude(), uav.speed()))
            .toList();
    }

    @Bean
    public CommandJournal commandJournal(PlatformStore store) {
        return new PlatformCommandJournal(store);
    }

    /** Writes command lifecycle events into the platform's audit trail. */
    record PlatformCommandJournal(PlatformStore store) implements CommandJournal {

        @Override
        public void recordQueued(DeviceMessages.Command command, long uavId, String transcript) {
            store.saveCommand(new Models.ControlCommand(command.commandId(), uavId, command.type(),
                    "QUEUED", command.source(), transcript,
                    command.issuedAt().atOffset(ZoneOffset.ofHours(8)).withNano(0)),
                command.operatorId() == null ? 1 : command.operatorId());
        }

        @Override
        public void recordStatus(String commandId, String status) {
            store.commandStatus(commandId, status);
        }

        @Override
        public void recordAcknowledged(String commandId, String event, String detail) {
            store.acknowledgeCommand(commandId, event, detail);
        }
    }
}
