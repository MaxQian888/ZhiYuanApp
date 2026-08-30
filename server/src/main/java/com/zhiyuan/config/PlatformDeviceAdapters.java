package com.zhiyuan.config;

import com.zhiyuan.device.CommandJournal;
import com.zhiyuan.device.DeviceMessages;
import com.zhiyuan.device.DeviceRoster;
import com.zhiyuan.domain.Models;
import com.zhiyuan.service.PlatformStore;
import com.zhiyuan.persistence.PlatformDatabase;
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
    public CommandJournal commandJournal(PlatformStore store, PlatformDatabase database) {
        return new PlatformCommandJournal(store, database);
    }

    /** Writes command lifecycle events into the platform's audit trail. */
    record PlatformCommandJournal(PlatformStore store, PlatformDatabase database) implements CommandJournal {

        private static final String SCOPE = "uav.commands";

        @Override
        public Reservation reserve(DeviceMessages.Command command, long uavId, String transcript,
                                   String requestFingerprint, String idempotencyKey) {
            Models.ControlCommand model = new Models.ControlCommand(command.commandId(), uavId,
                command.type(), "QUEUED", command.source(), transcript,
                command.issuedAt().atOffset(ZoneOffset.ofHours(8)).withNano(0));
            PlatformDatabase.CommandReservation reserved = database.reserveCommand(model,
                command.operatorId() == null ? 1 : command.operatorId(), command.expiresAt(), SCOPE,
                idempotencyKey, requestFingerprint);
            if (reserved.created()) store.cacheCommand(model);
            DeviceMessages.DispatchReceipt receipt = reserved.accepted() == null ? null
                : reserved.accepted()
                    ? DeviceMessages.DispatchReceipt.accepted(reserved.commandId(), reserved.adapter(),
                        java.time.Instant.now())
                    : DeviceMessages.DispatchReceipt.rejected(reserved.commandId(), reserved.adapter(),
                        java.time.Instant.now(), reserved.reason());
            return new Reservation(reserved.created(), reserved.commandId(), receipt);
        }

        @Override
        public void recordDispatch(String commandId, DeviceMessages.DispatchReceipt receipt) {
            database.recordCommandDispatch(commandId, receipt.accepted(), receipt.adapter(), receipt.reason());
            store.cacheDispatchStatus(commandId, receipt.accepted() ? "SENT" : "FAILED");
        }

        @Override
        public java.util.List<Recovery> recoverable() {
            return database.recoverableCommands().stream()
                .map(item -> new Recovery(item.commandId(), item.type(), item.source(), item.expiresAt()))
                .toList();
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
