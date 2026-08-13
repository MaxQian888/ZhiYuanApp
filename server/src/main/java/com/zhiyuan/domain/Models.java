package com.zhiyuan.domain;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

public final class Models {
    private Models() {}

    public record Staff(long id, String username, String displayName, String role, String phone) {}
    public record StaffAccount(long id, String username, String displayName, String role, String phone,
                               boolean enabled) {}
    public record Uav(long id, String code, String name, String rfidTag, String model, String ownerName,
                      String status, int battery, boolean inHibernatePod, String region, double altitude,
                      double speed, double latitude, double longitude, OffsetDateTime updatedAt) {}
    public record Alert(long id, Long uavId, Long podId, String title, String level, OffsetDateTime occurredAt,
                        boolean resolved, String status, Long acknowledgedBy,
                        OffsetDateTime acknowledgedAt, Long resolvedBy, OffsetDateTime resolvedAt) {}
    public record FlightLog(long id, long uavId, String event, String detail, Double latitude,
                            Double longitude, OffsetDateTime occurredAt) {}
    public record ControlCommand(String id, long uavId, String type, String status, String source,
                                 String transcript, OffsetDateTime createdAt) {}
    public record AuditLog(String id, String category, Long uavId, String title, String detail,
                           String status, String source, Long operatorId, String operatorName,
                           OffsetDateTime occurredAt) {}
    public record Address(long id, long userId, String receiverName, String receiverPhone, String detail,
                          double latitude, double longitude, boolean isDefault) {}
    public record User(long id, String username, String phone, OffsetDateTime createdAt, List<Address> addresses) {}
    public record Goods(long id, String name, String category, BigDecimal price, int stock, double weight, int status) {}
    public record OrderItem(long id, long goodsId, String goodsName, int count, BigDecimal price) {}
    public record AddressSnapshot(String receiverName, String receiverPhone, String detail) {}
    public record Order(long id, String orderNo, long userId, long addressId, BigDecimal totalPrice,
                        String status, OffsetDateTime createdAt, AddressSnapshot addressSnapshot, List<OrderItem> items) {}
    public record Task(long id, long orderId, long uavId, String taskStatus, OffsetDateTime startTime,
                       OffsetDateTime endTime, String failureReason) {}
    public record Pod(long id, String name, String region, String doorStatus, Long uavId) {}
    public record Binding(long id, long staffId, long uavId, OffsetDateTime boundAt,
                          OffsetDateTime unboundAt) {}
    public record Dashboard(long totalUav, long onlineUav, long inPod, long alerts) {}
    public record Session(String id, String userAgent, String ipAddress, OffsetDateTime createdAt, OffsetDateTime expiresAt, boolean current) {}
}
