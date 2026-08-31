package com.zhiyuan.asr;

import com.fasterxml.jackson.annotation.JsonInclude;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public class AsrWebSocketHandler extends AbstractWebSocketHandler {
    private static final int PCM_BYTES_PER_SECOND = 16_000 * 2;

    private final AsrTranscriber transcriber;
    private final ObjectMapper json;
    private final ScheduledExecutorService scheduler;
    private final int maxSeconds;
    private final Map<String, SessionState> states = new ConcurrentHashMap<>();

    public AsrWebSocketHandler(AsrTranscriber transcriber, ObjectMapper json,
                               ScheduledExecutorService scheduler, int maxSeconds) {
        if (maxSeconds < 1 || maxSeconds > 15) {
            throw new IllegalArgumentException("ASR audio limit must be between 1 and 15 seconds");
        }
        this.transcriber = transcriber;
        this.json = json;
        this.scheduler = scheduler;
        this.maxSeconds = maxSeconds;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        SessionState state = new SessionState(PCM_BYTES_PER_SECOND * maxSeconds);
        states.put(session.getId(), state);
        state.setTimeout(scheduler.schedule(() -> expire(session, state), maxSeconds,
            TimeUnit.SECONDS));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        SessionState state = states.get(session.getId());
        if (state == null) return;
        JsonNode frame;
        try {
            frame = json.readTree(message.getPayload());
        } catch (RuntimeException malformed) {
            fail(session, "failed", CloseStatus.BAD_DATA);
            return;
        }
        String type = frame.path("type").asText();
        if ("start".equals(type)) {
            String locale = frame.path("locale").asText();
            String mimeType = frame.path("mimeType").asText();
            if (!("zh-CN".equals(locale) || "en".equals(locale))
                || !"audio/pcm;rate=16000".equals(mimeType) || !state.start()) {
                fail(session, "failed", CloseStatus.BAD_DATA);
                return;
            }
        } else if ("stop".equals(type)) {
            finish(session, state);
        } else {
            fail(session, "failed", CloseStatus.BAD_DATA);
        }
    }

    private void expire(WebSocketSession session, SessionState state) {
        if (state.hasStarted()) finish(session, state);
        else fail(session, "no-speech", CloseStatus.NORMAL);
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
        SessionState state = states.get(session.getId());
        if (state == null || !state.append(message.getPayload())) {
            fail(session, "failed", CloseStatus.TOO_BIG_TO_PROCESS);
        }
    }

    private void finish(WebSocketSession session, SessionState state) {
        AudioSnapshot snapshot = state.finish();
        if (snapshot == null) return;
        byte[] audio = snapshot.audio();
        if (audio.length == 0) {
            Arrays.fill(audio, (byte) 0);
            fail(session, "no-speech", CloseStatus.NORMAL);
            return;
        }
        AsrTranscription transcription;
        try {
            transcription = transcriber.transcribe(audio);
        } catch (RuntimeException rejected) {
            Arrays.fill(audio, (byte) 0);
            fail(session, "network", CloseStatus.NORMAL);
            return;
        }
        if (!state.attach(transcription, audio)) {
            transcription.cancel();
            Arrays.fill(audio, (byte) 0);
            return;
        }
        transcription.result().whenComplete((text, failure) -> {
            try {
                if (failure == null) send(session, new GatewayMessage("final", text, null));
                else send(session, new GatewayMessage("error", null, "network"));
                close(session, CloseStatus.NORMAL);
            } finally {
                cleanup(session.getId());
            }
        });
    }

    private void fail(WebSocketSession session, String reason, CloseStatus status) {
        send(session, new GatewayMessage("error", null, reason));
        close(session, status);
        cleanup(session.getId());
    }

    private void send(WebSocketSession session, GatewayMessage message) {
        if (!session.isOpen()) return;
        try {
            synchronized (session) {
                session.sendMessage(new TextMessage(json.writeValueAsString(message)));
            }
        } catch (IOException | RuntimeException ignored) {
            close(session, CloseStatus.SERVER_ERROR);
        }
    }

    private static void close(WebSocketSession session, CloseStatus status) {
        try {
            if (session.isOpen()) session.close(status);
        } catch (IOException ignored) {
            // The peer is already gone.
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        cleanup(session.getId());
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        close(session, CloseStatus.SERVER_ERROR);
        cleanup(session.getId());
    }

    private void cleanup(String socketId) {
        SessionState state = states.remove(socketId);
        if (state != null) state.clear();
    }

    @JsonInclude(JsonInclude.Include.NON_NULL)
    private record GatewayMessage(String type, String text, String reason) {}
    private record AudioSnapshot(byte[] audio) {}

    private static final class SessionState {
        private final int maxBytes;
        private byte[] audio;
        private int length;
        private boolean started;
        private boolean finished;
        private boolean cleared;
        private ScheduledFuture<?> timeout;
        private AsrTranscription transcription;
        private byte[] inFlightAudio;

        private SessionState(int maxBytes) {
            this.maxBytes = maxBytes;
        }

        private synchronized boolean start() {
            if (started || finished) return false;
            started = true;
            audio = new byte[maxBytes];
            return true;
        }

        private synchronized boolean append(ByteBuffer source) {
            if (!started || finished || source.remaining() > audio.length - length) return false;
            int bytes = source.remaining();
            source.get(audio, length, bytes);
            length += bytes;
            return true;
        }

        private synchronized AudioSnapshot finish() {
            if (!started || finished) return null;
            finished = true;
            if (timeout != null) timeout.cancel(false);
            byte[] snapshot = Arrays.copyOf(audio, length);
            Arrays.fill(audio, 0, length, (byte) 0);
            audio = null;
            length = 0;
            return new AudioSnapshot(snapshot);
        }

        private synchronized boolean hasStarted() {
            return started && !finished;
        }

        private synchronized void setTimeout(ScheduledFuture<?> timeout) {
            this.timeout = timeout;
        }

        private synchronized boolean attach(AsrTranscription transcription, byte[] audio) {
            if (cleared || inFlightAudio != null) return false;
            this.transcription = transcription;
            this.inFlightAudio = audio;
            return true;
        }

        private synchronized void clear() {
            if (cleared) return;
            cleared = true;
            if (timeout != null) timeout.cancel(false);
            if (transcription != null) transcription.cancel();
            if (audio != null) Arrays.fill(audio, 0, length, (byte) 0);
            if (inFlightAudio != null) Arrays.fill(inFlightAudio, (byte) 0);
            audio = null;
            inFlightAudio = null;
            length = 0;
            finished = true;
        }
    }
}
