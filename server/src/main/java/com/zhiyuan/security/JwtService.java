package com.zhiyuan.security;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.zhiyuan.persistence.AdminEntity;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

@Service
public class JwtService {
    private final Algorithm algorithm;
    private final long accessMinutes;
    private final long refreshDays;

    public JwtService(@Value("${zhiyuan.jwt-secret}") String secret,
                      @Value("${zhiyuan.access-minutes}") long accessMinutes,
                      @Value("${zhiyuan.refresh-days}") long refreshDays) {
        this.algorithm = Algorithm.HMAC256(secret);
        this.accessMinutes = accessMinutes;
        this.refreshDays = refreshDays;
    }

    public String accessToken(AdminEntity admin) {
        return token(admin, "access", Instant.now().plus(accessMinutes, ChronoUnit.MINUTES));
    }

    public String refreshToken(AdminEntity admin) {
        return token(admin, "refresh", Instant.now().plus(refreshDays, ChronoUnit.DAYS));
    }

    private String token(AdminEntity admin, String type, Instant expiresAt) {
        return JWT.create()
            .withJWTId(UUID.randomUUID().toString())
            .withIssuer("zhiyuan")
            .withSubject(String.valueOf(admin.getId()))
            .withClaim("username", admin.getUsername())
            .withClaim("role", admin.getRole())
            .withClaim("tokenVersion", admin.getTokenVersion())
            .withClaim("type", type)
            .withIssuedAt(Instant.now())
            .withExpiresAt(expiresAt)
            .sign(algorithm);
    }

    public DecodedJWT verify(String token, String expectedType) {
        DecodedJWT decoded = JWT.require(algorithm).withIssuer("zhiyuan").build().verify(token);
        if (!expectedType.equals(decoded.getClaim("type").asString())) {
            throw new IllegalArgumentException("Invalid token type");
        }
        return decoded;
    }
}
