package com.zhiyuan.fulfilment;

/** A business rule refused the operation: illegal transition, insufficient stock, lost race. */
public class FulfilmentConflictException extends RuntimeException {
    public FulfilmentConflictException(String message) {
        super(message);
    }
}
