package com.zhiyuan.api;

import com.zhiyuan.domain.Models;
import com.zhiyuan.service.PlatformStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1")
public class OperationsController {
    public record PodRequest(@NotBlank String doorStatus, Long uavId) {}
    public record BindingRequest(long staffId, long uavId) {}
    private final PlatformStore store;
    public OperationsController(PlatformStore store){this.store=store;}

    @GetMapping("/dashboard") public ApiResponse<Models.Dashboard> dashboard(){return ApiResponse.ok(store.dashboard());}
    @GetMapping("/search") public ApiResponse<List<java.util.Map<String,Object>>> search(@RequestParam String q){return ApiResponse.ok(store.search(q));}
    @GetMapping("/alerts") public ApiResponse<List<Models.Alert>> alerts(@RequestParam(defaultValue="") String level){return ApiResponse.ok(store.alerts(level));}
    @PatchMapping("/alerts/{id}/resolve") public ApiResponse<Models.Alert> resolve(@PathVariable long id){return ApiResponse.ok(store.resolveAlert(id));}
    @GetMapping("/pods") public ApiResponse<List<Models.Pod>> pods(){return ApiResponse.ok(store.pods());}
    @PatchMapping("/pods/{id}") public ApiResponse<Models.Pod> pod(@PathVariable long id,@Valid @RequestBody PodRequest body){return ApiResponse.ok(store.updatePod(id,body.doorStatus(),body.uavId()));}
    @GetMapping("/device-bindings") public ApiResponse<List<Models.Binding>> bindings(){return ApiResponse.ok(store.bindings());}
    @PostMapping("/device-bindings") public ApiResponse<Models.Binding> bind(@Valid @RequestBody BindingRequest body){return ApiResponse.ok(store.bind(body.staffId(),body.uavId()));}
    @DeleteMapping("/device-bindings/{id}") public ApiResponse<Void> unbind(@PathVariable long id){store.unbind(id);return ApiResponse.ok(null);}
}
