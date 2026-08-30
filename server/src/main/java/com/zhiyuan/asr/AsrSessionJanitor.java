package com.zhiyuan.asr;

import com.zhiyuan.realtime.BackgroundFailureReporter;

import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public final class AsrSessionJanitor implements AutoCloseable {
    private final ScheduledFuture<?> task;

    public AsrSessionJanitor(AsrSessionService sessions, ScheduledExecutorService scheduler,
                             BackgroundFailureReporter failures) {
        task = scheduler.scheduleWithFixedDelay(() -> {
            try {
                sessions.purgeExpired();
            } catch (RuntimeException failure) {
                failures.report("asr-session-cleanup", failure);
            }
        }, 1, 1, TimeUnit.HOURS);
    }

    @Override
    public void close() {
        task.cancel(false);
    }
}
