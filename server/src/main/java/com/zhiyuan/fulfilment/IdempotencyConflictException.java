package com.zhiyuan.fulfilment;

/**
 * Raised when an {@code Idempotency-Key} is replayed with a different payload.
 *
 * <p>This is a client bug, not a race: returning the first request's result would hand
 * the caller someone else's order, and performing the new request would break the
 * promise the key makes. The only safe answer is to refuse.
 */
public class IdempotencyConflictException extends RuntimeException {
    public IdempotencyConflictException(String scope, String key) {
        super("Idempotency key '" + key + "' was already used in scope '" + scope
            + "' with a different request body");
    }
}
