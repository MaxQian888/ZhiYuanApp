package com.zhiyuan.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.core.annotation.Order;
import org.springframework.core.Ordered;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Gives every request a trace id, and makes sure the operator and the log agree on what it is.
 *
 * <p>The id an operator reads off an error message has to be the same string that appears in
 * the logs, or asking them for it is theatre. So one id is generated here, published in the
 * MDC (which the structured log encoder emits on every line), returned in the
 * {@code X-Trace-Id} response header, and put into the {@code traceId} field of the response
 * envelope by {@link com.zhiyuan.api.ApiResponse}.
 *
 * <p>An inbound W3C {@code traceparent} wins, so a request that arrives from a load balancer
 * or another service keeps the id that system already knows it by.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class TraceIdFilter extends OncePerRequestFilter {

    public static final String HEADER = "X-Trace-Id";
    public static final String MDC_KEY = "traceId";

    /** version "-" trace-id "-" parent-id "-" flags, per the W3C trace context spec. */
    private static final Pattern TRACEPARENT =
        Pattern.compile("^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$");

    /** Bounds what an untrusted client can inject into every log line it causes. */
    private static final int MAX_LENGTH = 64;
    private static final Pattern SAFE = Pattern.compile("^[A-Za-z0-9._-]+$");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String traceId = resolve(request.getHeader("traceparent"), request.getHeader(HEADER));
        MDC.put(MDC_KEY, traceId);
        response.setHeader(HEADER, traceId);
        try {
            chain.doFilter(request, response);
        } finally {
            // Threads are pooled. Leaving the id behind would stamp it on whichever unrelated
            // request picked up the thread next, which is worse than having no id at all.
            MDC.remove(MDC_KEY);
        }
    }

    static String resolve(String traceparent, String supplied) {
        if (traceparent != null) {
            var matcher = TRACEPARENT.matcher(traceparent.trim());
            if (matcher.matches()) return matcher.group(1);
        }
        if (supplied != null) {
            String trimmed = supplied.trim();
            // Validated, not trusted: an id is echoed into headers and every log line, so a
            // client must not be able to put newlines or control characters in either.
            if (!trimmed.isEmpty() && trimmed.length() <= MAX_LENGTH && SAFE.matcher(trimmed).matches()) {
                return trimmed;
            }
        }
        return UUID.randomUUID().toString().replace("-", "");
    }

    /** The current request's trace id, or a fresh one outside a request. */
    public static String current() {
        String traceId = MDC.get(MDC_KEY);
        return traceId == null ? UUID.randomUUID().toString().replace("-", "") : traceId;
    }
}
