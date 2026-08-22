package com.zhiyuan.fulfilment;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zhiyuan.domain.Models;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.function.Supplier;

/**
 * JDBC {@link FulfilmentStore}. Rows in, rows out — every rule lives in
 * {@link FulfilmentService}.
 *
 * <p>The two operations that carry concurrency weight are
 * {@link #applyInventory} and {@link #transitionOrder}. Both are written as a single
 * conditional {@code UPDATE} whose {@code WHERE} clause encodes the precondition, so the
 * database decides the winner. A read-then-write would let two concurrent orders both
 * observe enough stock and both reserve it.
 */
public class SqlFulfilmentStore implements FulfilmentStore {
    private static final ZoneOffset OFFSET = ZoneOffset.ofHours(8);

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public SqlFulfilmentStore(JdbcTemplate jdbc, PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.transactions = new TransactionTemplate(transactionManager);
    }

    @Override
    public <T> T inTransaction(Supplier<T> work) {
        return transactions.execute(status -> work.get());
    }

    // --------------------------------------------------------------- reads

    @Override
    public Optional<Models.Order> order(long orderId) {
        List<Models.Order> found = jdbc.query(
            "SELECT * FROM orders WHERE id = ?",
            (rs, row) -> readOrder(rs, items(orderId)), orderId);
        return found.stream().findFirst();
    }

    @Override
    public Optional<Models.Goods> goods(long goodsId) {
        return jdbc.query("SELECT * FROM goods WHERE id = ?",
            (rs, row) -> readGoods(rs), goodsId).stream().findFirst();
    }

    @Override
    public Optional<Models.User> user(long userId) {
        List<Models.Address> addresses = jdbc.query(
            "SELECT * FROM user_addresses WHERE user_id = ? ORDER BY id",
            (rs, row) -> new Models.Address(rs.getLong("id"), rs.getLong("user_id"),
                rs.getString("receiver_name"), rs.getString("receiver_phone"), rs.getString("detail"),
                rs.getDouble("latitude"), rs.getDouble("longitude"), rs.getBoolean("is_default")),
            userId);
        return jdbc.query("SELECT * FROM users WHERE id = ?",
            (rs, row) -> new Models.User(rs.getLong("id"), rs.getString("username"),
                rs.getString("phone"), offset(rs.getTimestamp("created_at")), addresses,
                rs.getBoolean("enabled")),
            userId).stream().findFirst();
    }

    @Override
    public Optional<Models.Task> taskForOrder(long orderId) {
        return jdbc.query("SELECT * FROM uav_tasks WHERE order_id = ?",
            (rs, row) -> readTask(rs), orderId).stream().findFirst();
    }

    @Override
    public Optional<Models.Task> task(long taskId) {
        return jdbc.query("SELECT * FROM uav_tasks WHERE id = ?",
            (rs, row) -> readTask(rs), taskId).stream().findFirst();
    }

    @Override
    public List<Models.LedgerEntry> ledgerForOrder(long orderId) {
        return jdbc.query("SELECT * FROM inventory_ledger WHERE order_id = ? ORDER BY id",
            (rs, row) -> new Models.LedgerEntry(rs.getLong("id"), rs.getLong("goods_id"),
                nullableLong(rs.getObject("order_id")), rs.getString("reason"),
                rs.getInt("available_delta"), rs.getInt("reserved_delta"),
                rs.getInt("available_after"), rs.getInt("reserved_after"),
                nullableLong(rs.getObject("operator_id")), rs.getString("idempotency_key"),
                offset(rs.getTimestamp("occurred_at"))),
            orderId);
    }

    @Override
    public List<Models.OrderStatusChange> historyForOrder(long orderId) {
        return jdbc.query("SELECT * FROM order_status_history WHERE order_id = ? ORDER BY id",
            (rs, row) -> new Models.OrderStatusChange(rs.getLong("id"), rs.getLong("order_id"),
                rs.getString("from_status"), rs.getString("to_status"),
                nullableLong(rs.getObject("operator_id")), rs.getString("reason"),
                offset(rs.getTimestamp("occurred_at"))),
            orderId);
    }

    @Override
    public Optional<String> replayedResult(String scope, String key, String fingerprint) {
        List<String[]> rows = jdbc.query(
            "SELECT request_fingerprint, result_ref FROM idempotency_records"
                + " WHERE scope = ? AND idempotency_key = ?",
            (rs, row) -> new String[] { rs.getString("request_fingerprint"), rs.getString("result_ref") },
            scope, key);
        if (rows.isEmpty()) return Optional.empty();
        if (!rows.get(0)[0].equals(fingerprint)) throw new IdempotencyConflictException(scope, key);
        return Optional.of(rows.get(0)[1]);
    }

    @Override
    public boolean uavExists(long uavId) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM uavs WHERE id = ?", Long.class, uavId);
        return count != null && count > 0;
    }

    // --------------------------------------------------------------- writes

    @Override
    public void rememberResult(String scope, String key, String fingerprint, String resultRef) {
        try {
            jdbc.update("INSERT INTO idempotency_records"
                + " (scope, idempotency_key, request_fingerprint, result_ref) VALUES (?, ?, ?, ?)",
                scope, key, fingerprint, resultRef);
        } catch (DuplicateKeyException raced) {
            // Two replays of the same request arrived together. The row that landed first
            // already carries the answer; the loser's work is rolled back by the caller.
            throw new FulfilmentConflictException(
                "Idempotency key '" + key + "' is being processed concurrently");
        }
    }

    @Override
    public long insertOrder(long userId, long addressId, Models.AddressSnapshot addressSnapshot,
                            BigDecimal totalPrice, List<OrderLine> lines, String orderNo) {
        long orderId = insert(
            "INSERT INTO orders (order_no, user_id, address_id, address_snapshot, total_price, status, version)"
                + " VALUES (?, ?, ?, ?, ?, 'CREATED', 0)",
            orderNo, userId, addressId, json(addressSnapshot), totalPrice);
        for (OrderLine line : lines) {
            Models.Goods product = goods(line.goodsId())
                .orElseThrow(() -> new IllegalStateException("Goods vanished mid-transaction"));
            jdbc.update("INSERT INTO order_items (order_id, goods_id, goods_name, count, price)"
                + " VALUES (?, ?, ?, ?, ?)",
                orderId, product.id(), product.name(), line.count(), product.price());
        }
        return orderId;
    }

    @Override
    public boolean applyInventory(long goodsId, int availableDelta, int reservedDelta, String reason,
                                  Long orderId, Long operatorId, String idempotencyKey) {
        // The guards live in the WHERE clause so the database serialises competing writers.
        int updated = jdbc.update(
            "UPDATE goods SET stock = stock + ?, reserved_stock = reserved_stock + ?"
                + " WHERE id = ? AND stock + ? >= 0 AND reserved_stock + ? >= 0",
            availableDelta, reservedDelta, goodsId, availableDelta, reservedDelta);
        if (updated != 1) return false;

        Models.Goods after = goods(goodsId)
            .orElseThrow(() -> new IllegalStateException("Goods vanished mid-transaction"));
        jdbc.update("INSERT INTO inventory_ledger (goods_id, order_id, reason, available_delta,"
            + " reserved_delta, available_after, reserved_after, operator_id, idempotency_key)"
            + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            goodsId, orderId, reason, availableDelta, reservedDelta, after.stock(),
            after.reservedStock(), operatorId, idempotencyKey);
        return true;
    }

    @Override
    public boolean transitionOrder(long orderId, int expectedVersion, String fromStatus,
                                   String toStatus, Long operatorId, String reason) {
        int updated = jdbc.update(
            "UPDATE orders SET status = ?, version = version + 1 WHERE id = ? AND version = ?",
            toStatus, orderId, expectedVersion);
        if (updated != 1) return false;
        jdbc.update("INSERT INTO order_status_history (order_id, from_status, to_status, operator_id, reason)"
            + " VALUES (?, ?, ?, ?, ?)", orderId, fromStatus, toStatus, operatorId, reason);
        return true;
    }

    @Override
    public long assignTask(long orderId, long uavId) {
        Optional<Models.Task> existing = taskForOrder(orderId);
        if (existing.isPresent()) {
            jdbc.update("UPDATE uav_tasks SET uav_id = ?, task_status = 'WAITING', start_time = NULL,"
                + " end_time = NULL, failure_reason = NULL WHERE id = ?", uavId, existing.get().id());
            return existing.get().id();
        }
        return insert("INSERT INTO uav_tasks (order_id, uav_id, task_status) VALUES (?, ?, 'WAITING')",
            orderId, uavId);
    }

    @Override
    public void updateTaskStatus(long taskId, String status, String failureReason) {
        String startClause = "FLYING".equals(status) ? "CURRENT_TIMESTAMP" : "start_time";
        String endClause = "ARRIVED".equals(status) || "FAILED".equals(status)
            ? "CURRENT_TIMESTAMP" : "end_time";
        jdbc.update("UPDATE uav_tasks SET task_status = ?, start_time = " + startClause
            + ", end_time = " + endClause + ", failure_reason = ? WHERE id = ?",
            status, failureReason, taskId);
    }

    // ----------------------------------------------------------- row mapping

    private List<Models.OrderItem> items(long orderId) {
        return jdbc.query("SELECT * FROM order_items WHERE order_id = ? ORDER BY id",
            (rs, row) -> new Models.OrderItem(rs.getLong("id"), rs.getLong("goods_id"),
                rs.getString("goods_name"), rs.getInt("count"), rs.getBigDecimal("price")),
            orderId);
    }

    private Models.Order readOrder(ResultSet rs, List<Models.OrderItem> items) throws SQLException {
        return new Models.Order(rs.getLong("id"), rs.getString("order_no"), rs.getLong("user_id"),
            rs.getLong("address_id"), rs.getBigDecimal("total_price"), rs.getString("status"),
            offset(rs.getTimestamp("created_at")), addressSnapshot(rs.getString("address_snapshot")),
            List.copyOf(items), rs.getInt("version"));
    }

    private static Models.Goods readGoods(ResultSet rs) throws SQLException {
        return new Models.Goods(rs.getLong("id"), rs.getString("name"), rs.getString("category"),
            rs.getBigDecimal("price"), rs.getInt("stock"), rs.getDouble("weight"),
            rs.getInt("status"), rs.getInt("reserved_stock"));
    }

    private static Models.Task readTask(ResultSet rs) throws SQLException {
        return new Models.Task(rs.getLong("id"), rs.getLong("order_id"), rs.getLong("uav_id"),
            rs.getString("task_status"), offset(rs.getTimestamp("start_time")),
            offset(rs.getTimestamp("end_time")), rs.getString("failure_reason"));
    }

    private long insert(String sql, Object... values) {
        KeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(sql, new String[] { "id" });
            for (int index = 0; index < values.length; index++) {
                statement.setObject(index + 1, values[index]);
            }
            return statement;
        }, keys);
        Number id = keys.getKey();
        if (id == null) throw new IllegalStateException("Database did not return a generated key");
        return id.longValue();
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Invalid address snapshot", exception);
        }
    }

    private Models.AddressSnapshot addressSnapshot(String value) {
        if (value == null) return null;
        try {
            JsonNode node = objectMapper.readTree(value);
            return objectMapper.readValue(node.isTextual() ? node.textValue() : node.toString(),
                Models.AddressSnapshot.class);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored address snapshot is invalid", exception);
        }
    }

    private static OffsetDateTime offset(Timestamp value) {
        return value == null ? null : value.toInstant().atOffset(OFFSET);
    }

    private static Long nullableLong(Object value) {
        return value == null ? null : ((Number) value).longValue();
    }
}
