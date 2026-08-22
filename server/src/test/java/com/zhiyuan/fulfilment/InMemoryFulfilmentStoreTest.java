package com.zhiyuan.fulfilment;

import com.zhiyuan.domain.Models;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** The contract, run against the adapter the simulator profile uses. */
class InMemoryFulfilmentStoreTest extends FulfilmentContract {

    @Override
    protected FulfilmentStore freshStore() {
        return new InMemoryFulfilmentStore();
    }

    @Override
    protected Fixture seed(FulfilmentStore store) {
        InMemoryFulfilmentStore memory = (InMemoryFulfilmentStore) store;
        memory.putUser(new Models.User(1, "王宁", "13900000001", OffsetDateTime.now(),
            List.of(new Models.Address(1, 1, "王宁", "13900000001", "南京市玄武区", 32.05, 118.79, true)),
            true));
        memory.putGoods(new Models.Goods(1, "应急药品包", "medicine", new BigDecimal("89.00"),
            SEEDED_STOCK, 0.8, 1, 0));
        memory.putGoods(new Models.Goods(2, "冷链餐食 A", "food", new BigDecimal("42.50"),
            SEEDED_STOCK, 1.2, 1, 0));
        memory.putUav(1);
        memory.putUav(2);
        return new Fixture(1, 1, 1, 2, 1, 2, 1, 2, 3);
    }

    @Override
    protected void delist(long goodsId) {
        InMemoryFulfilmentStore memory = (InMemoryFulfilmentStore) store();
        Models.Goods current = memory.goods(goodsId).orElseThrow();
        memory.putGoods(new Models.Goods(current.id(), current.name(), current.category(),
            current.price(), current.stock(), current.weight(), 0, current.reservedStock()));
    }

    @Test
    void refusesToOrderForADisabledCustomer() {
        InMemoryFulfilmentStore memory = (InMemoryFulfilmentStore) store();
        Models.User current = memory.user(fixture.userId()).orElseThrow();
        memory.putUser(new Models.User(current.id(), current.username(), current.phone(),
            current.createdAt(), current.addresses(), false));

        assertThatThrownBy(() -> fulfilment().createOrder(fixture.userId(), fixture.addressId(),
            List.of(new OrderLine(fixture.goodsId(), 1)), fixture.operatorA(), null))
            .isInstanceOf(FulfilmentConflictException.class)
            .hasMessageContaining("disabled");
    }

    @Test
    void rollsBackEveryCollectionWhenAUnitOfWorkFails() {
        InMemoryFulfilmentStore memory = (InMemoryFulfilmentStore) store();
        assertThatThrownBy(() -> memory.inTransaction(() -> {
            memory.applyInventory(fixture.goodsId(), -1, 1, "RESERVE", null, fixture.operatorA(), null);
            memory.rememberResult("scope", "key", "fingerprint", "1");
            throw new FulfilmentConflictException("boom");
        })).isInstanceOf(FulfilmentConflictException.class);

        assertThat(memory.goods(fixture.goodsId()).orElseThrow().stock()).isEqualTo(SEEDED_STOCK);
        assertThat(memory.goods(fixture.goodsId()).orElseThrow().reservedStock()).isZero();
        assertThat(memory.replayedResult("scope", "key", "fingerprint")).isEmpty();
    }
}
