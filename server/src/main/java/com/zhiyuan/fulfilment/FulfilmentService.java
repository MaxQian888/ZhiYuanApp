package com.zhiyuan.fulfilment;

import com.zhiyuan.domain.Models;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.Set;

/**
 * Order, inventory and task rules for the whole platform.
 *
 * <p>This is the one place that knows what a reservation means. The three stock numbers
 * defined in CONTEXT.md move together here and nowhere else:
 *
 * <pre>
 *   create   available -n, reserved +n   claim it
 *   cancel   available +n, reserved -n   give it back
 *   arrive   available  0, reserved -n   redeem it; the goods have physically left
 *   fail     available  0, reserved  0   hold the claim so the order can be re-dispatched
 * </pre>
 *
 * <p>Each public method is one transaction. Nothing here branches on which
 * {@link FulfilmentStore} is underneath — that was the point of extracting it.
 */
public class FulfilmentService {
    /** Beijing time; order numbers are read by operators, so they are local-dated. */
    private static final ZoneOffset OFFSET = ZoneOffset.ofHours(8);
    private static final DateTimeFormatter ORDER_DATE = DateTimeFormatter.ofPattern("yyyyMMdd");

    static final String CREATE_ORDER_SCOPE = "orders.create";

    private static final Map<String, Set<String>> ORDER_TRANSITIONS = Map.of(
        "CREATED", Set.of("DISPATCHING", "CANCELLED"),
        "DISPATCHING", Set.of("DELIVERING", "CANCELLED", "ERROR"),
        "DELIVERING", Set.of("FINISHED", "ERROR"),
        "ERROR", Set.of("DISPATCHING", "CANCELLED"),
        "FINISHED", Set.of(),
        "CANCELLED", Set.of());

    private static final Map<String, Set<String>> TASK_TRANSITIONS = Map.of(
        "WAITING", Set.of("FLYING", "FAILED"),
        "FLYING", Set.of("ARRIVED", "FAILED"),
        "ARRIVED", Set.of(),
        "FAILED", Set.of());

    /** Statuses whose stock is still reserved rather than consumed or released. */
    private static final Set<String> HOLDS_RESERVATION =
        Set.of("CREATED", "DISPATCHING", "DELIVERING", "ERROR");

    private final FulfilmentStore store;

    public FulfilmentService(FulfilmentStore store) {
        this.store = store;
    }

    /**
     * Creates an order and reserves its stock in one transaction.
     *
     * <p>{@code idempotencyKey} may be null — v1 clients that predate the header keep
     * working (ADR 0004), they simply lose replay protection.
     */
    public Models.Order createOrder(long userId, long addressId, List<OrderLine> lines,
                                    Long operatorId, String idempotencyKey) {
        List<OrderLine> merged = mergeLines(lines);
        String fingerprint = fingerprint(userId, addressId, merged);

        return store.inTransaction(() -> {
            if (idempotencyKey != null) {
                Optional<String> replayed =
                    store.replayedResult(CREATE_ORDER_SCOPE, idempotencyKey, fingerprint);
                if (replayed.isPresent()) {
                    // Return the original order rather than creating a second one.
                    return order(Long.parseLong(replayed.get()));
                }
            }

            Models.User customer = store.user(userId)
                .orElseThrow(() -> new NoSuchElementException("Customer not found"));
            if (!customer.enabled()) throw new FulfilmentConflictException("Customer is disabled");
            Models.Address address = customer.addresses().stream()
                .filter(candidate -> candidate.id() == addressId)
                .findFirst()
                .orElseThrow(() -> new NoSuchElementException("Address not found"));

            BigDecimal total = BigDecimal.ZERO;
            for (OrderLine line : merged) {
                Models.Goods goods = store.goods(line.goodsId())
                    .orElseThrow(() -> new NoSuchElementException("Goods not found"));
                if (goods.status() != 1) {
                    throw new FulfilmentConflictException("Goods '" + goods.name() + "' is delisted");
                }
                total = total.add(goods.price().multiply(BigDecimal.valueOf(line.count())));
            }

            long orderId = store.insertOrder(userId, addressId,
                new Models.AddressSnapshot(address.receiverName(), address.receiverPhone(), address.detail()),
                total, merged, nextOrderNo());

            for (OrderLine line : merged) {
                reserve(line, orderId, operatorId, idempotencyKey);
            }
            store.transitionOrder(orderId, 0, null, "CREATED", operatorId, "created");

            if (idempotencyKey != null) {
                store.rememberResult(CREATE_ORDER_SCOPE, idempotencyKey, fingerprint,
                    String.valueOf(orderId));
            }
            return order(orderId);
        });
    }

    /** Releases every reservation the order still holds and fails any active task. */
    public Models.Order cancelOrder(long orderId, Long operatorId, String reason) {
        return store.inTransaction(() -> {
            Models.Order current = order(orderId);
            requireOrderTransition(current.status(), "CANCELLED");

            if (HOLDS_RESERVATION.contains(current.status())) {
                for (Models.OrderItem item : current.items()) {
                    release(item, orderId, operatorId);
                }
            }

            store.taskForOrder(orderId)
                .filter(task -> Set.of("WAITING", "FLYING").contains(task.taskStatus()))
                .ifPresent(task -> store.updateTaskStatus(task.id(), "FAILED", "order cancelled"));

            commit(current, "CANCELLED", operatorId, reason == null ? "cancelled" : reason);
            return order(orderId);
        });
    }

    /**
     * Points an order at a device. Re-dispatching a failed task reuses the same task row,
     * which is why an order and a task stay one-to-one (CONTEXT.md §3).
     */
    public Models.Task dispatchOrder(long orderId, long uavId, Long operatorId) {
        return store.inTransaction(() -> {
            if (!store.uavExists(uavId)) throw new NoSuchElementException("UAV not found");
            Models.Order current = order(orderId);
            requireOrderTransition(current.status(), "DISPATCHING");

            store.taskForOrder(orderId).ifPresent(task -> {
                if (!"FAILED".equals(task.taskStatus())) {
                    throw new FulfilmentConflictException("Order already has an active task");
                }
            });

            long taskId = store.assignTask(orderId, uavId);
            commit(current, "DISPATCHING", operatorId, "dispatched to uav " + uavId);
            return store.task(taskId).orElseThrow(() -> new NoSuchElementException("Task not found"));
        });
    }

    /**
     * Moves a task, and mirrors the consequence onto its order and its reservations.
     *
     * <p>{@code ARRIVED} is the only transition that consumes stock: the goods have
     * physically left the warehouse. {@code FAILED} deliberately leaves the reservation
     * standing so the order can be re-dispatched without re-reserving.
     */
    public Models.Task transitionTask(long taskId, String target, String failureReason,
                                      Long operatorId) {
        return store.inTransaction(() -> {
            Models.Task task = store.task(taskId)
                .orElseThrow(() -> new NoSuchElementException("Task not found"));
            if (!TASK_TRANSITIONS.getOrDefault(task.taskStatus(), Set.of()).contains(target)) {
                throw new FulfilmentConflictException(
                    "Illegal task transition " + task.taskStatus() + " -> " + target);
            }

            Models.Order current = order(task.orderId());
            String orderTarget = switch (target) {
                case "FLYING" -> "DELIVERING";
                case "ARRIVED" -> "FINISHED";
                default -> "ERROR";
            };
            requireOrderTransition(current.status(), orderTarget);

            if ("ARRIVED".equals(target)) {
                for (Models.OrderItem item : current.items()) {
                    consume(item, current.id(), operatorId);
                }
            }

            store.updateTaskStatus(taskId, target, "FAILED".equals(target) ? failureReason : null);
            commit(current, orderTarget, operatorId,
                "FAILED".equals(target) ? failureReason : "task " + target.toLowerCase(Locale.ROOT));
            return store.task(taskId).orElseThrow(() -> new NoSuchElementException("Task not found"));
        });
    }

    public List<Models.LedgerEntry> ledger(long orderId) {
        return store.ledgerForOrder(orderId);
    }

    public List<Models.OrderStatusChange> history(long orderId) {
        return store.historyForOrder(orderId);
    }

    // ------------------------------------------------------------- internals

    private void reserve(OrderLine line, long orderId, Long operatorId, String idempotencyKey) {
        if (!store.applyInventory(line.goodsId(), -line.count(), line.count(), "RESERVE",
            orderId, operatorId, idempotencyKey)) {
            throw new FulfilmentConflictException("Insufficient stock for goods " + line.goodsId());
        }
    }

    private void release(Models.OrderItem item, long orderId, Long operatorId) {
        if (!store.applyInventory(item.goodsId(), item.count(), -item.count(), "RELEASE",
            orderId, operatorId, null)) {
            throw new FulfilmentConflictException(
                "Reservation for goods " + item.goodsId() + " is already gone");
        }
    }

    private void consume(Models.OrderItem item, long orderId, Long operatorId) {
        if (!store.applyInventory(item.goodsId(), 0, -item.count(), "CONSUME",
            orderId, operatorId, null)) {
            throw new FulfilmentConflictException(
                "Reservation for goods " + item.goodsId() + " is already gone");
        }
    }

    private Models.Order order(long orderId) {
        return store.order(orderId).orElseThrow(() -> new NoSuchElementException("Order not found"));
    }

    private void requireOrderTransition(String from, String to) {
        if (!ORDER_TRANSITIONS.getOrDefault(from, Set.of()).contains(to)) {
            throw new FulfilmentConflictException("Illegal order transition " + from + " -> " + to);
        }
    }

    /** Applies the status change under the version the caller read, or reports the race. */
    private void commit(Models.Order current, String target, Long operatorId, String reason) {
        if (!store.transitionOrder(current.id(), current.version(), current.status(), target,
            operatorId, reason)) {
            throw new FulfilmentConflictException(
                "Order " + current.id() + " changed while this request was in flight");
        }
    }

    /**
     * Collapses duplicate product lines. Without this, {@code [{1,2},{1,3}]} would reserve
     * twice and price twice, and the ledger would carry two rows for one intent.
     */
    private static List<OrderLine> mergeLines(List<OrderLine> lines) {
        if (lines == null || lines.isEmpty()) {
            throw new IllegalArgumentException("An order needs at least one line");
        }
        Map<Long, Integer> totals = new LinkedHashMap<>();
        for (OrderLine line : lines) {
            totals.merge(line.goodsId(), line.count(), Integer::sum);
        }
        return totals.entrySet().stream()
            .map(entry -> new OrderLine(entry.getKey(), entry.getValue()))
            .toList();
    }

    private static String nextOrderNo() {
        return "ZY-" + OffsetDateTime.now(OFFSET).format(ORDER_DATE) + "-"
            + java.util.UUID.randomUUID().toString().substring(0, 8).toUpperCase(Locale.ROOT);
    }

    /**
     * Identifies the request a key was issued for, so replaying the key with a different
     * body is detected instead of silently returning the earlier order.
     */
    static String fingerprint(long userId, long addressId, List<OrderLine> lines) {
        StringBuilder payload = new StringBuilder()
            .append(userId).append('|').append(addressId);
        lines.stream()
            .sorted(java.util.Comparator.comparingLong(OrderLine::goodsId))
            .forEach(line -> payload.append('|').append(line.goodsId()).append(':').append(line.count()));
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(payload.toString().getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is required by the JVM specification", exception);
        }
    }
}
