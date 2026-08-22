package com.zhiyuan.api;

import com.jayway.jsonpath.JsonPath;
import io.micrometer.core.instrument.MeterRegistry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** What this instance tells a load balancer, a scraper and an operator about itself. */
@SpringBootTest(properties = "management.endpoints.web.exposure.include=health,info,metrics")
@AutoConfigureMockMvc
class ObservabilityTest {

    @Autowired MockMvc mvc;
    @Autowired MeterRegistry registry;
    @Autowired com.zhiyuan.realtime.PlatformEventBus bus;

    private String bearer;

    @BeforeEach
    void signIn() throws Exception {
        String body = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        bearer = "Bearer " + JsonPath.<String>read(body, "$.data.accessToken");
    }

    @Test
    void answersTheProbesWithoutATokenBecauseAProbeDoesNotHaveOne() throws Exception {
        // A readiness check that needs credentials cannot be used by the thing deciding
        // whether to send this instance traffic.
        mvc.perform(get("/actuator/health/liveness")).andExpect(status().isOk());
        mvc.perform(get("/actuator/health/readiness")).andExpect(status().isOk());
    }

    @Test
    void tellsAProbeNothingBeyondTheStatus() throws Exception {
        // Component names and queue depths describe the inside of the platform. A load
        // balancer needs UP or DOWN and nothing else.
        mvc.perform(get("/actuator/health/readiness"))
            .andExpect(jsonPath("$.status").value("UP"))
            .andExpect(jsonPath("$.components").doesNotExist());
    }

    @Test
    void keepsTheFullHealthPictureBehindAuthentication() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isUnauthorized());
    }

    @Test
    void showsTheDetailsToAnOperator() throws Exception {
        mvc.perform(get("/actuator/health").header("Authorization", bearer))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.components.deviceLink").exists())
            .andExpect(jsonPath("$.components.telemetryArchive").exists())
            .andExpect(jsonPath("$.components.realtime").exists());
    }

    @Test
    void reportsTheDeviceLinkProviderSoNobodyHasToGuessWhereNumbersCameFrom() throws Exception {
        mvc.perform(get("/actuator/health").header("Authorization", bearer))
            .andExpect(jsonPath("$.components.deviceLink.details.provider").value("SIMULATOR"));
    }

    @Test
    void reportsTheRealtimeCapacityAlongsideItsUsage() throws Exception {
        // "47 subscribers" means nothing without the cap it is approaching.
        mvc.perform(get("/actuator/health").header("Authorization", bearer))
            .andExpect(jsonPath("$.components.realtime.details.subscribers").exists())
            .andExpect(jsonPath("$.components.realtime.details.capacity").exists());
    }

    @Test
    void readinessAsksOnlyWhetherThisProcessCanServe() throws Exception {
        // Deliberately excludes the device link: when the broker goes down every instance
        // would fail at once, taking away the console that would have explained why.
        mvc.perform(get("/actuator/health/readiness"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("UP"));
        mvc.perform(get("/actuator/health/liveness"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("UP"));
    }



    @Test
    void keepsMetricsBehindAuthentication() throws Exception {
        mvc.perform(get("/actuator/metrics")).andExpect(status().isUnauthorized());
        mvc.perform(get("/actuator/metrics").header("Authorization", bearer))
            .andExpect(status().isOk());
    }

    @Test
    void publishesThePlatformCountersItAlreadyKeeps() {
        // Gauges over the live counters, not a parallel set of numbers that can disagree.
        assertThat(registry.find("zhiyuan.telemetry.accepted").gauge()).isNotNull();
        assertThat(registry.find("zhiyuan.telemetry.archive.backlog").gauge()).isNotNull();
        assertThat(registry.find("zhiyuan.realtime.subscribers").gauge()).isNotNull();
        assertThat(registry.find("zhiyuan.commands.pending").gauge()).isNotNull();
        assertThat(registry.find("zhiyuan.devices.known").gauge()).isNotNull();
    }

    @Test
    void theGaugesAreViewsOverTheLiveCountersRatherThanCopiesOfThem() {
        // Two numbers that are supposed to mean the same thing eventually disagree, and then
        // nobody trusts either. This one reads straight from the bus.
        double before = registry.find("zhiyuan.realtime.subscribers").gauge().value();

        assertThat(before).isEqualTo(bus.subscriberCount());
    }
}
