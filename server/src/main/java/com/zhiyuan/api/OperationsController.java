package com.zhiyuan.api;

import com.zhiyuan.domain.Models;
import com.zhiyuan.service.PlatformStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
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
import org.springframework.web.server.ResponseStatusException;

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
    @PatchMapping("/alerts/{id}/acknowledge") public ApiResponse<Models.Alert> acknowledge(Authentication authentication,@PathVariable long id){return ApiResponse.ok(store.acknowledgeAlert(id,staffId(authentication)));}
    @PatchMapping("/alerts/{id}/resolve") public ApiResponse<Models.Alert> resolve(Authentication authentication,@PathVariable long id){return ApiResponse.ok(store.resolveAlert(id,staffId(authentication)));}
    @GetMapping("/logs") public ApiResponse<PageResponse<Models.AuditLog>> logs(
        @RequestParam(defaultValue="") @Pattern(regexp="|FLIGHT|CONTROL|VOICE") String type,
        @RequestParam(defaultValue="") @Pattern(regexp="|RECORDED|QUEUED|SENT|ACKNOWLEDGED|FAILED|TIMEOUT") String status,
        @RequestParam(required=false) @Positive Long uavId,
        @RequestParam(defaultValue="") String q,
        @RequestParam(defaultValue="1") @Positive int page,
        @RequestParam(defaultValue="20") @Positive @Max(100) int size){PlatformStore.AuditPage result=store.auditLogs(type,status,uavId,q,page,size);return ApiResponse.ok(new PageResponse<>(result.items(),result.page(),result.size(),result.total(),result.totalPages()));}
    @GetMapping("/pods") public ApiResponse<List<Models.Pod>> pods(){return ApiResponse.ok(store.pods());}
    @PatchMapping("/pods/{id}") public ApiResponse<Models.Pod> pod(@PathVariable long id,@Valid @RequestBody PodRequest body){return ApiResponse.ok(store.updatePod(id,body.doorStatus(),body.uavId()));}
    @GetMapping("/device-bindings") public ApiResponse<List<Models.Binding>> bindings(Authentication authentication){long staffId=staffId(authentication);return ApiResponse.ok(isAdmin(authentication)?store.bindings():store.bindings().stream().filter(binding->binding.staffId()==staffId).toList());}
    @PostMapping("/device-bindings") public ApiResponse<Models.Binding> bind(Authentication authentication,@Valid @RequestBody BindingRequest body){long current=staffId(authentication);long target=isAdmin(authentication)?body.staffId():current;return ApiResponse.ok(store.bind(target,body.uavId()));}
    @DeleteMapping("/device-bindings/{id}") public ApiResponse<Void> unbind(Authentication authentication,@PathVariable long id){Models.Binding binding=store.bindings().stream().filter(item->item.id()==id).findFirst().orElseThrow(()->new ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND,"Binding not found"));if(!isAdmin(authentication)&&binding.staffId()!=staffId(authentication))throw new ResponseStatusException(org.springframework.http.HttpStatus.FORBIDDEN,"Cannot revoke another staff member's binding");store.unbind(id);return ApiResponse.ok(null);}

    private static long staffId(Authentication authentication){return Long.parseLong(authentication.getName());}
    private static boolean isAdmin(Authentication authentication){return authentication.getAuthorities().stream().anyMatch(authority->"ROLE_ADMIN".equals(authority.getAuthority()));}
}
