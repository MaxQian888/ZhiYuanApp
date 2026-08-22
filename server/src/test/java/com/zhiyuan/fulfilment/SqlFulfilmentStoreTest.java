package com.zhiyuan.fulfilment;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The same contract, run against real SQL.
 *
 * <p>Each test gets its own customer, products and devices rather than reusing the dev
 * seed, so a failure points at the rule under test rather than at leftover state.
 */
@SpringBootTest
class SqlFulfilmentStoreTest extends FulfilmentContract {

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PlatformTransactionManager transactionManager;

    @Override
    protected FulfilmentStore freshStore() {
        return new SqlFulfilmentStore(jdbc, transactionManager);
    }

    /** Unique per fixture so parallel or repeated runs never collide on a UNIQUE column. */
    private static final java.util.concurrent.atomic.AtomicInteger SEQUENCE =
        new java.util.concurrent.atomic.AtomicInteger(10_000_000);

    @Override
    protected Fixture seed(FulfilmentStore store) {
        String suffix = String.valueOf(SEQUENCE.incrementAndGet());
        long userId = insert("INSERT INTO users (username, phone) VALUES (?, ?)",
            "契约客户" + suffix, "139" + suffix);
        long addressId = insert(
            "INSERT INTO user_addresses (user_id, receiver_name, receiver_phone, detail, latitude, longitude, is_default)"
                + " VALUES (?, ?, ?, ?, ?, ?, TRUE)",
            userId, "契约收件人", "13900000001", "南京市玄武区契约路", 32.05, 118.79);
        long goodsId = insert("INSERT INTO goods (name, category, price, stock, weight, status)"
            + " VALUES (?, 'medicine', 89.00, ?, 0.8, 1)", "契约商品甲" + suffix, SEEDED_STOCK);
        long otherGoodsId = insert("INSERT INTO goods (name, category, price, stock, weight, status)"
            + " VALUES (?, 'food', 42.50, ?, 1.2, 1)", "契约商品乙" + suffix, SEEDED_STOCK);
        long uavId = insertUav("CQ-A" + suffix);
        long otherUavId = insertUav("CQ-B" + suffix);
        long operatorA = insertOperator("a" + suffix);
        long operatorB = insertOperator("b" + suffix);
        long operatorC = insertOperator("c" + suffix);
        return new Fixture(userId, addressId, goodsId, otherGoodsId, uavId, otherUavId,
            operatorA, operatorB, operatorC);
    }

    @Override
    protected void delist(long goodsId) {
        jdbc.update("UPDATE goods SET status = 0 WHERE id = ?", goodsId);
    }

    @Test
    void theLedgerAndTheGoodsRowAgreeOnTheRunningTotals() {
        var order = fulfilment().createOrder(fixture.userId(), fixture.addressId(),
            List.of(new OrderLine(fixture.goodsId(), 3)), fixture.operatorA(), null);
        fulfilment().cancelOrder(order.id(), fixture.operatorA(), "cancelled");

        Integer availableFromLedger = jdbc.queryForObject(
            "SELECT COALESCE(SUM(available_delta), 0) FROM inventory_ledger WHERE goods_id = ?",
            Integer.class, fixture.goodsId());
        Integer reservedFromLedger = jdbc.queryForObject(
            "SELECT COALESCE(SUM(reserved_delta), 0) FROM inventory_ledger WHERE goods_id = ?",
            Integer.class, fixture.goodsId());

        var goods = store().goods(fixture.goodsId()).orElseThrow();
        assertThat(goods.stock()).isEqualTo(SEEDED_STOCK + availableFromLedger);
        assertThat(goods.reservedStock()).isEqualTo(reservedFromLedger);
    }

    @Test
    void aRejectedOrderRollsBackTheOrderRowItself() {
        Long before = jdbc.queryForObject("SELECT COUNT(*) FROM orders WHERE user_id = ?",
            Long.class, fixture.userId());

        try {
            fulfilment().createOrder(fixture.userId(), fixture.addressId(),
                List.of(new OrderLine(fixture.goodsId(), SEEDED_STOCK + 1)), fixture.operatorA(), null);
        } catch (FulfilmentConflictException expected) {
            // The point of the test is what the database looks like afterwards.
        }

        Long after = jdbc.queryForObject("SELECT COUNT(*) FROM orders WHERE user_id = ?",
            Long.class, fixture.userId());
        assertThat(after).isEqualTo(before);
    }

    /** The ledger and the status history both carry a real staff foreign key. */
    private long insertOperator(String username) {
        // admins.phone is UNIQUE, so it needs its own counter rather than a slice of the
        // fixture suffix — a/b/c would otherwise collapse onto one number.
        return insert("INSERT INTO admins (username, password_hash, display_name, role, phone)"
            + " VALUES (?, 'x', ?, 'manager', ?)",
            username, "契约操作员 " + username, "137" + PHONE_SEQUENCE.incrementAndGet());
    }

    private static final java.util.concurrent.atomic.AtomicInteger PHONE_SEQUENCE =
        new java.util.concurrent.atomic.AtomicInteger(20_000_000);

    private long insertUav(String code) {
        return insert("INSERT INTO uavs (code, name, rfid_tag, model, owner_name, status, battery,"
            + " in_hibernate_pod, region, altitude, speed, latitude, longitude)"
            + " VALUES (?, ?, ?, 'Contract Model', '契约', 'ONLINE', 80, FALSE, '南京', 0, 0, 32.0, 118.0)",
            code, "契约设备 " + code, "RFID-" + code);
    }

    private long insert(String sql, Object... values) {
        org.springframework.jdbc.support.KeyHolder keys =
            new org.springframework.jdbc.support.GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement(sql, new String[] { "id" });
            for (int index = 0; index < values.length; index++) {
                statement.setObject(index + 1, values[index]);
            }
            return statement;
        }, keys);
        return keys.getKey().longValue();
    }
}
