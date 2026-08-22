package com.zhiyuan.api;

import com.auth0.jwt.interfaces.DecodedJWT;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.zhiyuan.domain.Models;
import com.zhiyuan.persistence.AdminEntity;
import com.zhiyuan.persistence.AdminMapper;
import com.zhiyuan.persistence.RefreshSessionRepository;
import com.zhiyuan.security.JwtService;
import com.zhiyuan.security.LoginThrottle;
import com.zhiyuan.security.MfaService;
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
    public record MfaCodeRequest(@NotBlank String code) {}
    public record MfaVerifyRequest(@NotBlank String mfaToken, @NotBlank String code, String client) {}

    /**
     * The outcome of a sign-in attempt.
     *
     * <p>Extended rather than replaced (ADR 0004): a client that predates second factors
     * reads `accessToken` and `staff` exactly as before, and never sees `mfaToken` because
     * null fields are omitted. `mfaRequired` is false in that case, which is the truth.
     */
    public record LoginResult(String accessToken, String refreshToken, Models.Staff staff,
                              boolean mfaRequired, String mfaToken) {
        static LoginResult signedIn(String access, String refresh, Models.Staff staff) {
            return new LoginResult(access, refresh, staff, false, null);
        }

        static LoginResult secondFactorOwed(String mfaToken) {
            return new LoginResult(null, null, null, true, mfaToken);
        }
    }

    public record MfaStatus(boolean enabled, boolean pendingEnrolment, int remainingRecoveryCodes) {}
    public record MfaEnrolment(String secret, String provisioningUri) {}
    public record RecoveryCodes(List<String> recoveryCodes) {}
    private final AdminMapper admins;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final RefreshSessionRepository sessions;
    private final LoginThrottle throttle;
    private final MfaService mfa;

    public AuthController(AdminMapper admins, PasswordEncoder passwordEncoder, JwtService jwtService,
                          RefreshSessionRepository sessions, LoginThrottle throttle, MfaService mfa) {
        this.admins = admins;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.sessions = sessions;
        this.throttle = throttle;
        this.mfa = mfa;
    }

    @PostMapping("/login")
    public ApiResponse<LoginResult> login(@Valid @RequestBody LoginRequest body, HttpServletRequest request, HttpServletResponse response) {
        String ip = request.getRemoteAddr();
        throttle.requireAllowed(body.username(), ip);
        AdminEntity admin = admins.findByUsername(body.username());
        if (admin == null || !Boolean.TRUE.equals(admin.getEnabled()) || !passwordEncoder.matches(body.password(), admin.getPasswordHash())) {
            throttle.recordFailure(body.username(), ip);
            // Deliberately one message for all three cases. Distinguishing "no such account"
            // from "wrong password" turns the login form into a directory of who works here.
            throw new ResponseStatusException(UNAUTHORIZED, "Invalid username or password");
        }
        if (admin.mfaRequired()) {
            // The password budget is not cleared yet: this sign-in is not finished, and the
            // same budget goes on to cover the verification attempts.
            return ApiResponse.ok(LoginResult.secondFactorOwed(jwtService.mfaChallengeToken(admin)));
        }
        throttle.clear(body.username(), ip);
        return ApiResponse.ok(issueSession(admin, body.client(), request, response));
    }

    /**
     * Completes a sign-in that was halted for a second factor.
     *
     * <p>Public, like /login, because the caller is by definition not authenticated yet —
     * the challenge token is what stands in for authentication, and it is good for one
     * purpose and five minutes.
     */
    @PostMapping("/mfa/verify")
    public ApiResponse<LoginResult> verifyMfa(@Valid @RequestBody MfaVerifyRequest body,
                                              HttpServletRequest request, HttpServletResponse response) {
        String ip = request.getRemoteAddr();
        DecodedJWT challenge;
        try {
            challenge = jwtService.verify(body.mfaToken(), JwtService.MFA_CHALLENGE);
        } catch (JWTVerificationException | IllegalArgumentException exception) {
            throw new ResponseStatusException(UNAUTHORIZED, "Verification session expired");
        }
        AdminEntity admin = admins.findById(Long.parseLong(challenge.getSubject()));
        if (admin == null || !Boolean.TRUE.equals(admin.getEnabled())) {
            throw new ResponseStatusException(UNAUTHORIZED, "Verification session expired");
        }
        // Throttled on the same budget as the password. Six digits is only 10^6, and an
        // attacker who already has the password would otherwise have a free run at it.
        throttle.requireAllowed(admin.getUsername(), ip);
        try {
            mfa.verify(admin, body.code());
        } catch (MfaService.InvalidMfaCodeException failure) {
            throttle.recordFailure(admin.getUsername(), ip);
            throw new ResponseStatusException(UNAUTHORIZED, failure.getMessage());
        }
        throttle.clear(admin.getUsername(), ip);
        return ApiResponse.ok(issueSession(admin, body.client(), request, response));
    }

    @GetMapping("/mfa")
    public ApiResponse<MfaStatus> mfaStatus(Authentication authentication) {
        AdminEntity admin = current(authentication);
        return ApiResponse.ok(new MfaStatus(admin.mfaRequired(),
            !admin.mfaRequired() && admin.getMfaSecret() != null,
            admin.mfaRequired() ? mfa.remainingRecoveryCodes(admin.getId()) : 0));
    }

    /** Starts enrolment. The secret is stored but stays inert until /mfa/confirm. */
    @PostMapping("/mfa/setup")
    public ApiResponse<MfaEnrolment> setupMfa(Authentication authentication) {
        MfaService.Enrolment enrolment = mfa.beginEnrolment(current(authentication));
        return ApiResponse.ok(new MfaEnrolment(enrolment.secret(), enrolment.provisioningUri()));
    }

    /** Proves the authenticator works, switches the factor on, and issues recovery codes. */
    @PostMapping("/mfa/confirm")
    public ApiResponse<RecoveryCodes> confirmMfa(Authentication authentication,
                                                 @Valid @RequestBody MfaCodeRequest body) {
        return ApiResponse.ok(new RecoveryCodes(mfa.confirmEnrolment(current(authentication), body.code())));
    }

    /**
     * Issues a fresh set of recovery codes, invalidating the old ones.
     *
     * <p>Requires a current code: whoever asks must still hold the second factor, or this
     * would be a way to mint new credentials from a stolen session.
     */
    @PostMapping("/mfa/recovery")
    public ApiResponse<RecoveryCodes> regenerateRecovery(Authentication authentication,
                                                         @Valid @RequestBody MfaCodeRequest body) {
        AdminEntity admin = current(authentication);
        mfa.verify(admin, body.code());
        return ApiResponse.ok(new RecoveryCodes(mfa.regenerateRecoveryCodes(admin)));
    }

    /** Removes the second factor. Also requires a current code, for the same reason. */
    @DeleteMapping("/mfa")
    public ApiResponse<Void> disableMfa(Authentication authentication,
                                        @Valid @RequestBody MfaCodeRequest body) {
        AdminEntity admin = current(authentication);
        mfa.verify(admin, body.code());
        mfa.disable(admin.getId());
        return ApiResponse.ok(null);
    }

    private LoginResult issueSession(AdminEntity admin, String client,
                                     HttpServletRequest request, HttpServletResponse response) {
        String access = jwtService.accessToken(admin);
        String refresh = jwtService.refreshToken(admin);
        DecodedJWT decoded = jwtService.verify(refresh, "refresh");
        sessions.create(decoded.getId(), admin.getId(), refresh, userAgent(request), request.getRemoteAddr(), OffsetDateTime.now(ZoneOffset.UTC), decoded.getExpiresAtAsInstant().atOffset(ZoneOffset.UTC));
        boolean desktopClient = "tauri".equalsIgnoreCase(client);
        if (!desktopClient) response.addHeader(HttpHeaders.SET_COOKIE, refreshCookie(refresh, request.isSecure()).toString());
        return LoginResult.signedIn(access, desktopClient ? refresh : null, staff(admin));
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
