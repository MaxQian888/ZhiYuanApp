package com.zhiyuan.telemetry;

import com.zhiyuan.device.DeviceMessages;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Bounded in-process archive, used by the simulator profile and by tests.
 *
 * <p>It implements the same retention semantics as the real one so a query that would be
 * refused in production is refused here too — an archive fake that answers questions
 * production would reject is worse than no fake at all.
 *
 * <p>Deliberately capped: this is a preview aid, not storage. Production requires a real
 * archive and fails startup without one (see the production configuration check).
 */
public class InMemoryTelemetryArchive implements TelemetryArchive {

    /** Per device. At 5 Hz this is about ten minutes of flight, which is enough to preview. */
    private static final int MAX_POINTS_PER_DEVICE = 3_000;

    private final Map<String, List<Point>> tracks = new ConcurrentHashMap<>();

    /** Dedup key set, mirroring the ReplacingMergeTree behaviour the real archive relies on. */
    private final Map<String, Boolean> seenEvents = new ConcurrentHashMap<>();

    private final Clock clock;

    public InMemoryTelemetryArchive() {
        this(Clock.systemUTC());
    }

    public InMemoryTelemetryArchive(Clock clock) {
        this.clock = clock;
    }

    @Override
    public String providerName() {
        return "IN_MEMORY";
    }

    @Override
    public void append(List<DeviceMessages.Telemetry> batch) {
        for (DeviceMessages.Telemetry sample : batch) {
            // Idempotent on eventId: a retried batch must not double-count.
            if (seenEvents.putIfAbsent(sample.eventId(), Boolean.TRUE) != null) continue;
            tracks.compute(sample.uavCode(), (code, existing) -> {
                List<Point> points = existing == null ? new ArrayList<>() : existing;
                points.add(new Point(code, sample.observedAt(), sample.status(), sample.battery(),
                    sample.latitude(), sample.longitude(), sample.altitude(), sample.speed()));
                while (points.size() > MAX_POINTS_PER_DEVICE) points.remove(0);
                return points;
            });
        }
    }

    @Override
    public List<Point> query(String uavCode, Instant from, Instant to, Resolution resolution) {
        TelemetryArchive.requireWithinRetention(resolution, from, clock.instant());
        List<Point> points = tracks.getOrDefault(uavCode, List.of()).stream()
            .filter(point -> !point.observedAt().isBefore(from) && !point.observedAt().isAfter(to))
            .sorted(Comparator.comparing(Point::observedAt))
            .toList();
        return resolution == Resolution.RAW ? points : downsample(points);
    }

    /** Last sample wins within each minute, matching the rollup the real archive stores. */
    private static List<Point> downsample(List<Point> points) {
        Map<Instant, Point> byMinute = new LinkedHashMap<>();
        for (Point point : points) {
            byMinute.put(point.observedAt().truncatedTo(ChronoUnit.MINUTES), point);
        }
        return byMinute.entrySet().stream()
            .map(entry -> new Point(entry.getValue().uavCode(), entry.getKey(),
                entry.getValue().status(), entry.getValue().battery(), entry.getValue().latitude(),
                entry.getValue().longitude(), entry.getValue().altitude(), entry.getValue().speed()))
            .toList();
    }

    @Override
    public boolean healthy() {
        return true;
    }

    public void clear() {
        tracks.clear();
        seenEvents.clear();
    }
}
