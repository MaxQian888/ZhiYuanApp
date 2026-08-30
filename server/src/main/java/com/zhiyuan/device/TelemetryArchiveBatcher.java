package com.zhiyuan.device;

import com.zhiyuan.telemetry.TelemetryArchive;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;

/** Bounded, asynchronous archive writer that flushes on batch size or elapsed time. */
final class TelemetryArchiveBatcher implements AutoCloseable {
    private static final Logger log = LoggerFactory.getLogger(TelemetryArchiveBatcher.class);
    private static final Duration CLOSE_DRAIN_TIMEOUT = Duration.ofSeconds(2);

    private final TelemetryArchive archive;
    private final BlockingQueue<DeviceMessages.Telemetry> queue;
    private final int batchSize;
    private final Duration flushWindow;
    private final AtomicBoolean accepting = new AtomicBoolean(true);
    private final AtomicBoolean running = new AtomicBoolean();
    private final AtomicBoolean closed = new AtomicBoolean();
    private final AtomicBoolean abandonInFlight = new AtomicBoolean();
    private final AtomicLong dropped = new AtomicLong();
    private final AtomicLong abandoned = new AtomicLong();
    private final AtomicLong failures = new AtomicLong();
    private final AtomicLong inFlightSamples = new AtomicLong();
    private final AtomicLong pending = new AtomicLong();
    private final ReentrantLock accountingLock = new ReentrantLock(true);
    private final ReentrantLock lifecycleLock = new ReentrantLock(true);
    private final ReentrantLock flushLock = new ReentrantLock(true);
    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "telemetry-archive-flush");
        thread.setDaemon(true);
        return thread;
    });

    TelemetryArchiveBatcher(TelemetryArchive archive, int queueCapacity, int batchSize,
                            Duration flushWindow) {
        this.archive = archive;
        this.queue = new ArrayBlockingQueue<>(queueCapacity);
        this.batchSize = batchSize;
        this.flushWindow = flushWindow;
    }

    void start() {
        lifecycleLock.lock();
        try {
            if (!closed.get() && running.compareAndSet(false, true)) worker.submit(this::run);
        } finally {
            lifecycleLock.unlock();
        }
    }

    void offer(DeviceMessages.Telemetry sample) {
        lifecycleLock.lock();
        try {
            if (!accepting.get()) {
                dropped.incrementAndGet();
                return;
            }
            enqueueNew(sample);
        } finally {
            lifecycleLock.unlock();
        }
    }

    private void enqueueNew(DeviceMessages.Telemetry sample) {
        if (queue.offer(sample)) {
            pending.incrementAndGet();
            return;
        }
        // Keep the newest history when the bounded queue is exhausted.
        if (queue.poll() != null) {
            dropped.incrementAndGet();
            pending.decrementAndGet();
        }
        if (queue.offer(sample)) {
            pending.incrementAndGet();
        } else {
            dropped.incrementAndGet();
        }
    }

    /** Requeue keeps the batch pending; only displaced or rejected samples change accounting. */
    private void enqueueRetry(DeviceMessages.Telemetry sample) {
        if (queue.offer(sample)) return;
        if (queue.poll() != null) {
            dropped.incrementAndGet();
            pending.decrementAndGet();
        }
        if (!queue.offer(sample)) {
            dropped.incrementAndGet();
            pending.decrementAndGet();
        }
    }

    private void run() {
        while (running.get()) {
            flushNextBatch();
        }
    }

    private void flushNextBatch() {
        flushLock.lock();
        try {
            List<DeviceMessages.Telemetry> batch = nextBatch();
            if (!batch.isEmpty()) write(batch);
        } finally {
            flushLock.unlock();
        }
    }

    private List<DeviceMessages.Telemetry> nextBatch() {
        List<DeviceMessages.Telemetry> batch = new ArrayList<>(batchSize);
        accountingLock.lock();
        try {
            DeviceMessages.Telemetry first = queue.poll(flushWindow.toNanos(),
                TimeUnit.NANOSECONDS);
            if (first == null) return batch;
            batch.add(first);

            long deadline = System.nanoTime() + flushWindow.toNanos();
            while (batch.size() < batchSize) {
                queue.drainTo(batch, batchSize - batch.size());
                if (batch.size() == batchSize) break;
                long remaining = deadline - System.nanoTime();
                if (remaining <= 0) break;
                DeviceMessages.Telemetry next = queue.poll(remaining, TimeUnit.NANOSECONDS);
                if (next == null) break;
                batch.add(next);
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } finally {
            accountingLock.unlock();
        }
        return batch;
    }

    private boolean write(List<DeviceMessages.Telemetry> batch) {
        accountingLock.lock();
        try {
            if (abandonInFlight.get()) {
                abandoned.addAndGet(-batch.size());
                dropped.addAndGet(batch.size());
                return false;
            }
            inFlightSamples.set(batch.size());
        } finally {
            accountingLock.unlock();
        }

        boolean success = false;
        try {
            archive.append(batch);
            success = true;
        } catch (RuntimeException failure) {
            failures.incrementAndGet();
            log.warn("Telemetry archive write failed for {} samples; will retry", batch.size(),
                failure);
        } finally {
            accountingLock.lock();
            try {
                inFlightSamples.set(0);
                if (abandonInFlight.get()) {
                    abandoned.addAndGet(-batch.size());
                    if (!success) dropped.addAndGet(batch.size());
                } else if (success) {
                    pending.addAndGet(-batch.size());
                } else {
                    batch.forEach(this::enqueueRetry);
                }
            } finally {
                accountingLock.unlock();
            }
        }
        if (!success && running.get()) pauseBeforeRetry();
        return success;
    }

    private void pauseBeforeRetry() {
        try {
            TimeUnit.NANOSECONDS.sleep(flushWindow.toNanos());
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    void flushNow() {
        flushLock.lock();
        try {
            List<DeviceMessages.Telemetry> batch = new ArrayList<>(batchSize);
            accountingLock.lock();
            try {
                queue.drainTo(batch, batchSize);
            } finally {
                accountingLock.unlock();
            }
            if (!batch.isEmpty()) write(batch);
        } finally {
            flushLock.unlock();
        }
    }

    int backlog() {
        return queue.size();
    }

    long droppedCount() {
        return dropped.get();
    }

    long failureCount() {
        return failures.get();
    }

    long abandonedCount() {
        return abandoned.get();
    }

    @Override
    public void close() {
        lifecycleLock.lock();
        try {
            if (!closed.compareAndSet(false, true)) return;
            accepting.set(false);
            running.set(false);
            worker.shutdownNow();
        } finally {
            lifecycleLock.unlock();
        }

        ExecutorService shutdownDrain = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "telemetry-archive-shutdown");
            thread.setDaemon(true);
            return thread;
        });
        Future<?> drain = shutdownDrain.submit(this::drainOnClose);
        try {
            drain.get(CLOSE_DRAIN_TIMEOUT.toNanos(), TimeUnit.NANOSECONDS);
        } catch (TimeoutException timeout) {
            abandonPending("timed out");
            drain.cancel(true);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            abandonPending("was interrupted");
            drain.cancel(true);
        } catch (ExecutionException failure) {
            abandonPending("failed: " + failure.getCause().getClass().getSimpleName());
        } finally {
            shutdownDrain.shutdownNow();
        }
    }

    private void drainOnClose() {
        flushLock.lock();
        try {
            while (!queue.isEmpty() && !abandonInFlight.get()) {
                List<DeviceMessages.Telemetry> batch = new ArrayList<>(batchSize);
                accountingLock.lock();
                try {
                    if (!abandonInFlight.get()) queue.drainTo(batch, batchSize);
                } finally {
                    accountingLock.unlock();
                }
                if (!batch.isEmpty() && !write(batch)) pauseBeforeRetry();
            }
        } finally {
            flushLock.unlock();
        }
    }

    private void abandonPending(String reason) {
        accountingLock.lock();
        try {
            abandonInFlight.set(true);
            failures.incrementAndGet();
            long unresolved = pending.getAndSet(0);
            long queued = queue.size();
            queue.clear();
            long unknown = Math.max(0, unresolved - queued);
            dropped.addAndGet(queued);
            abandoned.addAndGet(unknown);
            log.error("Telemetry archive shutdown {}: {} queued samples dropped, {} in-flight "
                    + "samples have an unknown outcome", reason, queued, unknown);
        } finally {
            accountingLock.unlock();
        }
    }
}
