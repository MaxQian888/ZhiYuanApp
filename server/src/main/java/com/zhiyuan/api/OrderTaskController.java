package com.zhiyuan.api;

import com.zhiyuan.domain.Models;
import com.zhiyuan.service.PlatformStore;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1")
public class OrderTaskController {
    public record DispatchRequest(@Positive long uavId){}
    public record FailureRequest(@NotBlank String reason){}
    public record OrderItemRequest(@Positive long goodsId,@Positive int count){}
    public record OrderRequest(@Positive long userId,@Positive long addressId,@NotEmpty List<@Valid OrderItemRequest> items){}

    private final PlatformStore store;

    public OrderTaskController(PlatformStore store){this.store=store;}

    @GetMapping("/orders") public ApiResponse<PageResponse<Models.Order>> orders(@RequestParam(defaultValue="")String status,@RequestParam(defaultValue="1")int page,@RequestParam(defaultValue="20")int size){return ApiResponse.ok(PageResponse.of(store.orders(status),page,size));}

    @GetMapping("/orders/{id}") public ApiResponse<Models.Order> order(@PathVariable long id){return ApiResponse.ok(store.order(id));}

    /** Every stock movement behind this order, oldest first. */
    @GetMapping("/orders/{id}/inventory-ledger") public ApiResponse<List<Models.LedgerEntry>> ledger(@PathVariable long id){return ApiResponse.ok(store.inventoryLedger(id));}

    /** Who moved this order between states, when, and why. */
    @GetMapping("/orders/{id}/history") public ApiResponse<List<Models.OrderStatusChange>> history(@PathVariable long id){return ApiResponse.ok(store.orderHistory(id));}

    /**
     * Creates an order and reserves its stock.
     *
     * <p>{@code Idempotency-Key} is optional so v1 clients that predate it keep working
     * (ADR 0004); new clients must send one. Replaying a key returns the original order
     * instead of creating a second one, and replaying it with a different body is a 409.
     */
    @PostMapping("/orders")
    public ApiResponse<Models.Order> createOrder(
        @Valid @RequestBody OrderRequest body,
        @RequestHeader(value = "Idempotency-Key", required = false) @Size(max = 64) String idempotencyKey,
        Authentication authentication) {
        return ApiResponse.ok(store.createOrder(body.userId(), body.addressId(),
            body.items().stream().map(item -> new PlatformStore.OrderLine(item.goodsId(), item.count())).toList(),
            operatorId(authentication), normalise(idempotencyKey)));
    }

    @PostMapping("/orders/{id}/dispatch")
    public ApiResponse<Models.Task> dispatch(@PathVariable long id, @Valid @RequestBody DispatchRequest body,
                                             Authentication authentication) {
        return ApiResponse.ok(store.dispatch(id, body.uavId(), operatorId(authentication)));
    }

    @PostMapping("/orders/{id}/cancel")
    public ApiResponse<Models.Order> cancel(@PathVariable long id, Authentication authentication) {
        return ApiResponse.ok(store.cancelOrder(id, operatorId(authentication)));
    }

    @GetMapping("/tasks") public ApiResponse<PageResponse<Models.Task>> tasks(@RequestParam(defaultValue="")String status,@RequestParam(defaultValue="1")int page,@RequestParam(defaultValue="20")int size){return ApiResponse.ok(PageResponse.of(store.tasks(status),page,size));}

    @PostMapping("/tasks/{id}/start")
    public ApiResponse<Models.Task> start(@PathVariable long id, Authentication authentication) {
        return ApiResponse.ok(store.transitionTask(id, "FLYING", null, operatorId(authentication)));
    }

    @PostMapping("/tasks/{id}/arrive")
    public ApiResponse<Models.Task> arrive(@PathVariable long id, Authentication authentication) {
        return ApiResponse.ok(store.transitionTask(id, "ARRIVED", null, operatorId(authentication)));
    }

    @PostMapping("/tasks/{id}/fail")
    public ApiResponse<Models.Task> fail(@PathVariable long id, @Valid @RequestBody FailureRequest body,
                                         Authentication authentication) {
        return ApiResponse.ok(store.transitionTask(id, "FAILED", body.reason(), operatorId(authentication)));
    }

    private static Long operatorId(Authentication authentication) {
        return authentication == null ? null : Long.parseLong(authentication.getName());
    }

    /** A blank header is the same as no header; it must not become an idempotency scope of "". */
    private static String normalise(String idempotencyKey) {
        return idempotencyKey == null || idempotencyKey.isBlank() ? null : idempotencyKey.trim();
    }
}
