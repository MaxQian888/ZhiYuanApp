package com.zhiyuan.asr;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.Arrays;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
    "zhiyuan.realtime.publisher-enabled=false",
    "zhiyuan.asr.enabled=true",
    "zhiyuan.asr.public-websocket-url=ws://api.test/api/v1/asr/ws"
})
@Import(AsrGatewayIntegrationTest.FakeTranscriberConfiguration.class)
class AsrGatewayIntegrationTest {
    @LocalServerPort int port;
    @Autowired ObjectMapper json;
    @Autowired AtomicReference<byte[]> receivedAudio;

    @Test
    void authenticatesOneWebSocketWithOneTicketAndReturnsTheFinalTranscript() throws Exception {
        HttpClient http = HttpClient.newHttpClient();
        String login = http.send(HttpRequest.newBuilder(uri("/api/v1/auth/login"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(
                    "{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .build(), HttpResponse.BodyHandlers.ofString()).body();
        String accessToken = json.readTree(login).get("data").get("accessToken").asText();
        String reservation = http.send(HttpRequest.newBuilder(uri("/api/v1/asr/sessions"))
                .header("Authorization", "Bearer " + accessToken)
                .POST(HttpRequest.BodyPublishers.noBody()).build(),
            HttpResponse.BodyHandlers.ofString()).body();
        String configuredUrl = json.readTree(reservation).get("data").get("websocketUrl").asText();
        URI websocketUri = URI.create(configuredUrl.replace("ws://api.test", "ws://localhost:" + port));

        CompletableFuture<String> finalMessage = new CompletableFuture<>();
        WebSocket socket = http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(3))
            .buildAsync(websocketUri, listener(finalMessage)).get(3, TimeUnit.SECONDS);
        socket.sendText(
            "{\"type\":\"start\",\"locale\":\"zh-CN\",\"mimeType\":\"audio/pcm;rate=16000\"}",
            true).join();
        socket.sendBinary(ByteBuffer.wrap(new byte[] {1, 2, 3, 4}), true).join();
        socket.sendText("{\"type\":\"stop\"}", true).join();

        assertThat(finalMessage.get(3, TimeUnit.SECONDS))
            .isEqualTo("{\"type\":\"final\",\"text\":\"无人机一号返航\"}");
        assertThat(receivedAudio.get()).containsExactly(1, 2, 3, 4);
        assertThatThrownBy(() -> http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(3))
            .buildAsync(websocketUri, new WebSocket.Listener() {}).join())
            .hasCauseInstanceOf(java.net.http.WebSocketHandshakeException.class);
    }

    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    private static WebSocket.Listener listener(CompletableFuture<String> message) {
        return new WebSocket.Listener() {
            private final StringBuilder text = new StringBuilder();

            @Override
            public void onOpen(WebSocket webSocket) {
                webSocket.request(1);
            }

            @Override
            public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
                text.append(data);
                if (last) message.complete(text.toString());
                webSocket.request(1);
                return null;
            }
        };
    }

    @TestConfiguration
    static class FakeTranscriberConfiguration {
        @Bean
        AtomicReference<byte[]> receivedAudio() {
            return new AtomicReference<>();
        }

        @Bean
        @Primary
        AsrTranscriber fakeAsrTranscriber(AtomicReference<byte[]> receivedAudio) {
            return (audio, locale, staffId) -> {
                receivedAudio.set(Arrays.copyOf(audio, audio.length));
                return AsrTranscription.of(
                    CompletableFuture.completedFuture("无人机一号返航"));
            };
        }
    }
}
