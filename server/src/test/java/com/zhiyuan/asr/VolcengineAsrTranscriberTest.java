package com.zhiyuan.asr;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.net.InetSocketAddress;
import java.net.Authenticator;
import java.net.CookieHandler;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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
        AtomicReference<String> resourceId = new AtomicReference<>();
        AtomicReference<String> requestBody = new AtomicReference<>();
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/recognize", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("X-Api-Key"));
            resourceId.set(exchange.getRequestHeaders().getFirst("X-Api-Resource-Id"));
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "{\"result\":{\"text\":\"无人机一号返航\"}}"
                .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("X-Api-Status-Code", "20000000");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();

        VolcengineAsrTranscriber transcriber = new VolcengineAsrTranscriber(
            HttpClient.newHttpClient(), new ObjectMapper(),
            URI.create("http://localhost:" + server.getAddress().getPort() + "/recognize"),
            new VolcengineCredentials("server-secret", "", ""), Duration.ofSeconds(2), worker);

        String transcript = transcriber.transcribe(new byte[] {1, 2, 3, 4})
            .result().toCompletableFuture().get();

        assertThat(transcript).isEqualTo("无人机一号返航");
        assertThat(authorization.get()).isEqualTo("server-secret");
        assertThat(resourceId.get()).isEqualTo(VolcengineAsrTranscriber.FLASH_RESOURCE_ID);
        String audio = new ObjectMapper().readTree(requestBody.get()).get("audio").get("data").asText();
        assertThat(new String(Base64.getDecoder().decode(audio), 0, 4, StandardCharsets.US_ASCII))
            .isEqualTo("RIFF");
        assertThat(requestBody.get()).contains("\"uid\":\"server-secret\"")
            .doesNotContain("language");
    }

    @Test
    void rejectsAResponseThatOmitsTheAuthoritativeProviderStatusHeader() throws Exception {
        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/recognize", exchange -> {
            exchange.getRequestBody().readAllBytes();
            byte[] response = "{\"result\":{\"text\":\"must not be trusted\"}}"
                .getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        VolcengineAsrTranscriber transcriber = new VolcengineAsrTranscriber(
            HttpClient.newHttpClient(), new ObjectMapper(),
            URI.create("http://localhost:" + server.getAddress().getPort() + "/recognize"),
            new VolcengineCredentials("server-secret", "", ""), Duration.ofSeconds(2), worker);

        assertThatThrownBy(() -> transcriber.transcribe(new byte[] {1, 2})
            .result().toCompletableFuture().get())
            .hasRootCauseMessage("Volcengine ASR response omitted X-Api-Status-Code");
    }

    @Test
    void cancellationCannotLoseARequestBeingPublishedByTheWorker() throws Exception {
        BlockingHttpClient http = new BlockingHttpClient();
        VolcengineAsrTranscriber transcriber = new VolcengineAsrTranscriber(
            http, new ObjectMapper(), URI.create("http://asr.test/recognize"),
            new VolcengineCredentials("server-secret", "", ""), Duration.ofSeconds(2), worker);

        AsrTranscription transcription = transcriber.transcribe(new byte[] {1, 2, 3, 4});
        assertThat(http.sendStarted.await(2, TimeUnit.SECONDS)).isTrue();
        CompletableFuture<Void> cancellation;
        try {
            cancellation = CompletableFuture.runAsync(transcription::cancel);
            assertThat(http.sendInterrupted.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(cancellation).isNotDone();
        } finally {
            http.allowSendReturn.countDown();
        }

        cancellation.get(2, TimeUnit.SECONDS);
        assertThat(http.pending).isCancelled();
    }

    private static final class BlockingHttpClient extends HttpClient {
        private final HttpClient delegate = HttpClient.newHttpClient();
        private final CountDownLatch sendStarted = new CountDownLatch(1);
        private final CountDownLatch sendInterrupted = new CountDownLatch(1);
        private final CountDownLatch allowSendReturn = new CountDownLatch(1);
        private final CompletableFuture<HttpResponse<String>> pending = new CompletableFuture<>();

        @Override
        @SuppressWarnings("unchecked")
        public <T> CompletableFuture<HttpResponse<T>> sendAsync(HttpRequest request,
                                                                 HttpResponse.BodyHandler<T> handler) {
            sendStarted.countDown();
            boolean interrupted = false;
            while (true) {
                try {
                    allowSendReturn.await();
                    break;
                } catch (InterruptedException ignored) {
                    interrupted = true;
                    sendInterrupted.countDown();
                }
            }
            if (interrupted) Thread.currentThread().interrupt();
            return (CompletableFuture<HttpResponse<T>>) (CompletableFuture<?>) pending;
        }

        @Override
        public <T> CompletableFuture<HttpResponse<T>> sendAsync(HttpRequest request,
                                                                 HttpResponse.BodyHandler<T> handler,
                                                                 HttpResponse.PushPromiseHandler<T> push) {
            return sendAsync(request, handler);
        }

        @Override
        public <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler)
            throws IOException, InterruptedException {
            throw new UnsupportedOperationException();
        }

        @Override public Optional<CookieHandler> cookieHandler() { return delegate.cookieHandler(); }
        @Override public Optional<Duration> connectTimeout() { return delegate.connectTimeout(); }
        @Override public Redirect followRedirects() { return delegate.followRedirects(); }
        @Override public Optional<ProxySelector> proxy() { return delegate.proxy(); }
        @Override public SSLContext sslContext() { return delegate.sslContext(); }
        @Override public SSLParameters sslParameters() { return delegate.sslParameters(); }
        @Override public Optional<Authenticator> authenticator() { return delegate.authenticator(); }
        @Override public Version version() { return delegate.version(); }
        @Override public Optional<Executor> executor() { return delegate.executor(); }
    }
}
