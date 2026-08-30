package com.zhiyuan.fulfilment;

/** The first request owns this idempotency key but has not persisted its result yet. */
public class IdempotencyInProgressException extends RuntimeException {
    public IdempotencyInProgressException(String key) {
        super("Idempotency key '" + key + "' is still being processed");
    }
}
