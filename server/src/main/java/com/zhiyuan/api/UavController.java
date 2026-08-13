package com.zhiyuan.api;

import com.zhiyuan.domain.Models;
import com.zhiyuan.service.PlatformStore;
import com.zhiyuan.uav.UavAdapter;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/v1/uavs")
public class UavController {
    public record CommandRequest(@NotBlank String type, @NotBlank String source, String transcript) {}
    private final PlatformStore store;
    private final UavAdapter adapter;

    public UavController(PlatformStore store, UavAdapter adapter) { this.store=store; this.adapter=adapter; }

    @GetMapping
    public ApiResponse<PageResponse<Models.Uav>> list(@RequestParam(defaultValue="") String q,@RequestParam(defaultValue="") String status,@RequestParam(defaultValue="") String region,@RequestParam(defaultValue="1") int page,@RequestParam(defaultValue="20") int size) { return ApiResponse.ok(PageResponse.of(store.uavs(q,status,region),page,size)); }
    @GetMapping("/{id}") public ApiResponse<Models.Uav> detail(@PathVariable long id){return ApiResponse.ok(store.uav(id));}
    @GetMapping("/{id}/flight-logs") public ApiResponse<List<Models.FlightLog>> logs(@PathVariable long id){store.uav(id);return ApiResponse.ok(store.flightLogs(id));}
    @GetMapping("/commands") public ApiResponse<List<Models.ControlCommand>> commands(){return ApiResponse.ok(store.commands());}
    @GetMapping("/commands/{commandId}") public ApiResponse<Models.ControlCommand> command(@PathVariable String commandId){return ApiResponse.ok(store.command(commandId));}

    @PostMapping("/{id}/commands")
    public ResponseEntity<ApiResponse<Map<String,Object>>> command(@PathVariable long id,@Valid @RequestBody CommandRequest body,Authentication authentication){
        store.uav(id);
        if(!Set.of("TAKE_OFF","LAND","RETURN_HOME","STOP").contains(body.type()))throw new IllegalArgumentException("Unsupported command");
        if(!Set.of("MANUAL","VOICE").contains(body.source()))throw new IllegalArgumentException("Unsupported source");
        String commandId=UUID.randomUUID().toString();
        Models.ControlCommand command=new Models.ControlCommand(commandId,id,body.type(),"QUEUED",body.source(),body.transcript(),OffsetDateTime.now(ZoneOffset.ofHours(8)).withNano(0));
        long operatorId = authentication == null ? 1 : Long.parseLong(authentication.getName());
        store.saveCommand(command, operatorId);
        store.commandStatus(commandId,"SENT");
        adapter.send(id,body.type()).orTimeout(8,TimeUnit.SECONDS).whenComplete((status,error)->store.commandStatus(commandId,error==null?status:"TIMEOUT"));
        return ResponseEntity.accepted().body(ApiResponse.accepted(Map.of("commandId",commandId,"status","QUEUED","adapter",adapter.providerName())));
    }

    @GetMapping("/telemetry/stream")
    public SseEmitter telemetry(){
        SseEmitter emitter=new SseEmitter(0L);
        var scheduler=Executors.newSingleThreadScheduledExecutor();
        Runnable send=()->{try{
            emitter.send(SseEmitter.event().name("telemetry").data(store.uavs("", "", "")));
            emitter.send(SseEmitter.event().name("alert").data(store.alerts("")));
            emitter.send(SseEmitter.event().name("command-status").data(store.commands()));
            emitter.send(SseEmitter.event().name("task-status").data(store.tasks("")));
            emitter.send(SseEmitter.event().name("heartbeat").data(Map.of("at",OffsetDateTime.now(ZoneOffset.UTC))));
        }catch(IOException exception){scheduler.shutdown();emitter.complete();}};
        scheduler.scheduleAtFixedRate(send,0,5,TimeUnit.SECONDS);
        emitter.onCompletion(scheduler::shutdown); emitter.onTimeout(scheduler::shutdown); emitter.onError(error->scheduler.shutdown());
        return emitter;
    }
}
