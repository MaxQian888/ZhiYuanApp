package com.zhiyuan.realtime;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;

/** Makes exceptions from scheduler threads observable to health checks and test infrastructure. */
@Component
public class BackgroundFailureReporter {
    public record Failure(String component, Instant occurredAt, Throwable cause) {}

    private final ConcurrentLinkedQueue<Failure> failures = new ConcurrentLinkedQueue<>();

    public void report(String component, Throwable cause) {
        failures.add(new Failure(component, Instant.now(), cause));
    }

    /** Consumes failures so a test that deliberately triggers one can explicitly own it. */
    public List<Failure> consume() {
        List<Failure> consumed = new ArrayList<>();
        Failure failure;
        while ((failure = failures.poll()) != null) consumed.add(failure);
        return consumed;
    }
}
