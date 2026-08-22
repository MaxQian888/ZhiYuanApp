package com.zhiyuan.config;

import com.zhiyuan.device.DeviceRoster;
import com.zhiyuan.device.MqttUavAdapter;
import com.zhiyuan.device.SimulatorUavAdapter;
import com.zhiyuan.device.UavAdapter;
import com.zhiyuan.realtime.InProcessPlatformEventTransport;
import com.zhiyuan.realtime.PlatformEventBus;
import com.zhiyuan.realtime.PlatformEventTransport;
import com.zhiyuan.telemetry.ClickHouseTelemetryArchive;
import com.zhiyuan.telemetry.InMemoryTelemetryArchive;
import com.zhiyuan.telemetry.TelemetryArchive;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Chooses one implementation per port, from configuration.
 *
 * <p>All three choices are made here rather than with {@code @ConditionalOnMissingBean} on
 * the classes themselves, because that annotation's outcome depends on component-scan
 * order — which is not something a deployment should be able to change by accident. The
 * rule is uniform and readable: <b>set the URL and you get the real thing; leave it unset
 * and you get the fake.</b>
 */
@Configuration
public class DeviceLinkConfiguration {
    private static final Logger log = LoggerFactory.getLogger(DeviceLinkConfiguration.class);

    /**
     * One clock for the whole platform, so a test can freeze time in one place rather than
     * every component reaching for {@code Instant.now()} independently.
     */
    @Bean
    public java.time.Clock platformClock() {
        return java.time.Clock.systemUTC();
    }

    @Bean
    public UavAdapter uavAdapter(DeviceRoster roster,
                                 @Value("${zhiyuan.mqtt.url:}") String mqttUrl,
                                 @Value("${zhiyuan.mqtt.client-id-prefix:zhiyuan}") String clientIdPrefix,
                                 @Value("${zhiyuan.mqtt.username:}") String username,
                                 @Value("${zhiyuan.mqtt.password:}") String password,
                                 @Value("${zhiyuan.mqtt.share-group:zhiyuan-ingest}") String shareGroup,
                                 @Value("${zhiyuan.mqtt.topic-root:zhiyuan/v1}") String topicRoot) {
        if (mqttUrl.isBlank()) {
            log.info("Device link: SIMULATOR (set zhiyuan.mqtt.url to use a real broker)");
            return new SimulatorUavAdapter(roster);
        }
        log.info("Device link: MQTT at {} (share group {})", mqttUrl, shareGroup);
        return new MqttUavAdapter(mqttUrl, clientIdPrefix, username, password, shareGroup, topicRoot);
    }

    @Bean
    public TelemetryArchive telemetryArchive(
        @Value("${zhiyuan.clickhouse.url:}") String clickHouseUrl,
        @Value("${zhiyuan.clickhouse.database:zhiyuan}") String database,
        @Value("${zhiyuan.clickhouse.username:default}") String username,
        @Value("${zhiyuan.clickhouse.password:}") String password,
        @Value("${zhiyuan.clickhouse.timeout-seconds:10}") long timeoutSeconds) {
        if (clickHouseUrl.isBlank()) {
            log.info("Telemetry archive: IN_MEMORY (set zhiyuan.clickhouse.url for history)");
            return new InMemoryTelemetryArchive();
        }
        log.info("Telemetry archive: CLICKHOUSE at {}", clickHouseUrl);
        return new ClickHouseTelemetryArchive(clickHouseUrl, database, username, password,
            timeoutSeconds);
    }

    /**
     * Platform events travel in-process unless a broker is configured.
     *
     * <p>A clustered deployment on the in-process transport would leave each instance
     * blind to the others' ingest; the production configuration check refuses that
     * combination rather than letting it ship.
     */
    @Bean
    public PlatformEventTransport platformEventTransport(PlatformEventBus bus, UavAdapter adapter) {
        if (adapter instanceof MqttUavAdapter mqtt) {
            log.info("Platform events: MQTT broadcast");
            return mqtt.platformEventTransport(bus);
        }
        log.info("Platform events: IN_PROCESS");
        return new InProcessPlatformEventTransport(bus);
    }
}
