package com.zhiyuan.api;

import com.zhiyuan.device.CommandDispatcher;
import com.zhiyuan.fulfilment.FulfilmentConflictException;
import com.zhiyuan.telemetry.TelemetryArchive;
import com.zhiyuan.fulfilment.IdempotencyConflictException;
import com.zhiyuan.security.LoginThrottle;
import com.zhiyuan.security.MfaService;
import jakarta.validation.ConstraintViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.context.request.async.AsyncRequestTimeoutException;

import java.util.NoSuchElementException;

@RestControllerAdvice
public class GlobalExceptionHandler {
    private static final org.slf4j.Logger log =
        org.slf4j.LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler({AsyncRequestNotUsableException.class, AsyncRequestTimeoutException.class})
    void disconnectedStream() {
        // The SSE client has gone away; the response is already committed and cannot carry JSON.
    }

    /**
     * A locked-out sign-in.
     *
     * <p>Answered in the platform's own envelope rather than as a Problem Detail, so a
     * client parsing every other error the same way does not need a second code path. The
     * Retry-After header turns a dead end into an instruction: an operator who mistyped is
     * told when to come back instead of refreshing until it works.
     */
    @ExceptionHandler(LoginThrottle.LockedOutException.class)
    ResponseEntity<ApiResponse<Void>> lockedOut(LoginThrottle.LockedOutException exception) {
        long seconds = Math.max(1, exception.retryAfter().toSeconds());
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
            .header(org.springframework.http.HttpHeaders.RETRY_AFTER, String.valueOf(seconds))
            .body(ApiResponse.error(429, exception.getMessage()));
    }

    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<ApiResponse<Void>> status(ResponseStatusException exception) {
        int status = exception.getStatusCode().value();
        return ResponseEntity.status(status).body(ApiResponse.error(status, exception.getReason()));
    }

    /**
     * The fulfilment module reports rule violations with plain domain exceptions so it does
     * not depend on Spring Web. Mapping them to status codes is this layer's job.
     */
    @ExceptionHandler(FulfilmentConflictException.class)
    ResponseEntity<ApiResponse<Void>> fulfilmentConflict(FulfilmentConflictException exception) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ApiResponse.error(409, exception.getMessage()));
    }

    @ExceptionHandler(IdempotencyConflictException.class)
    ResponseEntity<ApiResponse<Void>> idempotencyConflict(IdempotencyConflictException exception) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ApiResponse.error(409, exception.getMessage()));
    }

    /**
     * A device that is offline or reporting stale telemetry is a conflict with the current
     * state of the world, not a malformed request — and crucially not a queued command
     * (ADR 0002). The reason is passed through verbatim so the operator learns which of the
     * two it was.
     */
    @ExceptionHandler(CommandDispatcher.DeviceNotCommandableException.class)
    ResponseEntity<ApiResponse<Void>> notCommandable(
        CommandDispatcher.DeviceNotCommandableException exception) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ApiResponse.error(409, exception.getMessage()));
    }

    /** History is degraded, not broken: 503 tells the client to retry rather than give up. */
    @ExceptionHandler(TelemetryArchive.ArchiveUnavailableException.class)
    ResponseEntity<ApiResponse<Void>> archiveUnavailable(
        TelemetryArchive.ArchiveUnavailableException exception) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
            .body(ApiResponse.error(503, "Telemetry history is temporarily unavailable"));
    }

    @ExceptionHandler(TelemetryArchive.RetentionExceededException.class)
    ResponseEntity<ApiResponse<Void>> retentionExceeded(
        TelemetryArchive.RetentionExceededException exception) {
        return ResponseEntity.badRequest()
            .body(ApiResponse.error(400, exception.getMessage()));
    }

    /**
     * A wrong, expired or already-spent second factor.
     *
     * <p>401 rather than 400: the request was well-formed, the credential was not accepted.
     * The message distinguishes "invalid" from "already used", because the second one tells
     * an operator something actionable — someone else may have used that code.
     */
    @ExceptionHandler(MfaService.InvalidMfaCodeException.class)
    ResponseEntity<ApiResponse<Void>> invalidMfaCode(MfaService.InvalidMfaCodeException exception) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
            .body(ApiResponse.error(401, exception.getMessage()));
    }

    /**
     * Enrolling a factor that is already on, or confirming one that was never started.
     *
     * <p>A conflict with current state, not bad input — the same request would have been
     * correct a moment earlier.
     */
    @ExceptionHandler(IllegalStateException.class)
    ResponseEntity<ApiResponse<Void>> illegalState(IllegalStateException exception) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ApiResponse.error(409, exception.getMessage()));
    }

    @ExceptionHandler(NoSuchElementException.class)
    ResponseEntity<ApiResponse<Void>> missing(NoSuchElementException exception) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(ApiResponse.error(404, exception.getMessage()));
    }

    @ExceptionHandler({MethodArgumentNotValidException.class, ConstraintViolationException.class, IllegalArgumentException.class})
    ResponseEntity<ApiResponse<Void>> validation(Exception exception) {
        return ResponseEntity.badRequest().body(ApiResponse.error(400, exception.getMessage()));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<ApiResponse<Void>> conflict(DataIntegrityViolationException exception) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
            .body(ApiResponse.error(409, "Resource is referenced by existing business data"));
    }

    /**
     * Anything unanticipated.
     *
     * <p>The client is deliberately told nothing but the trace id — stack traces in a
     * response body are a gift to whoever is probing. That makes logging here mandatory
     * rather than optional: the trace id has to lead somewhere, or we have built a support
     * process that ends in a shrug.
     */
    @ExceptionHandler(Exception.class)
    ResponseEntity<ApiResponse<Void>> unexpected(Exception exception) {
        log.error("Unhandled exception", exception);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(ApiResponse.error(500, "Internal server error"));
    }
}
