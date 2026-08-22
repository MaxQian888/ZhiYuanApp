package com.zhiyuan.api;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.zhiyuan.config.TraceIdFilter;

/**
 * The envelope every endpoint answers in.
 *
 * <p>`traceId` is the request's trace id rather than a fresh UUID per response, so the
 * string an operator reads off a failure is the one that finds the log lines. A per-response
 * id looks identical and is useless.
 */
public record ApiResponse<T>(int code, String message,
                             @JsonInclude(JsonInclude.Include.ALWAYS) T data, String traceId) {
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(0, "OK", data, TraceIdFilter.current());
    }

    public static <T> ApiResponse<T> accepted(T data) {
        return new ApiResponse<>(202, "ACCEPTED", data, TraceIdFilter.current());
    }

    public static <T> ApiResponse<T> error(int code, String message, String traceId) {
        return new ApiResponse<>(code, message, traceId);
    }

    private ApiResponse(int code, String message, String traceId) {
        this(code, message, null, traceId);
    }

    /** Errors raised inside a request always carry that request's id. */
    public static <T> ApiResponse<T> error(int code, String message) {
        return new ApiResponse<>(code, message, TraceIdFilter.current());
    }
}
