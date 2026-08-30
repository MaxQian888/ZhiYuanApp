package com.zhiyuan.device;

import com.zhiyuan.telemetry.TelemetryArchive;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

class TelemetryArchiveBatcherTest {

    private TelemetryArchiveBatcher batcher;

    @AfterEach
    void tearDown() {
        if (batcher != null) batcher.close();
    }

    @Test
    void flushesImmediatelyWhenTheBatchIsFull() {
        RecordingArchive archive = new RecordingArchive();
        batcher = new TelemetryArchiveBatcher(archive, 20, 3, Duration.ofSeconds(10));
        batcher.start();

        batcher.offer(sample(1));
        batcher.offer(sample(2));
        batcher.offer(sample(3));

        await().atMost(Duration.ofSeconds(1))
            .untilAsserted(() -> assertThat(archive.batches).singleElement()
                .satisfies(batch -> assertThat(batch).hasSize(3)));
    }

    @Test
    void flushesAPartialBatchWhenItsTimeWindowExpires() {
        RecordingArchive archive = new RecordingArchive();
        batcher = new TelemetryArchiveBatcher(archive, 20, 3, Duration.ofMillis(50));
        batcher.start();

        batcher.offer(sample(1));

        await().atMost(Duration.ofSeconds(1))
            .untilAsserted(() -> assertThat(archive.batches).singleElement()
                .satisfies(batch -> assertThat(batch).hasSize(1)));
    }

    @Test
    void retriesAFailedBatchWithoutLosingItsSamples() {
        RecordingArchive archive = new RecordingArchive();
        archive.failNext.set(true);
        batcher = new TelemetryArchiveBatcher(archive, 20, 2, Duration.ofMillis(20));
        batcher.start();

        batcher.offer(sample(1));
        batcher.offer(sample(2));

        await().atMost(Duration.ofSeconds(1)).untilAsserted(() -> {
            assertThat(archive.attempts).hasValue(2);
            assertThat(archive.batches).singleElement()
                .satisfies(batch -> assertThat(batch).hasSize(2));
            assertThat(batcher.failureCount()).isEqualTo(1);
        });
    }

    @Test
    void gracefulCloseFlushesEveryQueuedBatch() {
        RecordingArchive archive = new RecordingArchive();
        batcher = new TelemetryArchiveBatcher(archive, 20, 2, Duration.ofSeconds(10));
        for (int sequence = 1; sequence <= 5; sequence++) batcher.offer(sample(sequence));

        batcher.close();

        assertThat(archive.batches).flatExtracting(batch -> batch).hasSize(5);
    }

    @Test
    void closeWaitsForAnInFlightFailureAndFlushesTheRequeuedBatch() throws Exception {
        BlockingFailOnceArchive archive = new BlockingFailOnceArchive();
        batcher = new TelemetryArchiveBatcher(archive, 20, 1, Duration.ofMillis(10));
        batcher.start();
        batcher.offer(sample(1));
        assertThat(archive.started.await(1, TimeUnit.SECONDS)).isTrue();

        ExecutorService closer = Executors.newSingleThreadExecutor();
        try {
            Future<?> closed = closer.submit(batcher::close);
            Thread.sleep(100);
            assertThat(closed).isNotDone();

            archive.release.countDown();
            closed.get(2, TimeUnit.SECONDS);

            assertThat(archive.attempts).hasValue(2);
            assertThat(archive.batches).singleElement()
                .satisfies(batch -> assertThat(batch).hasSize(1));
            batcher = null;
        } finally {
            archive.release.countDown();
            closer.shutdownNow();
        }
    }

    @Test
    void closeTimesOutInsteadOfWaitingForeverForAnInFlightAppend() throws Exception {
        BlockingSuccessArchive archive = new BlockingSuccessArchive();
        batcher = new TelemetryArchiveBatcher(archive, 20, 1, Duration.ofMillis(10));
        batcher.start();
        batcher.offer(sample(1));
        assertThat(archive.started.await(1, TimeUnit.SECONDS)).isTrue();

        ExecutorService closer = Executors.newSingleThreadExecutor();
        try {
            Future<?> closed = closer.submit(batcher::close);
            closed.get(3, TimeUnit.SECONDS);
            assertThat(batcher.failureCount()).isEqualTo(1);
            assertThat(batcher.droppedCount()).isZero();
            assertThat(batcher.abandonedCount()).isEqualTo(1);
            assertThat(batcher.backlog()).isZero();

            archive.release.countDown();
            await().atMost(Duration.ofSeconds(1)).untilAsserted(() -> {
                assertThat(archive.batches).hasSize(1);
                assertThat(batcher.abandonedCount()).isZero();
                assertThat(batcher.droppedCount()).isZero();
            });
        } finally {
            archive.release.countDown();
            closer.shutdownNow();
            batcher = null;
        }
    }

    @Test
    void closeBoundsABlockedAppendWhileDrainingQueuedSamples() throws Exception {
        BlockingFailOnceArchive archive = new BlockingFailOnceArchive();
        batcher = new TelemetryArchiveBatcher(archive, 20, 1, Duration.ofMillis(10));
        batcher.offer(sample(1));

        ExecutorService closer = Executors.newSingleThreadExecutor();
        try {
            Future<?> closed = closer.submit(batcher::close);
            assertThat(archive.started.await(1, TimeUnit.SECONDS)).isTrue();
            closed.get(3, TimeUnit.SECONDS);

            assertThat(batcher.failureCount()).isEqualTo(1);
            assertThat(batcher.droppedCount()).isZero();
            assertThat(batcher.abandonedCount()).isEqualTo(1);
            assertThat(batcher.backlog()).isZero();

            archive.release.countDown();
            await().atMost(Duration.ofSeconds(1)).untilAsserted(() -> {
                assertThat(batcher.abandonedCount()).isZero();
                assertThat(batcher.droppedCount()).isEqualTo(1);
                assertThat(batcher.backlog()).isZero();
            });
        } finally {
            archive.release.countDown();
            closer.shutdownNow();
            batcher = null;
        }
    }

    @Test
    void offersRacingWithCloseAreEitherFlushedOrCountedAsDropped() throws Exception {
        RecordingArchive archive = new RecordingArchive();
        batcher = new TelemetryArchiveBatcher(archive, 2_000, 25, Duration.ofSeconds(10));
        ExecutorService producers = Executors.newFixedThreadPool(4);
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Object>> offers = IntStream.range(0, 4)
                .mapToObj(worker -> producers.submit(() -> {
                    start.await();
                    for (int index = 0; index < 250; index++) {
                        batcher.offer(sample(worker * 250L + index));
                    }
                    return null;
                }))
                .toList();
            start.countDown();
            batcher.close();
            for (Future<?> offer : offers) offer.get(1, TimeUnit.SECONDS);

            long archived = archive.batches.stream().mapToLong(List::size).sum();
            assertThat(archived + batcher.droppedCount()).isEqualTo(1_000);
            assertThat(batcher.backlog()).isZero();
            batcher = null;
        } finally {
            producers.shutdownNow();
        }
    }

    private static DeviceMessages.Telemetry sample(long sequence) {
        return new DeviceMessages.Telemetry(DeviceMessages.SCHEMA_VERSION,
            UUID.randomUUID().toString(), "UAV-01", sequence, Instant.now(), "FLYING", 80,
            32.06, 118.78, 30, 12);
    }

    private static final class RecordingArchive implements TelemetryArchive {
        private final List<List<DeviceMessages.Telemetry>> batches = new CopyOnWriteArrayList<>();
        private final AtomicInteger attempts = new AtomicInteger();
        private final AtomicBoolean failNext = new AtomicBoolean();

        @Override
        public void append(List<DeviceMessages.Telemetry> batch) {
            attempts.incrementAndGet();
            if (failNext.compareAndSet(true, false)) {
                throw new ArchiveUnavailableException("planned failure", null);
            }
            batches.add(List.copyOf(batch));
        }

        @Override
        public List<Point> query(String uavCode, Instant from, Instant to, Resolution resolution) {
            return List.of();
        }

        @Override
        public boolean healthy() {
            return true;
        }

        @Override
        public String providerName() {
            return "RECORDING";
        }
    }

    private static final class BlockingFailOnceArchive implements TelemetryArchive {
        private final List<List<DeviceMessages.Telemetry>> batches = new CopyOnWriteArrayList<>();
        private final AtomicInteger attempts = new AtomicInteger();
        private final CountDownLatch started = new CountDownLatch(1);
        private final CountDownLatch release = new CountDownLatch(1);

        @Override
        public void append(List<DeviceMessages.Telemetry> batch) {
            if (attempts.incrementAndGet() == 1) {
                started.countDown();
                boolean interrupted = false;
                while (true) {
                    try {
                        release.await();
                        break;
                    } catch (InterruptedException ignored) {
                        interrupted = true;
                    }
                }
                if (interrupted) Thread.currentThread().interrupt();
                throw new ArchiveUnavailableException("planned in-flight failure", null);
            }
            batches.add(List.copyOf(batch));
        }

        @Override
        public List<Point> query(String uavCode, Instant from, Instant to, Resolution resolution) {
            return List.of();
        }

        @Override
        public boolean healthy() {
            return true;
        }

        @Override
        public String providerName() {
            return "BLOCKING";
        }
    }

    private static final class BlockingSuccessArchive implements TelemetryArchive {
        private final List<List<DeviceMessages.Telemetry>> batches = new CopyOnWriteArrayList<>();
        private final CountDownLatch started = new CountDownLatch(1);
        private final CountDownLatch release = new CountDownLatch(1);

        @Override
        public void append(List<DeviceMessages.Telemetry> batch) {
            started.countDown();
            boolean interrupted = false;
            while (true) {
                try {
                    release.await();
                    break;
                } catch (InterruptedException ignored) {
                    interrupted = true;
                }
            }
            if (interrupted) Thread.currentThread().interrupt();
            batches.add(List.copyOf(batch));
        }

        @Override
        public List<Point> query(String uavCode, Instant from, Instant to, Resolution resolution) {
            return List.of();
        }

        @Override
        public boolean healthy() {
            return true;
        }

        @Override
        public String providerName() {
            return "BLOCKING_SUCCESS";
        }
    }
}
