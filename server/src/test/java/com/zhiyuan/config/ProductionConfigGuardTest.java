package com.zhiyuan.config;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The startup guard.
 *
 * <p>The property lookup is a function, so these tests state a configuration directly
 * instead of booting an application per case — which matters, because the interesting cases
 * are the ones where booting is exactly what must not happen.
 */
class ProductionConfigGuardTest {

    /** A configuration with nothing wrong with it. */
    private static Map<String, String> production() {
        Map<String, String> settings = new HashMap<>();
        settings.put("zhiyuan.jwt-secret", "a-real-secret-of-at-least-32-characters");
        settings.put("spring.datasource.password", "not-empty");
        settings.put("zhiyuan.cors-origins", "https://console.zhiyuan.example");
        settings.put("zhiyuan.simulator-enabled", "false");
        settings.put("zhiyuan.telemetry.archive-required", "true");
        settings.put("zhiyuan.clickhouse.url", "https://clickhouse.internal:8443");
        settings.put("zhiyuan.mqtt.url", "ssl://mqtt.internal:8883");
        return settings;
    }

    private static List<String> check(Map<String, String> settings) {
        return ProductionConfigGuard.problems(settings::get);
    }

    @Test
    void passesAConfigurationThatIsActuallyConfigured() {
        assertThat(check(production())).isEmpty();
    }

    @Test
    void treatsAnythingThatIsNotDevelopmentOrTestAsProduction() {
        // Forgetting the profile must produce a refusal, not a silent weak deployment.
        assertThat(ProductionConfigGuard.relaxed(new String[] {})).isFalse();
        assertThat(ProductionConfigGuard.relaxed(new String[] {"production"})).isFalse();
        assertThat(ProductionConfigGuard.relaxed(new String[] {"staging", "eu"})).isFalse();
        assertThat(ProductionConfigGuard.relaxed(new String[] {"development"})).isTrue();
        assertThat(ProductionConfigGuard.relaxed(new String[] {"dev"})).isTrue();
        assertThat(ProductionConfigGuard.relaxed(new String[] {"test"})).isTrue();
        assertThat(ProductionConfigGuard.relaxed(new String[] {"eu", "test"})).isTrue();
    }

    @Test
    void rejectsTheDevelopmentSigningSecret() {
        // This literal is in the repository. Anyone who can read it could mint access tokens.
        Map<String, String> settings = production();
        settings.put("zhiyuan.jwt-secret", ProductionConfigGuard.DEVELOPMENT_JWT_SECRET);

        assertThat(check(settings)).singleElement().asString().contains("JWT_SECRET");
    }

    @Test
    void rejectsAMissingSigningSecret() {
        Map<String, String> settings = production();
        settings.remove("zhiyuan.jwt-secret");

        assertThat(check(settings)).singleElement().asString().contains("JWT_SECRET");
    }

    @Test
    void rejectsASecretShorterThanTheAlgorithmItKeys() {
        Map<String, String> settings = production();
        settings.put("zhiyuan.jwt-secret", "short");

        assertThat(check(settings)).singleElement().asString()
            .contains("shorter than " + ProductionConfigGuard.MINIMUM_SECRET_LENGTH);
    }

    @Test
    void rejectsAnEmptyDatabasePassword() {
        Map<String, String> settings = production();
        settings.put("spring.datasource.password", "");

        assertThat(check(settings)).singleElement().asString().contains("DB_PASSWORD");
    }

    @Test
    void rejectsALocalhostCorsOrigin() {
        Map<String, String> settings = production();
        settings.put("zhiyuan.cors-origins", "https://console.zhiyuan.example,http://localhost:3000");

        assertThat(check(settings)).singleElement().asString().contains("CORS_ORIGINS");
    }

    @Test
    void rejectsTheDeviceSimulator() {
        // An operator cannot tell an invented drone from a real one.
        Map<String, String> settings = production();
        settings.put("zhiyuan.simulator-enabled", "true");

        assertThat(check(settings)).singleElement().asString().contains("UAV_SIMULATOR_ENABLED");
    }

    @Test
    void rejectsAMissingDeviceLink() {
        Map<String, String> settings = production();
        settings.remove("zhiyuan.mqtt.url");

        assertThat(check(settings)).singleElement().asString().contains("MQTT_URL");
    }

    @Test
    void rejectsAnArchiveThatIsRequiredButNotConfigured() {
        Map<String, String> settings = production();
        settings.remove("zhiyuan.clickhouse.url");

        assertThat(check(settings)).singleElement().asString().contains("CLICKHOUSE_URL");
    }

    @Test
    void acceptsAnAbsentArchiveWhenItWasNeverDeclaredMandatory() {
        Map<String, String> settings = production();
        settings.put("zhiyuan.telemetry.archive-required", "false");
        settings.remove("zhiyuan.clickhouse.url");

        assertThat(check(settings)).isEmpty();
    }

    /** Exactly what application.yml falls back to when nothing is set in the environment. */
    private static Map<String, String> shippedDefaults() {
        Map<String, String> settings = new HashMap<>();
        settings.put("zhiyuan.jwt-secret", ProductionConfigGuard.DEVELOPMENT_JWT_SECRET);
        settings.put("spring.datasource.password", "");
        settings.put("zhiyuan.cors-origins",
            "http://localhost:3000,tauri://localhost,http://tauri.localhost");
        settings.put("zhiyuan.simulator-enabled", "true");
        settings.put("zhiyuan.telemetry.archive-required", "false");
        settings.put("zhiyuan.clickhouse.url", "");
        settings.put("zhiyuan.mqtt.url", "");
        return settings;
    }

    @Test
    void reportsEveryProblemAtOnce() {
        // One problem per deploy cycle turns a five-minute fix into an afternoon.
        List<String> problems = check(shippedDefaults());

        assertThat(problems).hasSize(5);
    }

    @Test
    void theMessageNamesTheProblemsAndTheWayOut() {
        String message = ProductionConfigGuard.message(check(shippedDefaults()));

        assertThat(message).contains("Refusing to start");
        assertThat(message).contains("JWT_SECRET", "DB_PASSWORD", "CORS_ORIGINS",
            "UAV_SIMULATOR_ENABLED", "MQTT_URL");
        assertThat(message).contains("SPRING_PROFILES_ACTIVE=development");
    }
}
