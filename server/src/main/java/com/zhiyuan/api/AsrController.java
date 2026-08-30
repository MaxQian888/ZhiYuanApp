package com.zhiyuan.api;

import com.zhiyuan.asr.AsrSessionService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/asr")
public class AsrController {
    private final AsrSessionService sessions;
    private final boolean enabled;

    public AsrController(AsrSessionService sessions,
                         @Value("${zhiyuan.asr.enabled:false}") boolean enabled) {
        this.sessions = sessions;
        this.enabled = enabled;
    }

    @PostMapping("/sessions")
    public ApiResponse<AsrSessionService.CreatedSession> createSession(Authentication authentication) {
        if (!enabled) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
            "ASR is not configured");
        return ApiResponse.ok(sessions.create(Long.parseLong(authentication.getName())));
    }
}
