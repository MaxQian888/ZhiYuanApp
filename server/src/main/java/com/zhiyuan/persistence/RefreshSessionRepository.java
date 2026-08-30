package com.zhiyuan.persistence;

import com.zhiyuan.domain.Models;
import com.zhiyuan.security.TokenDigest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

@Repository
public class RefreshSessionRepository {
    public record StoredSession(String id, long staffId, String tokenHash, String userAgent, String ipAddress,
                                OffsetDateTime createdAt, OffsetDateTime expiresAt) {}

    private final JdbcTemplate jdbc;

    public RefreshSessionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void create(String id, long staffId, String token, String userAgent, String ipAddress,
                       OffsetDateTime createdAt, OffsetDateTime expiresAt) {
        jdbc.update("INSERT INTO refresh_sessions (id, staff_id, token_hash, user_agent, ip_address, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            id, staffId, TokenDigest.sha256(token), userAgent, ipAddress, timestamp(createdAt), timestamp(expiresAt));
    }

    @Transactional
    public StoredSession consume(String id, String token) {
        List<StoredSession> matches = jdbc.query("SELECT * FROM refresh_sessions WHERE id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP FOR UPDATE",
            (rs, row) -> new StoredSession(rs.getString("id"), rs.getLong("staff_id"), rs.getString("token_hash"),
                rs.getString("user_agent"), rs.getString("ip_address"), offset(rs.getTimestamp("created_at")),
                offset(rs.getTimestamp("expires_at"))), id, TokenDigest.sha256(token));
        if (matches.isEmpty()) return null;
        jdbc.update("UPDATE refresh_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?", id);
        return matches.get(0);
    }

    public List<Models.Session> findActive(long staffId, String currentToken) {
        String currentHash = currentToken == null ? "" : TokenDigest.sha256(currentToken);
        return jdbc.query("SELECT * FROM refresh_sessions WHERE staff_id = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP ORDER BY created_at DESC",
            (rs, row) -> new Models.Session(rs.getString("id"), rs.getString("user_agent"), rs.getString("ip_address"),
                offset(rs.getTimestamp("created_at")), offset(rs.getTimestamp("expires_at")), currentHash.equals(rs.getString("token_hash"))), staffId);
    }

    public boolean revoke(long staffId, String id) {
        return jdbc.update("UPDATE refresh_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE staff_id = ? AND id = ? AND revoked_at IS NULL", staffId, id) > 0;
    }

    public void revokeByToken(String id, String token) {
        jdbc.update("UPDATE refresh_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND token_hash = ? AND revoked_at IS NULL", id, TokenDigest.sha256(token));
    }

    public void revokeAll(long staffId) {
        jdbc.update("UPDATE refresh_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE staff_id = ? AND revoked_at IS NULL", staffId);
    }

    private static Timestamp timestamp(OffsetDateTime value) {
        return Timestamp.from(value.toInstant());
    }

    private static OffsetDateTime offset(Timestamp value) {
        return value.toInstant().atOffset(ZoneOffset.UTC);
    }
}
