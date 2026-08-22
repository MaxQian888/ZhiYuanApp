package com.zhiyuan.config;

import com.zhiyuan.device.CommandDispatcher;
import com.zhiyuan.device.DeviceRegistry;
import com.zhiyuan.device.MqttUavAdapter;
import com.zhiyuan.device.TelemetryIngestService;
import com.zhiyuan.device.UavAdapter;
import com.zhiyuan.realtime.PlatformEventBus;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.MeterBinder;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.boot.health.contributor.Status;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * What this instance reports about itself.
 *
 * <h2>Why nothing here reports DOWN</h2>
 *
 * <p>A DOWN indicator inside the readiness group takes the instance out of the load
 * balancer. That is the right response to "this instance cannot serve requests" and exactly
 * the wrong response to "the MQTT broker is unreachable" — because when the broker is down,
 * every instance would fail at once, the console would go with them, and the operators would
 * lose the one screen that could have told them what was happening.
 *
 * <p>So subsystem trouble is reported as {@link #DEGRADED}, which is visible in
 * {@code /actuator/health} and in metrics but is mapped to HTTP 200 and excluded from the
 * readiness group. Readiness stays what it should be: can this process answer HTTP and reach
 * its database.
 */
@Configuration
public class PlatformObservability {

    /** Serving, but with a subsystem in trouble. Mapped to HTTP 200 in application.yml. */
    public static final Status DEGRADED = new Status("DEGRADED", "A subsystem is impaired");

    /**
     * The device link.
     *
     * <p>Degraded when a real broker is configured and the client is not connected. The
     * simulator is reported as UP with its provider name visible, so nobody has to guess
     * whether the numbers on screen came from an aircraft.
     */
    @Bean
    HealthIndicator deviceLinkHealthIndicator(UavAdapter adapter, DeviceRegistry registry,
                                              TelemetryIngestService ingest,
                                              CommandDispatcher dispatcher) {
        return () -> {
            Health.Builder health = Health.up()
                .withDetail("provider", adapter.providerName())
                .withDetail("knownDevices", registry.size())
                .withDetail("commandsPending", dispatcher.pendingCount())
                .withDetail("telemetryAccepted", ingest.acceptedCount())
                .withDetail("telemetryRejected", ingest.rejectedCount());
            if (adapter instanceof MqttUavAdapter mqtt) {
                health.withDetail("connected", mqtt.connected())
                    .withDetail("invalidMessages", mqtt.invalidMessageCount());
                if (!mqtt.connected()) {
                    return health.status(DEGRADED).withDetail("reason", "Broker unreachable").build();
                }
            }
            return health.build();
        };
    }

    /**
     * Telemetry history.
     *
     * <p>Only degraded when the archive is declared required, matching ADR 0003: without an
     * archive the platform still flies aircraft, it just cannot answer questions about
     * yesterday. A configuration that never asked for one is not impaired.
     */
    @Bean
    HealthIndicator telemetryArchiveHealthIndicator(TelemetryIngestService ingest) {
        return () -> {
            Health.Builder health = Health.up()
                .withDetail("backlog", ingest.archiveBacklog())
                .withDetail("dropped", ingest.archiveDroppedCount())
                .withDetail("failures", ingest.archiveFailureCount());
            return ingest.archiveDegraded()
                ? health.status(DEGRADED).withDetail("reason", "Archive unreachable").build()
                : health.build();
        };
    }

    /**
     * The realtime fan-out.
     *
     * <p>Degraded once the subscription cap is reached, because from that point on new
     * operators are being refused — a fact that otherwise only shows up as complaints.
     */
    @Bean
    HealthIndicator realtimeHealthIndicator(PlatformEventBus bus) {
        return () -> {
            Health.Builder health = Health.up()
                .withDetail("subscribers", bus.subscriberCount())
                .withDetail("capacity", bus.maxSubscribers())
                .withDetail("droppedSubscribers", bus.droppedSubscriberCount());
            return bus.subscriberCount() >= bus.maxSubscribers()
                ? health.status(DEGRADED).withDetail("reason", "Subscription capacity reached").build()
                : health.build();
        };
    }

    /**
     * Binds the counters the platform already keeps to the metrics registry.
     *
     * <p>Gauges over the live counters rather than a parallel set of meters: two numbers that
     * are supposed to mean the same thing eventually disagree, and then nobody trusts either.
     */
    @Bean
    MeterBinder platformMetrics(TelemetryIngestService ingest, PlatformEventBus bus,
                                CommandDispatcher dispatcher, DeviceRegistry devices) {
        // A MeterBinder rather than a bean that registers in its constructor: binders run
        // after the registry's common tags have been applied, so every meter here carries
        // the application tag instead of racing the customizer for it.
        return registry -> {
            gauge(registry, "zhiyuan.telemetry.accepted", ingest, TelemetryIngestService::acceptedCount);
            gauge(registry, "zhiyuan.telemetry.rejected", ingest, TelemetryIngestService::rejectedCount);
            gauge(registry, "zhiyuan.telemetry.stale", ingest, TelemetryIngestService::staleCount);
            gauge(registry, "zhiyuan.telemetry.archive.backlog", ingest, TelemetryIngestService::archiveBacklog);
            gauge(registry, "zhiyuan.telemetry.archive.dropped", ingest, TelemetryIngestService::archiveDroppedCount);
            gauge(registry, "zhiyuan.telemetry.archive.failures", ingest, TelemetryIngestService::archiveFailureCount);
            gauge(registry, "zhiyuan.realtime.subscribers", bus, PlatformEventBus::subscriberCount);
            gauge(registry, "zhiyuan.realtime.subscribers.dropped", bus, PlatformEventBus::droppedSubscriberCount);
            gauge(registry, "zhiyuan.commands.pending", dispatcher, CommandDispatcher::pendingCount);
            gauge(registry, "zhiyuan.devices.known", devices, DeviceRegistry::size);
        };
    }

    private static <T> void gauge(MeterRegistry registry, String name, T source,
                                  java.util.function.ToDoubleFunction<T> value) {
        Gauge.builder(name, source, value).strongReference(true).register(registry);
    }
}
