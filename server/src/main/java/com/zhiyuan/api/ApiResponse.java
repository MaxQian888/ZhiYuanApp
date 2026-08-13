package com.zhiyuan.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.UUID;

public record ApiResponse<T>(int code, String message,
                             @JsonInclude(JsonInclude.Include.ALWAYS) T data, String traceId) {
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(0, "OK", data, UUID.randomUUID().toString());
    }

    public static <T> ApiResponse<T> accepted(T data) {
        return new ApiResponse<>(202, "ACCEPTED", data, UUID.randomUUID().toString());
    }

    public static <T> ApiResponse<T> error(int code, String message, String traceId) {
        return new ApiResponse<>(code, message, null, traceId);
    }
}
