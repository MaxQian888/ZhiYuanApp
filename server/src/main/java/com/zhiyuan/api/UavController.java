package com.zhiyuan.api;

import com.zhiyuan.device.CommandDispatcher;
import com.zhiyuan.device.DeviceRegistry;
import com.zhiyuan.domain.Models;
import com.zhiyuan.realtime.OutboxPublisher;
import com.zhiyuan.realtime.PlatformEventBus;
import com.zhiyuan.service.PlatformStore;
import com.zhiyuan.telemetry.TelemetryArchive;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/v1/uavs")
public class UavController {
    public record CommandRequest(@NotBlank String type, @NotBlank String source, String transcript) {}

    private static final Set<String> COMMAND_TYPES = Set.of("TAKE_OFF", "LAND", "RETURN_HOME", "STOP");
    private static final Set<String> COMMAND_SOURCES = Set.of("MANUAL", "VOICE");

    /** Bounds a history query so one request cannot ask for the whole retention window. */
    private static final long MAX_QUERY_HOURS = 24;

    private final PlatformStore store;
    private final CommandDispatcher dispatcher;
    private final DeviceRegistry registry;
    private final PlatformEventBus bus;
    private final OutboxPublisher publisher;
    private final TelemetryArchive archive;

    public UavController(PlatformStore store, CommandDispatcher dispatcher, DeviceRegistry registry,
                         PlatformEventBus bus, OutboxPublisher publisher, TelemetryArchive archive) {
        this.store = store;
        this.dispatcher = dispatcher;
        this.registry = registry;
        this.bus = bus;
        this.publisher = publisher;
        this.archive = archive;
    }

    @GetMapping
    public ApiResponse<PageResponse<Models.Uav>> list(@RequestParam(defaultValue = "") String q,
                                                      @RequestParam(defaultValue = "") String status,
                                                      @RequestParam(defaultValue = "") String region,
                                                      @RequestParam(defaultValue = "1") int page,
                                                      @RequestParam(defaultValue = "20") int size) {
        store.refreshDevices();
        return ApiResponse.ok(PageResponse.of(store.uavs(q, status, region), page, size));
    }

    @GetMapping("/{id}")
    public ApiResponse<Models.Uav> detail(@PathVariable long id) {
        store.refreshDevices();
        return ApiResponse.ok(store.uav(id));
    }

    @GetMapping("/{id}/flight-logs")
    public ApiResponse<List<Models.FlightLog>> logs(@PathVariable long id) {
        store.uav(id);
        return ApiResponse.ok(store.flightLogs(id));
    }

    /**
     * Whether this device can be commanded right now, and why not if it cannot.
     *
     * <p>Exposed so the console can disable the control buttons instead of letting an
     * operator press one and receive a refusal.
     */
    @GetMapping("/{id}/readiness")
    public ApiResponse<Map<String, Object>> readiness(@PathVariable long id) {
        Models.Uav uav = store.uav(id);
        DeviceRegistry.Readiness readiness = registry.readiness(uav.code());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("uavCode", uav.code());
        body.put("commandable", readiness == DeviceRegistry.Readiness.COMMANDABLE);
        body.put("readiness", readiness.name());
        body.put("reason", DeviceRegistry.explain(readiness));
        registry.state(uav.code()).ifPresent(state -> {
            body.put("online", state.online());
            if (state.lastTelemetry() != null) {
                body.put("observedAt", state.lastTelemetry().observedAt().toString());
            }
        });
        return ApiResponse.ok(body);
    }

    /**
     * Telemetry history.
     *
     * <p>{@code resolution} selects the table explicitly rather than being inferred from the
     * range: a caller that asked for raw data and silently got minute averages would draw
     * the wrong conclusions from a flight review (ADR 0003).
     */
    @GetMapping("/{id}/telemetry")
    public ApiResponse<List<TelemetryArchive.Point>> telemetry(
        @PathVariable long id,
        @RequestParam String from,
        @RequestParam String to,
        @RequestParam(defaultValue = "raw") String resolution) {

        Models.Uav uav = store.uav(id);
        TelemetryArchive.Resolution parsed = switch (resolution.toLowerCase(java.util.Locale.ROOT)) {
            case "raw" -> TelemetryArchive.Resolution.RAW;
            case "1m" -> TelemetryArchive.Resolution.ONE_MINUTE;
            default -> throw new IllegalArgumentException("resolution must be 'raw' or '1m'");
        };

        Instant start = parseInstant(from, "from");
        Instant end = parseInstant(to, "to");
        if (!start.isBefore(end)) throw new IllegalArgumentException("'from' must be before 'to'");
        if (java.time.Duration.between(start, end).toHours() > MAX_QUERY_HOURS) {
            throw new IllegalArgumentException(
                "Range exceeds the " + MAX_QUERY_HOURS + " hour maximum for a single query");
        }

        return ApiResponse.ok(archive.query(uav.code(), start, end, parsed));
    }

    @GetMapping("/commands")
    public ApiResponse<List<Models.ControlCommand>> commands() {
        return ApiResponse.ok(store.commands());
    }

    @GetMapping("/commands/{commandId}")
    public ApiResponse<Models.ControlCommand> command(@PathVariable String commandId) {
        return ApiResponse.ok(store.command(commandId));
    }

    /**
     * Issues one command.
     *
     * <p>Returns 202 once the transport has taken it; the device's answer arrives later on
     * the event stream. A device that is offline or whose telemetry has gone stale is
     * refused with 409 and the command is <b>not</b> queued (ADR 0002).
     */
    @PostMapping("/{id}/commands")
    public ResponseEntity<ApiResponse<Map<String, Object>>> command(
        @PathVariable long id,
        @Valid @RequestBody CommandRequest body,
        @RequestHeader(value = "Idempotency-Key", required = false) @Size(max = 64) String idempotencyKey,
        Authentication authentication) {

        Models.Uav uav = store.uav(id);
        if (!COMMAND_TYPES.contains(body.type())) throw new IllegalArgumentException("Unsupported command");
        if (!COMMAND_SOURCES.contains(body.source())) throw new IllegalArgumentException("Unsupported source");

        Long operatorId = authentication == null ? null : Long.parseLong(authentication.getName());
        CommandDispatcher.Issued issued = dispatcher.issue(uav.code(), uav.id(), body.type(),
            body.source(), body.transcript(), operatorId,
            idempotencyKey == null || idempotencyKey.isBlank() ? null : idempotencyKey.trim());

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("commandId", issued.commandId());
        payload.put("status", issued.receipt().accepted() ? "QUEUED" : "FAILED");
        payload.put("adapter", dispatcher.adapterName());
        payload.put("accepted", issued.receipt().accepted());
        if (issued.receipt().reason() != null) payload.put("reason", issued.receipt().reason());

        return issued.receipt().accepted()
            ? ResponseEntity.accepted().body(ApiResponse.accepted(payload))
            : ResponseEntity.status(HttpStatus.CONFLICT).body(ApiResponse.accepted(payload));
    }

    /**
     * The operator event stream.
     *
     * <p>A reconnecting browser sends {@code Last-Event-ID} automatically; when the bus can
     * still serve the gap it replays only the missed events, and otherwise falls back to a
     * full snapshot. Either way the client ends up correct without refetching everything on
     * every blip.
     */
    @GetMapping("/telemetry/stream")
    public SseEmitter telemetry(
        @RequestHeader(value = "Last-Event-ID", required = false) String lastEventId) {
        try {
            return bus.subscribe(lastEventId, publisher.snapshotEvents());
        } catch (PlatformEventBus.SubscriptionRejectedException atCapacity) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, atCapacity.getMessage());
        }
    }

    private static Instant parseInstant(String value, String field) {
        try {
            return Instant.parse(value);
        } catch (RuntimeException malformed) {
            throw new IllegalArgumentException("'" + field + "' must be an ISO-8601 instant");
        }
    }
}
