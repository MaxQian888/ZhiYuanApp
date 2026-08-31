package com.zhiyuan.asr;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Arrays;
import java.util.Base64;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicReference;

public class VolcengineAsrTranscriber implements AsrTranscriber {
    public static final String FLASH_RESOURCE_ID = "volc.bigasr.auc_turbo";
    public static final String FLASH_ENDPOINT =
        "https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash";
    private final HttpClient http;
    private final ObjectMapper json;
    private final URI endpoint;
    private final VolcengineCredentials credentials;
    private final Duration timeout;
    private final ExecutorService worker;

    public VolcengineAsrTranscriber(HttpClient http, ObjectMapper json, URI endpoint,
                                    VolcengineCredentials credentials, Duration timeout,
                                    ExecutorService worker) {
        this.http = http;
        this.json = json;
        this.endpoint = endpoint;
        this.credentials = credentials;
        this.timeout = timeout;
        this.worker = worker;
    }

    @Override
    public AsrTranscription transcribe(byte[] pcm16le) {
        if (!credentials.configured()) {
            return AsrTranscription.of(CompletableFuture.failedFuture(
                new IllegalStateException("Volcengine ASR credentials are not configured")));
        }
        return new RequestTranscription(pcm16le);
    }

    private String transcript(HttpResponse<String> response) {
        String providerStatus = response.headers().firstValue("X-Api-Status-Code")
            .orElseThrow(() -> new IllegalStateException(
                "Volcengine ASR response omitted X-Api-Status-Code"));
        if (response.statusCode() >= 300 || !"20000000".equals(providerStatus)) {
            throw new IllegalStateException("Volcengine ASR rejected the request");
        }
        JsonNode body;
        try {
            body = json.readTree(response.body());
        } catch (RuntimeException failure) {
            throw new IllegalStateException("Volcengine ASR returned an invalid response", failure);
        }
        String text = body.path("result").path("text").asText().trim();
        if (text.isEmpty()) throw new IllegalStateException("Volcengine ASR returned no transcript");
        return text;
    }

    static byte[] wav(byte[] pcm16le) {
        ByteBuffer output = ByteBuffer.allocate(44 + pcm16le.length).order(ByteOrder.LITTLE_ENDIAN);
        output.put(new byte[] {'R', 'I', 'F', 'F'}).putInt(36 + pcm16le.length);
        output.put(new byte[] {'W', 'A', 'V', 'E', 'f', 'm', 't', ' '}).putInt(16);
        output.putShort((short) 1).putShort((short) 1).putInt(16_000).putInt(32_000);
        output.putShort((short) 2).putShort((short) 16);
        output.put(new byte[] {'d', 'a', 't', 'a'}).putInt(pcm16le.length).put(pcm16le);
        return output.array();
    }

    private final class RequestTranscription implements AsrTranscription {
        private final CompletableFuture<String> result = new CompletableFuture<>();
        private final AtomicReference<byte[]> pcm;
        private final AtomicReference<byte[]> requestBody = new AtomicReference<>();
        private final AtomicReference<CompletableFuture<HttpResponse<String>>> request =
            new AtomicReference<>();
        private final Object requestLifecycle = new Object();
        private final Future<?> preparation;

        private RequestTranscription(byte[] pcm) {
            this.pcm = new AtomicReference<>(pcm);
            this.preparation = worker.submit(this::prepareAndSend);
        }

        private void prepareAndSend() {
            byte[] audio = pcm.getAndSet(null);
            if (audio == null || result.isCancelled()) {
                wipe(audio);
                return;
            }
            byte[] body;
            try {
                body = requestBody(audio, credentials.uid());
            } finally {
                wipe(audio);
            }
            requestBody.set(body);
            if (result.isCancelled()) {
                wipe(requestBody.getAndSet(null));
                return;
            }
            HttpRequest.Builder builder = HttpRequest.newBuilder(endpoint)
                .timeout(timeout)
                .header("Content-Type", "application/json")
                .header("X-Api-Resource-Id", FLASH_RESOURCE_ID)
                .header("X-Api-Request-Id", UUID.randomUUID().toString())
                .header("X-Api-Sequence", "-1")
                .POST(HttpRequest.BodyPublishers.ofByteArray(body));
            credentials.apply(builder);
            CompletableFuture<HttpResponse<String>> pending;
            try {
                synchronized (requestLifecycle) {
                    if (result.isCancelled()) {
                        wipe(requestBody.getAndSet(null));
                        return;
                    }
                    pending = http.sendAsync(builder.build(),
                        HttpResponse.BodyHandlers.ofString());
                    request.set(pending);
                }
            } catch (RuntimeException failure) {
                wipe(requestBody.getAndSet(null));
                result.completeExceptionally(failure);
                return;
            }
            pending.whenComplete((response, failure) -> {
                try {
                    if (failure == null) result.complete(transcript(response));
                    else result.completeExceptionally(failure);
                } catch (RuntimeException invalid) {
                    result.completeExceptionally(invalid);
                } finally {
                    request.compareAndSet(pending, null);
                    wipe(requestBody.getAndSet(null));
                }
            });
        }

        @Override
        public CompletableFuture<String> result() {
            return result;
        }

        @Override
        public void cancel() {
            result.cancel(false);
            preparation.cancel(true);
            CompletableFuture<HttpResponse<String>> pending;
            synchronized (requestLifecycle) {
                pending = request.getAndSet(null);
                if (pending == null) wipe(requestBody.getAndSet(null));
            }
            if (pending != null) pending.cancel(true);
            wipe(pcm.getAndSet(null));
        }
    }

    private static byte[] requestBody(byte[] pcm, String uid) {
        byte[] wave = wav(pcm);
        byte[] encoded = Base64.getEncoder().encode(wave);
        wipe(wave);
        byte[] prefix = ("{\"user\":{\"uid\":\"" + uid
            + "\"},\"audio\":{\"data\":\"").getBytes(StandardCharsets.UTF_8);
        byte[] suffix = "\"},\"request\":{\"model_name\":\"bigmodel\"}}"
            .getBytes(StandardCharsets.UTF_8);
        byte[] body = new byte[prefix.length + encoded.length + suffix.length];
        System.arraycopy(prefix, 0, body, 0, prefix.length);
        System.arraycopy(encoded, 0, body, prefix.length, encoded.length);
        System.arraycopy(suffix, 0, body, prefix.length + encoded.length, suffix.length);
        wipe(encoded);
        return body;
    }

    private static void wipe(byte[] value) {
        if (value != null) Arrays.fill(value, (byte) 0);
    }
}
