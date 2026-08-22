package com.zhiyuan.fulfilment;

import com.zhiyuan.domain.Models;

import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * The persistence port for order, inventory and task work.
 *
 * <p>Deliberately narrow: it exposes the handful of operations {@link FulfilmentService}
 * needs and nothing else. No rule lives here — an adapter that returns rows and applies
 * deltas is all that is required, which is what makes a MySQL adapter and an in-memory
 * adapter interchangeable under one set of contract tests.
 *
 * <p>Every mutating method is only ever called from inside {@link #inTransaction}.
 */
public interface FulfilmentStore {

    /** Runs {@code work} atomically. An exception rolls everything back. */
    <T> T inTransaction(Supplier<T> work);

    // ---------------------------------------------------------------- reads

    Optional<Models.Order> order(long orderId);

    Optional<Models.Goods> goods(long goodsId);

    Optional<Models.User> user(long userId);

    Optional<Models.Task> taskForOrder(long orderId);

    Optional<Models.Task> task(long taskId);

    List<Models.LedgerEntry> ledgerForOrder(long orderId);

    List<Models.OrderStatusChange> historyForOrder(long orderId);

    /**
     * Returns the stored result reference for a previously seen key.
     *
     * @throws IdempotencyConflictException when the key was used with a different payload
     */
    Optional<String> replayedResult(String scope, String key, String fingerprint);

    // --------------------------------------------------------------- writes

    void rememberResult(String scope, String key, String fingerprint, String resultRef);

    long insertOrder(long userId, long addressId, Models.AddressSnapshot addressSnapshot,
                     java.math.BigDecimal totalPrice, List<OrderLine> lines, String orderNo);

    /**
     * Applies a signed inventory movement and appends the matching ledger row.
     *
     * @return {@code false} when the movement would drive available or reserved stock
     *         negative — the caller turns that into a business conflict. Implementations
     *         must make the check and the write a single atomic step so two concurrent
     *         reservations cannot both pass.
     */
    boolean applyInventory(long goodsId, int availableDelta, int reservedDelta, String reason,
                           Long orderId, Long operatorId, String idempotencyKey);

    /**
     * Moves an order to {@code toStatus} only if its version still matches, and records
     * the change in the status history.
     *
     * @return {@code false} when another writer moved first
     */
    boolean transitionOrder(long orderId, int expectedVersion, String fromStatus, String toStatus,
                            Long operatorId, String reason);

    /** Creates the task for an order, or re-points the existing one at a new device. */
    long assignTask(long orderId, long uavId);

    void updateTaskStatus(long taskId, String status, String failureReason);

    boolean uavExists(long uavId);
}
