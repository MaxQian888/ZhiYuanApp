package com.zhiyuan.api;

import com.zhiyuan.domain.Models;
import com.zhiyuan.service.PlatformStore;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class OrderTaskController {
    public record DispatchRequest(long uavId){}
    public record FailureRequest(String reason){}
    private final PlatformStore store;
    public OrderTaskController(PlatformStore store){this.store=store;}
    @GetMapping("/orders") public ApiResponse<PageResponse<Models.Order>> orders(@RequestParam(defaultValue="")String status,@RequestParam(defaultValue="1")int page,@RequestParam(defaultValue="20")int size){return ApiResponse.ok(PageResponse.of(store.orders(status),page,size));}
    @GetMapping("/orders/{id}") public ApiResponse<Models.Order> order(@PathVariable long id){return ApiResponse.ok(store.order(id));}
    @PostMapping("/orders/{id}/dispatch") public ApiResponse<Models.Task> dispatch(@PathVariable long id,@Valid @RequestBody DispatchRequest body){return ApiResponse.ok(store.dispatch(id,body.uavId()));}
    @PostMapping("/orders/{id}/cancel") public ApiResponse<Models.Order> cancel(@PathVariable long id){return ApiResponse.ok(store.transitionOrder(id,"CANCELLED"));}
    @GetMapping("/tasks") public ApiResponse<PageResponse<Models.Task>> tasks(@RequestParam(defaultValue="")String status,@RequestParam(defaultValue="1")int page,@RequestParam(defaultValue="20")int size){return ApiResponse.ok(PageResponse.of(store.tasks(status),page,size));}
    @PostMapping("/tasks/{id}/start") public ApiResponse<Models.Task> start(@PathVariable long id){return ApiResponse.ok(store.transitionTask(id,"FLYING"));}
    @PostMapping("/tasks/{id}/arrive") public ApiResponse<Models.Task> arrive(@PathVariable long id){return ApiResponse.ok(store.transitionTask(id,"ARRIVED"));}
    @PostMapping("/tasks/{id}/fail") public ApiResponse<Models.Task> fail(@PathVariable long id,@RequestBody(required=false) FailureRequest body){return ApiResponse.ok(store.transitionTask(id,"FAILED"));}
}
