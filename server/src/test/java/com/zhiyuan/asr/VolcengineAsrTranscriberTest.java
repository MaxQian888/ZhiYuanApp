package com.zhiyuan.asr;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import static org.assertj.core.api.Assertions.assertThat;

class VolcengineAsrTranscriberTest {
    private HttpServer server;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @AfterEach
    void stopServer() {
        if (server != null) server.stop(0);
        worker.shutdownNow();
    }

    @Test
    void sendsAnInMemoryWavWithServerSideCredentialsAndReturnsOnlyTheTranscript() throws Exception {
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> requestBody = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/recognize", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("X-Api-Key"));
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "{\"result\":{\"text\":\"无人机一号返航\"}}"
                .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        VolcengineAsrTranscriber transcriber = new VolcengineAsrTranscriber(
            HttpClient.newHttpClient(), new ObjectMapper(),
            URI.create("http://localhost:" + server.getAddress().getPort() + "/recognize"),
            new VolcengineCredentials("server-secret", "", ""), "volc.seedasr.auc_turbo",
            Duration.ofSeconds(2), worker);

        String transcript = transcriber.transcribe(new byte[] {1, 2, 3, 4}, "zh-CN", 7)
            .result().toCompletableFuture().get();

        assertThat(transcript).isEqualTo("无人机一号返航");
        assertThat(authorization.get()).isEqualTo("server-secret");
        String audio = new ObjectMapper().readTree(requestBody.get()).get("audio").get("data").asText();
        assertThat(new String(Base64.getDecoder().decode(audio), 0, 4, StandardCharsets.US_ASCII))
            .isEqualTo("RIFF");
        assertThat(requestBody.get()).contains("\"uid\":\"7\"")
            .doesNotContain("server-secret");
    }
}
