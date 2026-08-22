package com.zhiyuan.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationPreparedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.core.env.ConfigurableEnvironment;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;

/**
 * Refuses to start a production deployment that is still wearing its development clothes.
 *
 * <p>The rule is inverted on purpose: **anything that is not explicitly a development or
 * test environment is treated as production.** Forgetting to set a profile therefore
 * produces a refusal with a list of what to fix, not a quietly insecure deployment signed
 * with a secret that is checked into the repository.
 *
 * <p>It runs as an {@link ApplicationListener} on the environment-prepared event rather than
 * as a bean, so it fires before the datasource connects, before Flyway migrates and before
 * the port is bound. A guard that only trips after the application is serving traffic has
 * already failed at its job. It is registered in {@code META-INF/spring.factories}.
 */
public class ProductionConfigGuard
    implements ApplicationListener<ApplicationPreparedEvent> {

    private static final Logger log = LoggerFactory.getLogger(ProductionConfigGuard.class);

    /** Profiles under which the development defaults are the correct answer. */
    private static final Set<String> RELAXED_PROFILES = Set.of("development", "dev", "test");

    /** The literal in application.yml. Its presence in production is the headline failure. */
    static final String DEVELOPMENT_JWT_SECRET = "development-only-change-this-secret-32-bytes";

    /** HMAC-SHA256 keys shorter than this are weaker than the algorithm they key. */
    static final int MINIMUM_SECRET_LENGTH = 32;

    @Override
    public void onApplicationEvent(ApplicationPreparedEvent event) {
        ConfigurableEnvironment environment = event.getApplicationContext().getEnvironment();
        if (relaxed(environment.getActiveProfiles())) {
            log.info("Development profile active: production configuration checks are skipped.");
            return;
        }
        List<String> problems = problems(environment::getProperty);
        if (problems.isEmpty()) return;
        throw new IllegalStateException(message(problems));
    }

    static boolean relaxed(String[] activeProfiles) {
        return Arrays.stream(activeProfiles).anyMatch(RELAXED_PROFILES::contains);
    }

    /**
     * Everything wrong with this configuration, rather than the first thing wrong with it.
     *
     * <p>Reporting one problem at a time turns a five-minute fix into five deploy cycles.
     */
    static List<String> problems(java.util.function.Function<String, String> property) {
        List<String> problems = new ArrayList<>();
        String secret = property.apply("zhiyuan.jwt-secret");
        if (secret == null || secret.isBlank() || DEVELOPMENT_JWT_SECRET.equals(secret)) {
            problems.add("JWT_SECRET is unset or still the development value. Anyone with a copy"
                + " of this repository could mint valid access tokens.");
        } else if (secret.length() < MINIMUM_SECRET_LENGTH) {
            problems.add("JWT_SECRET is shorter than " + MINIMUM_SECRET_LENGTH
                + " characters, which is weaker than the HMAC-SHA256 it keys.");
        }
        if (isBlank(property.apply("spring.datasource.password"))) {
            problems.add("DB_PASSWORD is empty.");
        }
        String origins = property.apply("zhiyuan.cors-origins");
        if (origins != null && origins.contains("localhost")) {
            problems.add("CORS_ORIGINS still allows a localhost origin (" + origins + ")."
                + " Browsers on any machine can be pointed at their own localhost.");
        }
        if (Boolean.parseBoolean(property.apply("zhiyuan.simulator-enabled"))) {
            problems.add("UAV_SIMULATOR_ENABLED is true. A production console must not invent"
                + " telemetry: an operator cannot tell a simulated drone from a real one.");
        }
        if (Boolean.parseBoolean(property.apply("zhiyuan.telemetry.archive-required"))
            && isBlank(property.apply("zhiyuan.clickhouse.url"))) {
            problems.add("TELEMETRY_ARCHIVE_REQUIRED is true but CLICKHOUSE_URL is unset, so the"
                + " archive that is declared mandatory does not exist.");
        }
        if (isBlank(property.apply("zhiyuan.mqtt.url"))) {
            problems.add("MQTT_URL is unset, so the platform would run against the built-in"
                + " device simulator instead of real aircraft.");
        }
        return problems;
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    static String message(List<String> problems) {
        StringBuilder message = new StringBuilder(
            "Refusing to start: this looks like a production deployment, but "
                + problems.size() + " setting" + (problems.size() == 1 ? " is" : "s are")
                + " still at development values.\n");
        for (String problem : problems) message.append("  · ").append(problem).append('\n');
        message.append("Set the values above, or run with SPRING_PROFILES_ACTIVE=development"
            + " if this really is a development machine.");
        return message.toString();
    }
}
