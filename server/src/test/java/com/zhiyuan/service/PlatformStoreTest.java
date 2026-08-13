package com.zhiyuan.service;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PlatformStoreTest {
    private final PlatformStore store = new PlatformStore();

    @Test
    void keepsOrderAndTaskStateMachinesConsistent() {
        var task = store.dispatch(1, 1);
        assertThat(store.order(1).status()).isEqualTo("DISPATCHING");
        store.transitionTask(task.id(), "FLYING");
        assertThat(store.order(1).status()).isEqualTo("DELIVERING");
        store.transitionTask(task.id(), "ARRIVED");
        assertThat(store.order(1).status()).isEqualTo("FINISHED");
    }

    @Test
    void rejectsIllegalTaskTransitions() {
        assertThatThrownBy(() -> store.transitionTask(1, "ARRIVED"))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("Illegal task transition");
    }

    @Test
    void keepsExactlyOneDefaultAddress() {
        var added = store.addAddress(1, "王宁", "13900000001", "南京市鼓楼区", 32.07, 118.77, true);
        assertThat(store.users("王宁").get(0).addresses()).filteredOn(address -> address.isDefault()).containsExactly(added);
    }

    @Test
    void cancellingAnAssignedOrderTerminatesItsActiveTask() {
        store.cancelOrder(2);
        assertThat(store.order(2).status()).isEqualTo("CANCELLED");
        assertThat(store.tasks("")).filteredOn(task -> task.orderId() == 2).singleElement()
            .extracting(task -> task.taskStatus()).isEqualTo("FAILED");
    }

    @Test
    void failedOrdersReuseTheirTaskWhenRedispatched() {
        var task = store.dispatch(1, 1);
        var failed = store.transitionTask(task.id(), "FAILED", "Strong crosswind");
        assertThat(failed.failureReason()).isEqualTo("Strong crosswind");
        var retried = store.dispatch(1, 5);
        assertThat(retried.id()).isEqualTo(task.id());
        assertThat(retried.uavId()).isEqualTo(5);
        assertThat(retried.taskStatus()).isEqualTo("WAITING");
        assertThat(retried.failureReason()).isNull();
    }

    @Test
    void preservesBindingHistoryAfterUnbind() {
        store.unbind(1);
        assertThat(store.bindings()).filteredOn(binding -> binding.id() == 1).singleElement()
            .extracting(binding -> binding.unboundAt()).isNotNull();
    }
}
