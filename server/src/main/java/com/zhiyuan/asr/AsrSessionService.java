package com.zhiyuan.asr;

import com.zhiyuan.security.TokenDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;
import org.springframework.web.util.UriComponentsBuilder;

@Service
public class AsrSessionService {
    private static final SecureRandom RANDOM = new SecureRandom();

    private final JdbcTemplate jdbc;
    private final Clock clock;
    private final String publicWebsocketUrl;
    private final long ticketSeconds;

    public AsrSessionService(JdbcTemplate jdbc, Clock clock,
                             @Value("${zhiyuan.asr.public-websocket-url}") String publicWebsocketUrl,
                             @Value("${zhiyuan.asr.ticket-seconds:30}") long ticketSeconds) {
        if (ticketSeconds < 1 || ticketSeconds > 60) {
            throw new IllegalArgumentException("ASR ticket lifetime must be between 1 and 60 seconds");
        }
        URI websocketUri = URI.create(publicWebsocketUrl);
        if (!("ws".equals(websocketUri.getScheme()) || "wss".equals(websocketUri.getScheme()))) {
            throw new IllegalArgumentException("ASR public WebSocket URL must use ws:// or wss://");
        }
        this.jdbc = jdbc;
        this.clock = clock;
        this.publicWebsocketUrl = publicWebsocketUrl;
        this.ticketSeconds = ticketSeconds;
    }

    @Transactional
    public CreatedSession create(long staffId) {
        Instant now = clock.instant();
        Instant expiresAt = now.plusSeconds(ticketSeconds);
        String sessionId = UUID.randomUUID().toString();
        byte[] tokenBytes = new byte[32];
        RANDOM.nextBytes(tokenBytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(tokenBytes);

        jdbc.update("""
            INSERT INTO asr_sessions(session_id, token_hash, staff_id, expires_at, created_at)
            VALUES (?, ?, ?, ?, ?)
            """, sessionId, TokenDigest.sha256(token), staffId, Timestamp.from(expiresAt),
            Timestamp.from(now));

        String websocketUrl = UriComponentsBuilder.fromUri(URI.create(publicWebsocketUrl))
            .queryParam("session", token).build().encode().toUriString();
        return new CreatedSession(sessionId, websocketUrl,
            OffsetDateTime.ofInstant(expiresAt, ZoneOffset.UTC));
    }

    @Transactional
    public Optional<ClaimedSession> consume(String token) {
        if (token == null || token.isBlank()) return Optional.empty();
        Instant now = clock.instant();
        String tokenHash = TokenDigest.sha256(token);
        int claimed = jdbc.update("""
            UPDATE asr_sessions SET consumed_at = ?
            WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
            """, Timestamp.from(now), tokenHash, Timestamp.from(now));
        if (claimed != 1) return Optional.empty();
        ClaimedSession session = jdbc.queryForObject("""
            SELECT staff_id FROM asr_sessions WHERE token_hash = ?
            """, (result, row) -> new ClaimedSession(result.getLong("staff_id")), tokenHash);
        return Optional.ofNullable(session);
    }

    public int purgeExpired() {
        return jdbc.update("DELETE FROM asr_sessions WHERE expires_at < ? LIMIT 500",
            Timestamp.from(clock.instant().minusSeconds(3600)));
    }

    public record CreatedSession(String sessionId, String websocketUrl, OffsetDateTime expiresAt) {}
    public record ClaimedSession(long staffId) {}
}
