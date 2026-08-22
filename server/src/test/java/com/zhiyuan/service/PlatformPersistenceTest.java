package com.zhiyuan.service;

import com.zhiyuan.persistence.PlatformDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.LinkedHashSet;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class PlatformPersistenceTest {
    @Autowired PlatformDatabase database;
    @Autowired PlatformTransactionManager transactionManager;

    @Test
    void mutationsRemainAvailableAfterTheServiceIsRecreated() {
        PlatformStore firstInstance = new PlatformStore(database, transactionManager);
        var created = firstInstance.addUser("持久化用户", "13987654321");
        var address = firstInstance.addAddress(created.id(), "收件人", "13987654321", "南京市鼓楼区 10 号", 32.06, 118.77, true);
        int stockBefore = firstInstance.goods("应急药品包", "").get(0).stock();
        var order = firstInstance.createOrder(created.id(), address.id(), List.of(new PlatformStore.OrderLine(1, 2)));

        PlatformStore recreatedInstance = new PlatformStore(database, transactionManager);

        var restored = recreatedInstance.users("13987654321").get(0);
        assertThat(restored.username()).isEqualTo("持久化用户");
        assertThat(restored.addresses()).singleElement().satisfies(restoredAddress -> {
            assertThat(restoredAddress.detail()).isEqualTo("南京市鼓楼区 10 号");
            assertThat(restoredAddress.isDefault()).isTrue();
        });
        assertThat(recreatedInstance.order(order.id()).addressSnapshot().detail()).isEqualTo("南京市鼓楼区 10 号");
        assertThat(recreatedInstance.goods("应急药品包", "").get(0).stock()).isEqualTo(stockBefore - 2);
    }

    /**
     * Goods 1 has order history and goods 4 has none, so a batch delete must delist the
     * first and remove the second. Physically deleting a referenced product would orphan
     * its order lines and rewrite what customers were charged for (ADR 0001).
     */
    @Test
    void batchDeleteDelistsReferencedGoodsAndRemovesUnreferencedOnes() {
        PlatformStore store = new PlatformStore(database, transactionManager);
        var ids = new LinkedHashSet<>(List.of(4L, 1L));

        store.deleteGoods(ids);

        assertThat(store.goods("生活补给包", "")).isEmpty();
        assertThat(store.goods("应急药品包", "")).singleElement()
            .extracting(item -> item.status()).isEqualTo(0);

        PlatformStore recreated = new PlatformStore(database, transactionManager);
        assertThat(recreated.goods("生活补给包", "")).isEmpty();
        assertThat(recreated.goods("应急药品包", "")).singleElement()
            .extracting(item -> item.status()).isEqualTo(0);
    }
}
