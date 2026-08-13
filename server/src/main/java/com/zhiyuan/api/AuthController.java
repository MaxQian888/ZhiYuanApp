package com.zhiyuan.api;

import com.auth0.jwt.interfaces.DecodedJWT;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.zhiyuan.domain.Models;
import com.zhiyuan.persistence.AdminEntity;
import com.zhiyuan.persistence.AdminMapper;
import com.zhiyuan.persistence.RefreshSessionRepository;
import com.zhiyuan.security.JwtService;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.springframework.http.HttpStatus.UNAUTHORIZED;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    public record LoginRequest(@NotBlank String username, @NotBlank String password, String client) {}
    public record PasswordRequest(@NotBlank String currentPassword, @NotBlank String newPassword) {}
    public record ProfileRequest(@NotBlank @Size(max = 80) String displayName,
                                 @Pattern(regexp = "^1[3-9]\\d{9}$") String phone) {}
    public record LoginResult(String accessToken, String refreshToken, Models.Staff staff) {}
    private final AdminMapper admins;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final RefreshSessionRepository sessions;

    public AuthController(AdminMapper admins, PasswordEncoder passwordEncoder, JwtService jwtService, RefreshSessionRepository sessions) {
        this.admins = admins;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.sessions = sessions;
    }

    @PostMapping("/login")
    public ApiResponse<LoginResult> login(@Valid @RequestBody LoginRequest body, HttpServletRequest request, HttpServletResponse response) {
        AdminEntity admin = admins.findByUsername(body.username());
        if (admin == null || !Boolean.TRUE.equals(admin.getEnabled()) || !passwordEncoder.matches(body.password(), admin.getPasswordHash())) {
            throw new ResponseStatusException(UNAUTHORIZED, "Invalid username or password");
        }
        String access = jwtService.accessToken(admin);
        String refresh = jwtService.refreshToken(admin);
        DecodedJWT decoded = jwtService.verify(refresh, "refresh");
        sessions.create(decoded.getId(), admin.getId(), refresh, userAgent(request), request.getRemoteAddr(), OffsetDateTime.now(ZoneOffset.UTC), decoded.getExpiresAtAsInstant().atOffset(ZoneOffset.UTC));
        boolean desktopClient = "tauri".equalsIgnoreCase(body.client());
        if (!desktopClient) response.addHeader(HttpHeaders.SET_COOKIE, refreshCookie(refresh, request.isSecure()).toString());
        String exposedRefresh = desktopClient ? refresh : null;
        return ApiResponse.ok(new LoginResult(access, exposedRefresh, staff(admin)));
    }

    @PostMapping("/refresh")
    @Transactional
    public ApiResponse<Map<String, String>> refresh(HttpServletRequest request, HttpServletResponse response) {
        String desktopToken = request.getHeader("X-Refresh-Token");
        boolean desktopClient = desktopToken != null && !desktopToken.isBlank();
        String token = desktopClient ? desktopToken : cookie(request, "zhiyuan_refresh");
        DecodedJWT decoded;
        try {
            decoded = jwtService.verify(token, "refresh");
        } catch (JWTVerificationException | IllegalArgumentException exception) {
            throw new ResponseStatusException(UNAUTHORIZED, "Refresh session expired");
        }
        RefreshSessionRepository.StoredSession old = sessions.consume(decoded.getId(), token);
        if (old == null) throw new ResponseStatusException(UNAUTHORIZED, "Refresh session expired");
        long staffId;
        try {
            staffId = Long.parseLong(decoded.getSubject());
        } catch (NumberFormatException exception) {
            throw new ResponseStatusException(UNAUTHORIZED, "Refresh session expired");
        }
        AdminEntity admin = admins.findById(staffId);
        Long tokenVersion = decoded.getClaim("tokenVersion").asLong();
        if (admin == null || !Boolean.TRUE.equals(admin.getEnabled()) || tokenVersion == null ||
            !tokenVersion.equals(admin.getTokenVersion())) throw new ResponseStatusException(UNAUTHORIZED, "Refresh session expired");
        String access = jwtService.accessToken(admin);
        String refresh = jwtService.refreshToken(admin);
        DecodedJWT next = jwtService.verify(refresh, "refresh");
        sessions.create(next.getId(), admin.getId(), refresh, old.userAgent(), old.ipAddress(), OffsetDateTime.now(ZoneOffset.UTC), next.getExpiresAtAsInstant().atOffset(ZoneOffset.UTC));
        if (!desktopClient) response.addHeader(HttpHeaders.SET_COOKIE, refreshCookie(refresh, request.isSecure()).toString());
        Map<String, String> result = new LinkedHashMap<>();
        result.put("accessToken", access);
        if (desktopClient) result.put("refreshToken", refresh);
        return ApiResponse.ok(result);
    }

    @PostMapping("/logout")
    public ApiResponse<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        revokeSession(request);
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from("zhiyuan_refresh", "").httpOnly(true).secure(request.isSecure()).sameSite("Strict").path("/api/v1/auth").maxAge(0).build().toString());
        return ApiResponse.ok(null);
    }

    @GetMapping("/me")
    public ApiResponse<Models.Staff> me(Authentication authentication) {
        return ApiResponse.ok(staff(current(authentication)));
    }

    @PatchMapping("/me")
    public ApiResponse<Models.Staff> profile(Authentication authentication, @Valid @RequestBody ProfileRequest body) {
        long id = current(authentication).getId();
        admins.updateProfile(id, body.displayName(), body.phone());
        return ApiResponse.ok(staff(admins.findById(id)));
    }

    @PatchMapping("/password")
    @Transactional
    public ApiResponse<Void> password(Authentication authentication, @Valid @RequestBody PasswordRequest body,
                                      HttpServletRequest request, HttpServletResponse response) {
        AdminEntity admin = current(authentication);
        if (!passwordEncoder.matches(body.currentPassword(), admin.getPasswordHash())) throw new ResponseStatusException(UNAUTHORIZED, "Current password is incorrect");
        if (body.newPassword().length() < 8) throw new IllegalArgumentException("New password must contain at least 8 characters");
        admins.updatePassword(admin.getId(), passwordEncoder.encode(body.newPassword()));
        sessions.revokeAll(admin.getId());
        response.addHeader(HttpHeaders.SET_COOKIE, refreshCookie("", request.isSecure()).mutate().maxAge(0).build().toString());
        return ApiResponse.ok(null);
    }

    @GetMapping("/sessions")
    public ApiResponse<List<Models.Session>> sessions(Authentication authentication, HttpServletRequest request) {
        long staffId = current(authentication).getId();
        String current = refreshToken(request);
        return ApiResponse.ok(sessions.findActive(staffId, current));
    }

    @DeleteMapping("/sessions")
    public ApiResponse<Void> revokeSession(Authentication authentication, @RequestParam String id) {
        long staffId = current(authentication).getId();
        if (!sessions.revoke(staffId, id)) throw new ResponseStatusException(org.springframework.http.HttpStatus.NOT_FOUND, "Session not found");
        return ApiResponse.ok(null);
    }

    private AdminEntity current(Authentication authentication) {
        AdminEntity admin = admins.findById(Long.parseLong(authentication.getName()));
        if (admin == null) {
            throw new ResponseStatusException(UNAUTHORIZED, "Unknown staff");
        }
        return admin;
    }

    private static Models.Staff staff(AdminEntity admin) {
        return new Models.Staff(admin.getId(), admin.getUsername(), admin.getDisplayName(), admin.getRole(), admin.getPhone());
    }

    private static String userAgent(HttpServletRequest request) {
        String value = request.getHeader("User-Agent");
        return value == null ? "Unknown" : value.substring(0, Math.min(value.length(), 255));
    }

    private static String cookie(HttpServletRequest request, String name) {
        if (request.getCookies() == null) {
            return null;
        }
        for (Cookie cookie : request.getCookies()) {
            if (name.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private ResponseCookie refreshCookie(String token, boolean secure) {
        return ResponseCookie.from("zhiyuan_refresh", token)
            .httpOnly(true)
            .secure(secure)
            .sameSite("Strict")
            .path("/api/v1/auth")
            .maxAge(java.time.Duration.ofDays(14))
            .build();
    }

    private static String refreshToken(HttpServletRequest request) {
        String token = cookie(request, "zhiyuan_refresh");
        return token == null ? request.getHeader("X-Refresh-Token") : token;
    }

    private void revokeSession(HttpServletRequest request) {
        String token = refreshToken(request);
        if (token == null) {
            return;
        }
        try {
            String sessionId = jwtService.verify(token, "refresh").getId();
            sessions.revokeByToken(sessionId, token);
        } catch (JWTVerificationException | IllegalArgumentException ignored) {
            // Logout is intentionally idempotent for expired or malformed refresh tokens.
        }
    }
}
