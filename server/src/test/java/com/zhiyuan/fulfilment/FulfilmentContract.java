package com.zhiyuan.fulfilment;

import com.zhiyuan.domain.Models;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The behaviour every {@link FulfilmentStore} must exhibit, run once per adapter.
 *
 * <p>The point of this suite is that the in-memory adapter used by the simulator and the
 * SQL adapter used in production cannot drift: if a rule only holds in one of them, the
 * simulator stops being a faithful preview of production, which is exactly the class of
 * bug that made cancelled orders lose stock before ADR 0001.
 */
abstract class FulfilmentContract {
    /** The stock every fixture product starts with. */
    protected static final int SEEDED_STOCK = 10;

    /**
     * Operator ids are part of the fixture because the ledger and the status history
     * reference real staff rows — the SQL adapter enforces that with a foreign key, and a
     * contract that invented ids would only pass against the in-memory adapter.
     */
    protected record Fixture(long userId, long addressId, long goodsId, long otherGoodsId, long uavId,
                             long otherUavId, long operatorA, long operatorB, long operatorC) {}

    private FulfilmentStore store;
    private FulfilmentService fulfilment;
    protected Fixture fixture;

    /** Builds a clean adapter with one enabled customer, two listed products and two UAVs. */
    protected abstract FulfilmentStore freshStore();

    protected abstract Fixture seed(FulfilmentStore store);

    @BeforeEach
    void setUp() {
        store = freshStore();
        fixture = seed(store);
        fulfilment = new FulfilmentService(store);
    }

    protected FulfilmentService fulfilment() {
        return fulfilment;
    }

    protected FulfilmentStore store() {
        return store;
    }

    private List<OrderLine> lines(int count) {
        return List.of(new OrderLine(fixture.goodsId(), count));
    }

    /**
     * Scopes an idempotency key to this fixture. The SQL adapter keeps
     * {@code idempotency_records} across tests, so a shared literal would collide with a
     * previous test's key and fail for the wrong reason.
     */
    private String key(String name) {
        return name + "-" + fixture.userId();
    }

    private Models.Goods goods() {
        return store.goods(fixture.goodsId()).orElseThrow();
    }

    // ------------------------------------------------------------ reservation

    @Test
    void creatingAnOrderMovesStockFromAvailableToReservedWithoutChangingThePhysicalCount() {
        fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(3), fixture.operatorA(), null);

        Models.Goods after = goods();
        assertThat(after.stock()).isEqualTo(SEEDED_STOCK - 3);
        assertThat(after.reservedStock()).isEqualTo(3);
        assertThat(after.onHandStock()).isEqualTo(SEEDED_STOCK);
    }

    @Test
    void everyStockMovementLeavesALedgerRow() {
        Models.Order order = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(2),
            fixture.operatorA(), null);

        assertThat(fulfilment.ledger(order.id())).singleElement().satisfies(entry -> {
            assertThat(entry.reason()).isEqualTo("RESERVE");
            assertThat(entry.availableDelta()).isEqualTo(-2);
            assertThat(entry.reservedDelta()).isEqualTo(2);
            assertThat(entry.availableAfter()).isEqualTo(SEEDED_STOCK - 2);
            assertThat(entry.reservedAfter()).isEqualTo(2);
            assertThat(entry.operatorId()).isEqualTo(fixture.operatorA());
        });
    }

    @Test
    void cancellingReleasesTheReservationBackToAvailable() {
        Models.Order order = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(4), fixture.operatorA(), null);

        fulfilment.cancelOrder(order.id(), fixture.operatorA(), "customer changed their mind");

        Models.Goods after = goods();
        assertThat(after.stock()).isEqualTo(SEEDED_STOCK);
        assertThat(after.reservedStock()).isZero();
        assertThat(fulfilment.ledger(order.id())).extracting(Models.LedgerEntry::reason)
            .containsExactly("RESERVE", "RELEASE");
    }

    @Test
    void arrivingConsumesTheReservationAndDropsThePhysicalCount() {
        Models.Order order = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(4), fixture.operatorA(), null);
        Models.Task task = fulfilment.dispatchOrder(order.id(), fixture.uavId(), fixture.operatorA());
        fulfilment.transitionTask(task.id(), "FLYING", null, fixture.operatorA());

        fulfilment.transitionTask(task.id(), "ARRIVED", null, fixture.operatorA());

        Models.Goods after = goods();
        assertThat(after.stock()).isEqualTo(SEEDED_STOCK - 4);
        assertThat(after.reservedStock()).isZero();
        assertThat(after.onHandStock()).isEqualTo(SEEDED_STOCK - 4);
        assertThat(fulfilment.ledger(order.id())).extracting(Models.LedgerEntry::reason)
            .containsExactly("RESERVE", "CONSUME");
    }

    @Test
    void aFailedTaskKeepsItsReservationSoTheOrderCanBeRedispatched() {
        Models.Order order = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(4), fixture.operatorA(), null);
        Models.Task task = fulfilment.dispatchOrder(order.id(), fixture.uavId(), fixture.operatorA());

        fulfilment.transitionTask(task.id(), "FAILED", "strong crosswind", fixture.operatorA());

        Models.Goods after = goods();
        assertThat(after.stock()).isEqualTo(SEEDED_STOCK - 4);
        assertThat(after.reservedStock()).isEqualTo(4);
        assertThat(store.order(order.id()).orElseThrow().status()).isEqualTo("ERROR");

        Models.Task retried = fulfilment.dispatchOrder(order.id(), fixture.otherUavId(), fixture.operatorA());
        assertThat(retried.id()).isEqualTo(task.id());
        assertThat(retried.uavId()).isEqualTo(fixture.otherUavId());
        assertThat(retried.taskStatus()).isEqualTo("WAITING");
        assertThat(retried.failureReason()).isNull();
        // Still exactly one reservation: re-dispatching must not double-claim the stock.
        assertThat(goods().reservedStock()).isEqualTo(4);
    }

    @Test
    void cancellingAfterAFailureStillReturnsTheStock() {
        Models.Order order = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(4), fixture.operatorA(), null);
        Models.Task task = fulfilment.dispatchOrder(order.id(), fixture.uavId(), fixture.operatorA());
        fulfilment.transitionTask(task.id(), "FAILED", "strong crosswind", fixture.operatorA());

        fulfilment.cancelOrder(order.id(), fixture.operatorA(), "abandoned");

        assertThat(goods().stock()).isEqualTo(SEEDED_STOCK);
        assertThat(goods().reservedStock()).isZero();
    }

    @Test
    void cancellingAnOrderFailsItsActiveTask() {
        Models.Order order = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(1), fixture.operatorA(), null);
        Models.Task task = fulfilment.dispatchOrder(order.id(), fixture.uavId(), fixture.operatorA());

        fulfilment.cancelOrder(order.id(), fixture.operatorA(), "cancelled");

        assertThat(store.task(task.id()).orElseThrow().taskStatus()).isEqualTo("FAILED");
    }

    // ---------------------------------------------------------------- limits

    @Test
    void refusesToReserveMoreThanIsAvailable() {
        assertThatThrownBy(() -> fulfilment.createOrder(fixture.userId(), fixture.addressId(),
            lines(SEEDED_STOCK + 1), fixture.operatorA(), null))
            .isInstanceOf(FulfilmentConflictException.class)
            .hasMessageContaining("Insufficient stock");

        assertThat(goods().stock()).isEqualTo(SEEDED_STOCK);
        assertThat(goods().reservedStock()).isZero();
    }

    @Test
    void aRejectedOrderLeavesNoHalfWrittenState() {
        // Two lines: the first reserves, the second exceeds stock. Nothing may survive.
        assertThatThrownBy(() -> fulfilment.createOrder(fixture.userId(), fixture.addressId(),
            List.of(new OrderLine(fixture.otherGoodsId(), 1),
                new OrderLine(fixture.goodsId(), SEEDED_STOCK + 1)), fixture.operatorA(), null))
            .isInstanceOf(FulfilmentConflictException.class);

        assertThat(store.goods(fixture.otherGoodsId()).orElseThrow().reservedStock()).isZero();
        assertThat(store.goods(fixture.otherGoodsId()).orElseThrow().stock()).isEqualTo(SEEDED_STOCK);
        assertThat(goods().stock()).isEqualTo(SEEDED_STOCK);
    }

    @Test
    void refusesAnOrderWithNoLines() {
        assertThatThrownBy(() -> fulfilment.createOrder(fixture.userId(), fixture.addressId(),
            List.of(), fixture.operatorA(), null))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void refusesAnUnknownCustomerOrAddress() {
        assertThatThrownBy(() -> fulfilment.createOrder(999_999L, fixture.addressId(), lines(1), fixture.operatorA(), null))
            .isInstanceOf(NoSuchElementException.class);
        assertThatThrownBy(() -> fulfilment.createOrder(fixture.userId(), 999_999L, lines(1), fixture.operatorA(), null))
            .isInstanceOf(NoSuchElementException.class);
    }

    @Test
    void refusesToDispatchToAnUnknownDevice() {
        Models.Order order = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(1), fixture.operatorA(), null);
        assertThatThrownBy(() -> fulfilment.dispatchOrder(order.id(), 999_999L, fixture.operatorA()))
            .isInstanceOf(NoSuchElementException.class);
    }

    @Test
    void refusesToDispatchAnOrderThatAlreadyHasAnActiveTask() {
        Models.Order order = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(1), fixture.operatorA(), null);
        fulfilment.dispatchOrder(order.id(), fixture.uavId(), fixture.operatorA());

        assertThatThrownBy(() -> fulfilment.dispatchOrder(order.id(), fixture.otherUavId(), fixture.operatorA()))
            .isInstanceOf(FulfilmentConflictException.class);
    }

    @Test
    void refusesIllegalOrderAndTaskTransitions() {
        Models.Order order = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(1), fixture.operatorA(), null);
        Models.Task task = fulfilment.dispatchOrder(order.id(), fixture.uavId(), fixture.operatorA());

        assertThatThrownBy(() -> fulfilment.transitionTask(task.id(), "ARRIVED", null, fixture.operatorA()))
            .isInstanceOf(FulfilmentConflictException.class)
            .hasMessageContaining("Illegal task transition");

        fulfilment.transitionTask(task.id(), "FLYING", null, fixture.operatorA());
        fulfilment.transitionTask(task.id(), "ARRIVED", null, fixture.operatorA());

        assertThatThrownBy(() -> fulfilment.cancelOrder(order.id(), fixture.operatorA(), "too late"))
            .isInstanceOf(FulfilmentConflictException.class)
            .hasMessageContaining("Illegal order transition");
    }

    @Test
    void refusesToOrderADelistedProduct() {
        delist(fixture.otherGoodsId());
        assertThatThrownBy(() -> fulfilment.createOrder(fixture.userId(), fixture.addressId(),
            List.of(new OrderLine(fixture.otherGoodsId(), 1)), fixture.operatorA(), null))
            .isInstanceOf(FulfilmentConflictException.class)
            .hasMessageContaining("delisted");
    }

    // ---------------------------------------------------------- idempotency

    @Test
    void replayingAnIdempotencyKeyReturnsTheOriginalOrderAndReservesOnce() {
        Models.Order first = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(3),
            fixture.operatorA(), key("key-abc"));
        Models.Order replay = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(3),
            fixture.operatorA(), key("key-abc"));

        assertThat(replay.id()).isEqualTo(first.id());
        assertThat(replay.orderNo()).isEqualTo(first.orderNo());
        assertThat(goods().stock()).isEqualTo(SEEDED_STOCK - 3);
        assertThat(goods().reservedStock()).isEqualTo(3);
    }

    @Test
    void reusingAnIdempotencyKeyForADifferentBodyIsRefused() {
        fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(3), fixture.operatorA(), key("key-abc"));

        assertThatThrownBy(() -> fulfilment.createOrder(fixture.userId(), fixture.addressId(),
            lines(4), fixture.operatorA(), key("key-abc")))
            .isInstanceOf(IdempotencyConflictException.class);
    }

    @Test
    void differentKeysCreateDifferentOrders() {
        Models.Order first = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(1), fixture.operatorA(), key("key-1"));
        Models.Order second = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(1), fixture.operatorA(), key("key-2"));

        assertThat(second.id()).isNotEqualTo(first.id());
        assertThat(goods().reservedStock()).isEqualTo(2);
    }

    @Test
    void duplicateLinesForTheSameProductAreMergedIntoOneReservation() {
        Models.Order order = fulfilment.createOrder(fixture.userId(), fixture.addressId(),
            List.of(new OrderLine(fixture.goodsId(), 2), new OrderLine(fixture.goodsId(), 3)), fixture.operatorA(), null);

        assertThat(order.items()).singleElement()
            .extracting(Models.OrderItem::count).isEqualTo(5);
        assertThat(fulfilment.ledger(order.id())).hasSize(1);
        assertThat(goods().reservedStock()).isEqualTo(5);
    }

    // ------------------------------------------------------------- history

    @Test
    void everyStatusChangeIsRecordedWithItsOperatorAndReason() {
        Models.Order order = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(1),
            fixture.operatorA(), null);
        Models.Task task = fulfilment.dispatchOrder(order.id(), fixture.uavId(), fixture.operatorB());
        fulfilment.transitionTask(task.id(), "FLYING", null, fixture.operatorC());

        assertThat(fulfilment.history(order.id())).extracting(Models.OrderStatusChange::toStatus)
            .containsExactly("CREATED", "DISPATCHING", "DELIVERING");
        assertThat(fulfilment.history(order.id())).extracting(Models.OrderStatusChange::operatorId)
            .containsExactly(fixture.operatorA(), fixture.operatorB(), fixture.operatorC());
    }

    @Test
    void theOrderVersionAdvancesWithEveryTransition() {
        Models.Order order = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(1), fixture.operatorA(), null);
        assertThat(order.version()).isEqualTo(1);

        fulfilment.dispatchOrder(order.id(), fixture.uavId(), fixture.operatorA());
        assertThat(store.order(order.id()).orElseThrow().version()).isEqualTo(2);
    }

    @Test
    void aStaleVersionLosesTheRace() {
        Models.Order order = fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(1), fixture.operatorA(), null);

        // Someone else already moved the order; the version we hold is one behind.
        assertThat(store.transitionOrder(order.id(), order.version(), "CREATED", "DISPATCHING", fixture.operatorA(), "first"))
            .isTrue();
        assertThat(store.transitionOrder(order.id(), order.version(), "CREATED", "CANCELLED", fixture.operatorA(), "second"))
            .isFalse();
    }

    // ----------------------------------------------------------- concurrency

    @Test
    void concurrentOrdersNeverOversell() throws Exception {
        int attempts = SEEDED_STOCK * 2;
        ExecutorService pool = Executors.newFixedThreadPool(8);
        CountDownLatch start = new CountDownLatch(1);
        AtomicInteger accepted = new AtomicInteger();

        try {
            List<Callable<Void>> work = new ArrayList<>();
            for (int index = 0; index < attempts; index++) {
                work.add(() -> {
                    start.await(5, TimeUnit.SECONDS);
                    try {
                        fulfilment.createOrder(fixture.userId(), fixture.addressId(), lines(1), fixture.operatorA(), null);
                        accepted.incrementAndGet();
                    } catch (RuntimeException rejected) {
                        // Losing the race is the expected outcome for the surplus attempts.
                    }
                    return null;
                });
            }
            List<Future<Void>> futures = new ArrayList<>();
            work.forEach(task -> futures.add(pool.submit(task)));
            start.countDown();
            for (Future<Void> future : futures) future.get(30, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }

        assertThat(accepted.get()).isEqualTo(SEEDED_STOCK);
        assertThat(goods().stock()).isZero();
        assertThat(goods().reservedStock()).isEqualTo(SEEDED_STOCK);
        assertThat(goods().onHandStock()).isEqualTo(SEEDED_STOCK);
    }

    /** Adapter-specific: mark the product unavailable for new orders. */
    protected abstract void delist(long goodsId);
}
