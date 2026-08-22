package com.zhiyuan.persistence;

import com.zhiyuan.domain.Models;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.sql.PreparedStatement;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Repository
public class PlatformDatabase {
    private static final ZoneOffset OFFSET = ZoneOffset.ofHours(8);
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public record Snapshot(
        List<Models.Uav> uavs,
        List<Models.Alert> alerts,
        List<Models.ControlCommand> commands,
        List<Models.User> users,
        List<Models.Goods> goods,
        List<Models.Order> orders,
        List<Models.Task> tasks,
        List<Models.Pod> pods,
        List<Models.Binding> bindings
    ) {}

    public PlatformDatabase(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Shared with the fulfilment adapter so both write through one connection pool. */
    public JdbcTemplate jdbc() {
        return jdbc;
    }

    public Snapshot snapshot() {
        return new Snapshot(loadUavs(), loadAlerts(), loadCommands(), loadUsers(),
            loadGoods(), loadOrders(), loadTasks(), loadPods(), loadBindings());
    }

    public long insertUser(String username, String phone) {
        return insert("INSERT INTO users (username, phone) VALUES (?, ?)", username, phone);
    }

    public void updateUser(long id, String username, String phone) {
        jdbc.update("UPDATE users SET username = ?, phone = ? WHERE id = ?", username, phone, id);
    }

    /** Physical delete. Only legal when nothing references the customer; see {@link #disableUser}. */
    public void deleteUser(long id) {
        jdbc.update("DELETE FROM users WHERE id = ?", id);
    }

    public void disableUser(long id) {
        jdbc.update("UPDATE users SET enabled = FALSE WHERE id = ?", id);
    }

    public long countOrdersForUser(long userId) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM orders WHERE user_id = ?", Long.class, userId);
        return count == null ? 0 : count;
    }

    public long countOrderItemsForGoods(long goodsId) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM order_items WHERE goods_id = ?", Long.class, goodsId);
        return count == null ? 0 : count;
    }

    public long insertAddress(long userId, String name, String phone, String detail, double latitude,
                              double longitude, boolean makeDefault) {
        if (makeDefault) jdbc.update("UPDATE user_addresses SET is_default = FALSE WHERE user_id = ?", userId);
        return insert("INSERT INTO user_addresses (user_id, receiver_name, receiver_phone, detail, latitude, longitude, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)",
            userId, name, phone, detail, latitude, longitude, makeDefault);
    }

    public void deleteAddress(long userId, long addressId) {
        jdbc.update("DELETE FROM user_addresses WHERE user_id = ? AND id = ?", userId, addressId);
    }

    public void updateAddress(long userId, long addressId, String name, String phone, String detail,
                              double latitude, double longitude, boolean makeDefault) {
        if (makeDefault) jdbc.update("UPDATE user_addresses SET is_default = FALSE WHERE user_id = ?", userId);
        jdbc.update("UPDATE user_addresses SET receiver_name = ?, receiver_phone = ?, detail = ?, latitude = ?, longitude = ?, is_default = ? WHERE user_id = ? AND id = ?",
            name, phone, detail, latitude, longitude, makeDefault, userId, addressId);
    }

    public void setDefaultAddress(long userId, long addressId) {
        jdbc.update("UPDATE user_addresses SET is_default = CASE WHEN id = ? THEN TRUE ELSE FALSE END WHERE user_id = ?", addressId, userId);
    }

    public long insertGoods(String name, String category, BigDecimal price, int stock, double weight, int status) {
        // reserved_stock defaults to 0: brand-new goods cannot already be claimed.
        return insert("INSERT INTO goods (name, category, price, stock, weight, status) VALUES (?, ?, ?, ?, ?, ?)",
            name, category, price, stock, weight, status);
    }

    /**
     * Edits the product record. {@code stock} here is <em>available</em> stock and the
     * write is a manual correction, so it is journalled as an ADJUST ledger row by the
     * caller rather than silently overwriting what reservations are holding.
     */
    public void updateGoods(long id, String name, String category, BigDecimal price, int stock, double weight, int status) {
        jdbc.update("UPDATE goods SET name = ?, category = ?, price = ?, stock = ?, weight = ?, status = ? WHERE id = ?",
            name, category, price, stock, weight, status, id);
    }

    public void deleteGoods(long id) {
        jdbc.update("DELETE FROM goods WHERE id = ?", id);
    }

    public void deleteGoods(Set<Long> ids) {
        ids.forEach(id -> jdbc.update("DELETE FROM goods WHERE id = ?", id));
    }

    public void updateGoodsStatus(long id, int status) {
        jdbc.update("UPDATE goods SET status = ? WHERE id = ?", status, id);
    }

    public boolean acknowledgeAlert(long id, long operatorId) {
        return jdbc.update("UPDATE alerts SET acknowledged_by = ?, acknowledged_at = CURRENT_TIMESTAMP WHERE id = ? AND acknowledged_at IS NULL AND resolved = FALSE",
            operatorId, id) == 1;
    }

    public boolean resolveAlert(long id, long operatorId) {
        return jdbc.update("UPDATE alerts SET resolved = TRUE, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND acknowledged_at IS NOT NULL AND resolved = FALSE",
            operatorId, id) == 1;
    }

    public void updateOrderStatus(long id, String status) {
        jdbc.update("UPDATE orders SET status = ? WHERE id = ?", status, id);
    }

    public long insertOrder(String orderNo, long userId, long addressId, Models.AddressSnapshot snapshot,
                            BigDecimal totalPrice) {
        return insert("INSERT INTO orders (order_no, user_id, address_id, address_snapshot, total_price, status) VALUES (?, ?, ?, CAST(? AS JSON), ?, 'CREATED')",
            orderNo, userId, addressId, json(snapshot), totalPrice);
    }

    public long insertOrderItem(long orderId, Models.Goods goods, int count) {
        return insert("INSERT INTO order_items (order_id, goods_id, goods_name, count, price) VALUES (?, ?, ?, ?, ?)",
            orderId, goods.id(), goods.name(), count, goods.price());
    }

    /**
     * @deprecated Stock movements go through
     * {@link com.zhiyuan.fulfilment.FulfilmentStore#applyInventory} so that every change
     * lands in the ledger with a reason. Kept only until the last caller is migrated.
     */
    @Deprecated
    public boolean decrementStock(long goodsId, int count) {
        return jdbc.update("UPDATE goods SET stock = stock - ? WHERE id = ? AND status = 1 AND stock >= ?", count, goodsId, count) == 1;
    }

    public long insertTask(long orderId, long uavId) {
        return insert("INSERT INTO uav_tasks (order_id, uav_id, task_status) VALUES (?, ?, 'WAITING')", orderId, uavId);
    }

    public void updateTask(long id, String status, OffsetDateTime startTime, OffsetDateTime endTime,
                           String failureReason) {
        jdbc.update("UPDATE uav_tasks SET task_status = ?, start_time = ?, end_time = ?, failure_reason = ? WHERE id = ?",
            status, timestamp(startTime), timestamp(endTime), failureReason, id);
    }

    public void resetTask(long id, long uavId) {
        jdbc.update("UPDATE uav_tasks SET uav_id = ?, task_status = 'WAITING', start_time = NULL, end_time = NULL, failure_reason = NULL WHERE id = ?", uavId, id);
    }

    public void terminateTask(long id, String reason) {
        jdbc.update("UPDATE uav_tasks SET task_status = 'FAILED', end_time = CURRENT_TIMESTAMP, failure_reason = ? WHERE id = ?", reason, id);
    }

    public void updatePod(long id, String doorStatus, Long uavId) {
        jdbc.update("UPDATE hibernate_pods SET door_status = ?, uav_id = ? WHERE id = ?", doorStatus, uavId, id);
    }

    public long insertBinding(long staffId, long uavId) {
        return insert("INSERT INTO device_bindings (staff_id, uav_id) VALUES (?, ?)", staffId, uavId);
    }

    public void unbind(long id) {
        jdbc.update("UPDATE device_bindings SET unbound_at = CURRENT_TIMESTAMP WHERE id = ? AND unbound_at IS NULL", id);
    }

    public void insertCommand(Models.ControlCommand command, long operatorId) {
        jdbc.update("INSERT INTO control_commands (id, uav_id, type, status, source, transcript, operator_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            command.id(), command.uavId(), command.type(), command.status(), command.source(), command.transcript(),
            operatorId, timestamp(command.createdAt()), timestamp(command.createdAt()));
    }

    public void updateCommandStatus(String id, String status) {
        jdbc.update("UPDATE control_commands SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", status, id);
    }

    public long insertFlightLog(long uavId, String event, String detail, double latitude, double longitude) {
        return insert("INSERT INTO flight_logs (uav_id, event, detail, latitude, longitude) VALUES (?, ?, ?, ?, ?)",
            uavId, event, detail, latitude, longitude);
    }

    public Models.FlightLog flightLog(long id) {
        return jdbc.queryForObject("SELECT * FROM flight_logs WHERE id = ?", (rs, row) -> new Models.FlightLog(
            rs.getLong("id"), rs.getLong("uav_id"), rs.getString("event"), rs.getString("detail"),
            nullableDouble(rs.getObject("latitude")), nullableDouble(rs.getObject("longitude")),
            offset(rs.getTimestamp("occurred_at"))), id);
    }

    public List<Models.FlightLog> flightLogs(long uavId) {
        return jdbc.query("SELECT * FROM flight_logs WHERE uav_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 200",
            (rs, row) -> new Models.FlightLog(rs.getLong("id"), rs.getLong("uav_id"),
                rs.getString("event"), rs.getString("detail"), nullableDouble(rs.getObject("latitude")),
                nullableDouble(rs.getObject("longitude")), offset(rs.getTimestamp("occurred_at"))), uavId);
    }

    public long staffId(String username) {
        Long id = jdbc.queryForObject("SELECT id FROM admins WHERE username = ?", Long.class, username);
        return id == null ? 1 : id;
    }

    /** Current device snapshots only. Used by the realtime path, which polls far more often
     * than anything else and must not drag the whole platform snapshot with it. */
    public List<Models.Uav> uavs() {
        return loadUavs();
    }

    private List<Models.Uav> loadUavs() {
        return jdbc.query("SELECT * FROM uavs ORDER BY id", (rs, row) -> new Models.Uav(
            rs.getLong("id"), rs.getString("code"), rs.getString("name"), rs.getString("rfid_tag"),
            rs.getString("model"), rs.getString("owner_name"), rs.getString("status"), rs.getInt("battery"),
            rs.getBoolean("in_hibernate_pod"), rs.getString("region"), rs.getDouble("altitude"),
            rs.getDouble("speed"), rs.getDouble("latitude"), rs.getDouble("longitude"), offset(rs.getTimestamp("updated_at"))));
    }

    private List<Models.Alert> loadAlerts() {
        return jdbc.query("SELECT * FROM alerts ORDER BY id", (rs, row) -> new Models.Alert(
            rs.getLong("id"), nullableLong(rs.getObject("uav_id")), nullableLong(rs.getObject("pod_id")),
            rs.getString("title"), rs.getString("level"),
            offset(rs.getTimestamp("occurred_at")), rs.getBoolean("resolved"),
            rs.getBoolean("resolved") ? "RESOLVED" : rs.getTimestamp("acknowledged_at") == null ? "OPEN" : "ACKNOWLEDGED",
            nullableLong(rs.getObject("acknowledged_by")), offset(rs.getTimestamp("acknowledged_at")),
            nullableLong(rs.getObject("resolved_by")), offset(rs.getTimestamp("resolved_at"))));
    }

    public long countAuditLogs(String type, String status, Long uavId, String query) {
        Long count = jdbc.queryForObject("SELECT COUNT(*) FROM (" + auditUnion() + ") audit WHERE " +
            auditFilters(), Long.class, auditValues(type, status, uavId, query).toArray());
        return count == null ? 0 : count;
    }

    public List<Models.AuditLog> auditLogs(String type, String status, Long uavId, String query,
                                           long offset, int size) {
        int safeSize = Math.min(Math.max(1, size), 100);
        return auditRows(type, status, uavId, query, true, offset, safeSize);
    }

    private List<Models.AuditLog> auditRows(String type, String status, Long uavId, String query,
                                            boolean paged, long offset, int size) {
        String sql = "SELECT * FROM (" + auditUnion() + ") audit WHERE " + auditFilters() + " ORDER BY occurred_at DESC, id DESC" +
            (paged ? " LIMIT ? OFFSET ?" : "");
        List<Object> values = auditValues(type, status, uavId, query);
        if (paged) { values.add(size); values.add(offset); }
        return jdbc.query(sql, (rs, row) -> new Models.AuditLog(
            rs.getString("id"), rs.getString("category"), nullableLong(rs.getObject("uav_id")),
            rs.getString("title"), rs.getString("detail"), rs.getString("status"),
            rs.getString("source"), nullableLong(rs.getObject("operator_id")), rs.getString("operator_name"),
            offset(rs.getTimestamp("occurred_at"))), values.toArray());
    }

    private static String auditUnion() {
        return "SELECT CONCAT('F-', f.id) id, 'FLIGHT' category, f.uav_id, f.event title, f.detail, 'RECORDED' status, 'UAV' source, NULL operator_id, NULL operator_name, f.occurred_at FROM flight_logs f " +
            "UNION ALL " +
            "SELECT CONCAT('C-', c.id), CASE WHEN c.source = 'VOICE' THEN 'VOICE' ELSE 'CONTROL' END, c.uav_id, c.type, COALESCE(NULLIF(c.transcript, ''), c.status), c.status, c.source, c.operator_id, a.display_name, c.created_at FROM control_commands c JOIN admins a ON a.id = c.operator_id";
    }

    private static String auditFilters() {
        return "(? = '' OR category = ?) AND (? = '' OR status = ?) AND (? IS NULL OR uav_id = ?) AND (? = '' OR LOWER(CONCAT(title, ' ', detail, ' ', COALESCE(operator_name, ''))) LIKE ?)";
    }

    private static List<Object> auditValues(String type, String status, Long uavId, String query) {
        String normalizedType = type == null ? "" : type;
        String normalizedStatus = status == null ? "" : status;
        String normalizedQuery = query == null ? "" : query.trim().toLowerCase(java.util.Locale.ROOT);
        List<Object> values = new ArrayList<>();
        java.util.Collections.addAll(values, normalizedType, normalizedType, normalizedStatus,
            normalizedStatus, uavId, uavId, normalizedQuery, "%" + normalizedQuery + "%");
        return values;
    }

    private List<Models.ControlCommand> loadCommands() {
        return jdbc.query("SELECT * FROM control_commands ORDER BY created_at DESC, id DESC LIMIT 500", (rs, row) -> new Models.ControlCommand(
            rs.getString("id"), rs.getLong("uav_id"), rs.getString("type"), rs.getString("status"),
            rs.getString("source"), rs.getString("transcript"), offset(rs.getTimestamp("created_at"))));
    }

    private List<Models.User> loadUsers() {
        Map<Long, List<Models.Address>> addresses = new LinkedHashMap<>();
        jdbc.query("SELECT * FROM user_addresses ORDER BY id", rs -> {
            long userId = rs.getLong("user_id");
            addresses.computeIfAbsent(userId, ignored -> new ArrayList<>()).add(new Models.Address(
                rs.getLong("id"), userId, rs.getString("receiver_name"), rs.getString("receiver_phone"),
                rs.getString("detail"), rs.getDouble("latitude"), rs.getDouble("longitude"), rs.getBoolean("is_default")));
        });
        return jdbc.query("SELECT * FROM users ORDER BY id", (rs, row) -> {
            long id = rs.getLong("id");
            return new Models.User(id, rs.getString("username"), rs.getString("phone"),
                offset(rs.getTimestamp("created_at")), List.copyOf(addresses.getOrDefault(id, List.of())),
                rs.getBoolean("enabled"));
        });
    }

    private List<Models.Goods> loadGoods() {
        return jdbc.query("SELECT * FROM goods ORDER BY id", (rs, row) -> new Models.Goods(
            rs.getLong("id"), rs.getString("name"), rs.getString("category"), rs.getBigDecimal("price"),
            rs.getInt("stock"), rs.getDouble("weight"), rs.getInt("status"), rs.getInt("reserved_stock")));
    }

    private List<Models.Order> loadOrders() {
        Map<Long, List<Models.OrderItem>> items = new LinkedHashMap<>();
        jdbc.query("SELECT * FROM order_items ORDER BY id", rs -> {
            long orderId = rs.getLong("order_id");
            items.computeIfAbsent(orderId, ignored -> new ArrayList<>()).add(new Models.OrderItem(
                rs.getLong("id"), rs.getLong("goods_id"), rs.getString("goods_name"), rs.getInt("count"), rs.getBigDecimal("price")));
        });
        return jdbc.query("SELECT * FROM orders ORDER BY id", (rs, row) -> {
            long id = rs.getLong("id");
            return new Models.Order(id, rs.getString("order_no"), rs.getLong("user_id"), rs.getLong("address_id"),
                rs.getBigDecimal("total_price"), rs.getString("status"), offset(rs.getTimestamp("created_at")),
                addressSnapshot(rs.getString("address_snapshot")),
                List.copyOf(items.getOrDefault(id, List.of())), rs.getInt("version"));
        });
    }

    private List<Models.Task> loadTasks() {
        return jdbc.query("SELECT * FROM uav_tasks ORDER BY id", (rs, row) -> new Models.Task(
            rs.getLong("id"), rs.getLong("order_id"), rs.getLong("uav_id"), rs.getString("task_status"),
            offset(rs.getTimestamp("start_time")), offset(rs.getTimestamp("end_time")),
            rs.getString("failure_reason")));
    }

    private List<Models.Pod> loadPods() {
        return jdbc.query("SELECT * FROM hibernate_pods ORDER BY id", (rs, row) -> new Models.Pod(
            rs.getLong("id"), rs.getString("name"), rs.getString("region"), rs.getString("door_status"),
            nullableLong(rs.getObject("uav_id"))));
    }

    private List<Models.Binding> loadBindings() {
        return jdbc.query("SELECT * FROM device_bindings ORDER BY id", (rs, row) -> new Models.Binding(
            rs.getLong("id"), rs.getLong("staff_id"), rs.getLong("uav_id"),
            offset(rs.getTimestamp("bound_at")), offset(rs.getTimestamp("unbound_at"))));
    }

    private long insert(String sql, Object... values) {
        KeyHolder keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            PreparedStatement statement = connection.prepareStatement(sql, new String[] { "id" });
            for (int i = 0; i < values.length; i++) statement.setObject(i + 1, values[i]);
            return statement;
        }, keys);
        Number id = keys.getKey();
        if (id == null) throw new IllegalStateException("Database did not return a generated key");
        return id.longValue();
    }

    private static OffsetDateTime offset(Timestamp value) {
        return value == null ? null : value.toInstant().atOffset(OFFSET);
    }

    private static Timestamp timestamp(OffsetDateTime value) {
        return value == null ? null : Timestamp.from(value.toInstant());
    }

    private static Long nullableLong(Object value) {
        return value == null ? null : ((Number) value).longValue();
    }

    private static Double nullableDouble(Object value) {
        return value == null ? null : ((Number) value).doubleValue();
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("Invalid address snapshot", exception);
        }
    }

    private Models.AddressSnapshot addressSnapshot(String value) {
        try {
            JsonNode node = objectMapper.readTree(value);
            return objectMapper.readValue(node.isTextual() ? node.textValue() : node.toString(), Models.AddressSnapshot.class);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Stored address snapshot is invalid", exception);
        }
    }
}
