package com.zhiyuan.asr;

import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Map;

public class AsrHandshakeInterceptor implements HandshakeInterceptor {
    private final AsrSessionService sessions;

    public AsrHandshakeInterceptor(AsrSessionService sessions) {
        this.sessions = sessions;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler handler, Map<String, Object> attributes) {
        String token = UriComponentsBuilder.fromUri(request.getURI()).build()
            .getQueryParams().getFirst("session");
        if (!sessions.consume(token)) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler handler, Exception exception) {
        // No resources are allocated until the WebSocket connection is established.
    }
}
