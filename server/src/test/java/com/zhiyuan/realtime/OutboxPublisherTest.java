package com.zhiyuan.realtime;

import com.zhiyuan.device.DeviceIngestRepository;
import com.zhiyuan.domain.Models;
import com.zhiyuan.service.PlatformStore;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.time.OffsetDateTime;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OutboxPublisherTest {

    private final DeviceIngestRepository repository = mock(DeviceIngestRepository.class);
    private final PlatformEventTransport transport = mock(PlatformEventTransport.class);
    private final PlatformStore store = mock(PlatformStore.class);
    private final BackgroundFailureReporter backgroundFailures = new BackgroundFailureReporter();
    private final Clock clock = Clock.fixed(Instant.parse("2026-08-30T01:30:00Z"), ZoneOffset.UTC);
    private final OutboxPublisher publisher = new OutboxPublisher(
        repository, transport, store, new ObjectMapper().registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS),
        backgroundFailures, clock, 200, 30, 24, 30, false);

    @AfterEach
    void stopPublisher() {
        publisher.stop();
    }

    @Test
    void publishesModelsContainingJavaTimeValuesBeforeAcknowledgingTheirRows() {
        Models.Uav uav = new Models.Uav(1, "UAV-01", "One", "RFID-1", "M1", "ZhiYuan",
            "FLYING", 80, false, "Nanjing", 30, 12, 32.06, 118.78,
            OffsetDateTime.of(2026, 8, 30, 9, 30, 0, 0, ZoneOffset.ofHours(8)));
        when(repository.claimOutbox(anyString(), any(), eq(Duration.ofSeconds(30)), eq(500)))
            .thenReturn(List.of(
            new DeviceIngestRepository.OutboxRow(11, "uav.telemetry", "UAV-01", "{}")));
        when(repository.markPublished(anyString(), eq(List.of(11L)))).thenReturn(1);
        when(store.uavs("", "", "")).thenReturn(List.of(uav));

        assertThat(publisher.drain()).isEqualTo(1);

        verify(transport).broadcast(eq("telemetry-delta"), eq("telemetry-delta"),
            org.mockito.ArgumentMatchers.contains("2026-08-30T09:30:00+08:00"));
        verify(repository).markPublished(anyString(), eq(List.of(11L)));
    }

    @Test
    void serializesUavAlertAndTaskSnapshotsWithRealOffsetDateTimes() {
        OffsetDateTime occurredAt = OffsetDateTime.of(
            2026, 8, 30, 9, 30, 0, 0, ZoneOffset.ofHours(8));
        Models.Uav uav = new Models.Uav(1, "UAV-01", "One", "RFID-1", "M1", "ZhiYuan",
            "FLYING", 80, false, "Nanjing", 30, 12, 32.06, 118.78, occurredAt);
        Models.Alert alert = new Models.Alert(2, 1L, null, "Wind", "HIGH", occurredAt,
            false, "OPEN", null, null, null, null);
        Models.Task task = new Models.Task(3, 4, 1, "FLYING", occurredAt, null, null);
        when(store.uavs("", "", "")).thenReturn(List.of(uav));
        when(store.alerts("")).thenReturn(List.of(alert));
        when(store.tasks("")).thenReturn(List.of(task));

        publisher.resync();

        verify(transport).broadcast(eq("telemetry"), eq("telemetry"),
            org.mockito.ArgumentMatchers.contains("2026-08-30T09:30:00+08:00"));
        verify(transport).broadcast(eq("alert"), eq("alert"),
            org.mockito.ArgumentMatchers.contains("2026-08-30T09:30:00+08:00"));
        verify(transport).broadcast(eq("task-status"), eq("task-status"),
            org.mockito.ArgumentMatchers.contains("2026-08-30T09:30:00+08:00"));
    }

    @Test
    void acknowledgesOnlyEventGroupsWhoseBroadcastSucceeded() {
        when(repository.claimOutbox(anyString(), any(), eq(Duration.ofSeconds(30)), eq(500)))
            .thenReturn(List.of(
            new DeviceIngestRepository.OutboxRow(21, "alert", "A-21", "{\"ok\":true}"),
            new DeviceIngestRepository.OutboxRow(22, "task-status", "T-22", "{\"ok\":false}")));
        when(repository.markPublished(anyString(), eq(List.of(21L)))).thenReturn(1);
        doThrow(new IllegalStateException("transport unavailable"))
            .when(transport).broadcast("task-status", "T-22", "{\"ok\":false}");

        assertThat(publisher.drain()).isEqualTo(1);

        verify(repository).markPublished(anyString(), eq(List.of(21L)));
        verify(repository).markFailed(anyString(), eq(List.of(
            new DeviceIngestRepository.OutboxRow(22, "task-status", "T-22", "{\"ok\":false}"))),
            eq(Instant.parse("2026-08-30T01:30:00Z")));
    }
}
