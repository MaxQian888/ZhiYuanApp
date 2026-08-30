package com.zhiyuan.config;

import com.zhiyuan.asr.AsrHandshakeInterceptor;
import com.zhiyuan.asr.AsrWebSocketHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class AsrWebSocketConfiguration implements WebSocketConfigurer {
    private final AsrWebSocketHandler handler;
    private final AsrHandshakeInterceptor handshake;
    private final String[] allowedOrigins;

    public AsrWebSocketConfiguration(AsrWebSocketHandler handler,
                                     AsrHandshakeInterceptor handshake,
                                     @Value("${zhiyuan.cors-origins}") String origins) {
        this.handler = handler;
        this.handshake = handshake;
        this.allowedOrigins = SecurityConfig.parseOrigins(origins).toArray(String[]::new);
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/api/v1/asr/ws")
            .addInterceptors(handshake)
            .setAllowedOrigins(allowedOrigins);
    }
}
