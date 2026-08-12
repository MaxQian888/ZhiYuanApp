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
}
