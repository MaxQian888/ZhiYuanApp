package com.zhiyuan.api;

import com.jayway.jsonpath.JsonPath;
import com.zhiyuan.config.PlatformObservability;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * What an impaired subsystem does to this instance's place in the load balancer: nothing.
 *
 * <p>This is the property the whole DEGRADED status exists for, and it is one line of YAML
 * away from being wrong. If DEGRADED ever mapped to 503, an MQTT outage would take every
 * instance out of rotation simultaneously and the operators would lose the console that
 * could have told them the broker was down.
 */
@SpringBootTest(properties = "management.endpoints.web.exposure.include=health")
@AutoConfigureMockMvc
class DegradedHealthTest {

    @TestConfiguration
    static class ImpairedSubsystem {
        @Bean
        HealthIndicator alwaysDegradedHealthIndicator() {
            return () -> Health.status(PlatformObservability.DEGRADED)
                .withDetail("reason", "Pretending the broker is unreachable").build();
        }
    }

    @Autowired MockMvc mvc;

    private String bearer() throws Exception {
        String body = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return "Bearer " + JsonPath.<String>read(body, "$.data.accessToken");
    }

    @Test
    void aDegradedSubsystemStillAnswersTwoHundred() throws Exception {
        mvc.perform(get("/actuator/health").header("Authorization", bearer()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("DEGRADED"));
    }

    @Test
    void aDegradedSubsystemLeavesReadinessAlone() throws Exception {
        // Readiness is about this process, not about everything it talks to.
        mvc.perform(get("/actuator/health/readiness"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("UP"));
    }

    @Test
    void theImpairmentIsStillVisibleToAnOperator() throws Exception {
        mvc.perform(get("/actuator/health").header("Authorization", bearer()))
            .andExpect(jsonPath("$.components.alwaysDegraded.status").value("DEGRADED"))
            .andExpect(jsonPath("$.components.alwaysDegraded.details.reason").exists());
    }
}
