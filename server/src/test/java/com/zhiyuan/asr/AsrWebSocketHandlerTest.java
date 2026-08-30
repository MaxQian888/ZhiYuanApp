package com.zhiyuan.asr;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AsrWebSocketHandlerTest {
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    @AfterEach
    void shutdown() {
        scheduler.shutdownNow();
    }

    @Test
    void streamsPcmIntoOneBoundedSessionAndReturnsTheFinalTranscript() throws Exception {
        CompletableFuture<String> result = new CompletableFuture<>();
        AsrTranscriber transcriber = (audio, locale, staffId) -> {
            assertThat(audio).containsExactly(1, 2, 3, 4);
            assertThat(locale).isEqualTo("zh-CN");
            assertThat(staffId).isEqualTo(7);
            return AsrTranscription.of(result);
        };
        AsrWebSocketHandler handler = new AsrWebSocketHandler(
            transcriber, new ObjectMapper(), scheduler, 15);
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("socket-1");
        when(session.getAttributes()).thenReturn(Map.of("staffId", 7L));
        when(session.isOpen()).thenReturn(true);

        handler.afterConnectionEstablished(session);
        handler.handleMessage(session, new TextMessage(
            "{\"type\":\"start\",\"locale\":\"zh-CN\",\"mimeType\":\"audio/pcm;rate=16000\"}"));
        handler.handleMessage(session, new BinaryMessage(new byte[] {1, 2, 3, 4}));
        handler.handleMessage(session, new TextMessage("{\"type\":\"stop\"}"));
        result.complete("无人机一号返航");

        ArgumentCaptor<WebSocketMessage<?>> message = ArgumentCaptor.forClass(WebSocketMessage.class);
        verify(session).sendMessage(message.capture());
        assertThat(((TextMessage) message.getValue()).getPayload())
            .isEqualTo("{\"type\":\"final\",\"text\":\"无人机一号返航\"}");
        verify(session).close(CloseStatus.NORMAL);
    }

    @Test
    void disconnectCancelsTranscriptionAndErasesItsOwnedPcmSnapshot() throws Exception {
        AtomicReference<byte[]> ownedAudio = new AtomicReference<>();
        AtomicBoolean cancelled = new AtomicBoolean();
        AsrTranscriber transcriber = (audio, locale, staffId) -> {
            ownedAudio.set(audio);
            return new AsrTranscription() {
                @Override public CompletableFuture<String> result() {
                    return new CompletableFuture<>();
                }
                @Override public void cancel() {
                    cancelled.set(true);
                }
            };
        };
        AsrWebSocketHandler handler = new AsrWebSocketHandler(
            transcriber, new ObjectMapper(), scheduler, 15);
        WebSocketSession session = mock(WebSocketSession.class);
        when(session.getId()).thenReturn("socket-2");
        when(session.getAttributes()).thenReturn(Map.of("staffId", 7L));
        when(session.isOpen()).thenReturn(true);

        handler.afterConnectionEstablished(session);
        handler.handleMessage(session, new TextMessage(
            "{\"type\":\"start\",\"locale\":\"zh-CN\",\"mimeType\":\"audio/pcm;rate=16000\"}"));
        handler.handleMessage(session, new BinaryMessage(new byte[] {9, 8, 7, 6}));
        handler.handleMessage(session, new TextMessage("{\"type\":\"stop\"}"));
        handler.afterConnectionClosed(session, CloseStatus.GOING_AWAY);

        assertThat(cancelled).isTrue();
        assertThat(ownedAudio.get()).containsOnly(0);
    }
}
