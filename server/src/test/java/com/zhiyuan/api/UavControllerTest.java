package com.zhiyuan.api;

import com.jayway.jsonpath.JsonPath;
import com.zhiyuan.device.DeviceRegistry;
import com.zhiyuan.device.SimulatorUavAdapter;
import com.zhiyuan.device.UavAdapter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;
import java.time.Instant;

import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Exercises the fleet endpoints against the real wiring rather than a slice.
 *
 * <p>The command path now depends on the device registry being populated, so a test that
 * mocked the adapter away would not tell us whether the gate works — which is the part most
 * worth knowing about.
 */
@SpringBootTest
@AutoConfigureMockMvc
class UavControllerTest {

    @Autowired MockMvc mvc;
    @Autowired DeviceRegistry registry;
    @Autowired UavAdapter adapter;

    /**
     * A real token rather than {@code @WithMockUser}: the JWT filter clears the security
     * context when no bearer token is present, so a mock principal never survives it.
     */
    private String bearer;

    @BeforeEach
    void signIn() throws Exception {
        String body = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        bearer = "Bearer " + JsonPath.<String>read(body, "$.data.accessToken");
    }

    @BeforeEach
    void fleetIsReporting() {
        // The simulator publishes on a timer; nudge it so the first assertion does not race
        // the first tick.
        if (adapter instanceof SimulatorUavAdapter simulator) {
            simulator.publishPresence(true);
            simulator.publishTelemetry();
        }
        await().atMost(Duration.ofSeconds(5))
            .until(() -> registry.isCommandable("UAV-01"));
    }

    @Test
    void returnsPagedUavs() throws Exception {
        // Filtered to the seeded fleet: other tests in this context add their own fixture
        // devices, and a bare count would make this assertion depend on execution order.
        mvc.perform(get("/api/v1/uavs?q=UAV-0&page=1&size=2").header("Authorization", bearer))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.items.length()").value(2))
            .andExpect(jsonPath("$.data.total").value(6));
    }

    @Test
    void acceptsCommandsForACommandableDevice() throws Exception {
        mvc.perform(post("/api/v1/uavs/1/commands").header("Authorization", bearer)
                .contentType("application/json")
                .content("{\"type\":\"TAKE_OFF\",\"source\":\"MANUAL\"}"))
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.data.commandId").isString())
            .andExpect(jsonPath("$.data.accepted").value(true))
            .andExpect(jsonPath("$.data.adapter").value("SIMULATOR"));
    }

    @Test
    void refusesCommandsForAnOfflineDeviceWithoutQueueingThem() throws Exception {
        // UAV-04 is seeded OFFLINE, so the simulator never reports it as present.
        mvc.perform(post("/api/v1/uavs/4/commands").header("Authorization", bearer)
                .contentType("application/json")
                .content("{\"type\":\"RETURN_HOME\",\"source\":\"MANUAL\"}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.message").value(
                org.hamcrest.Matchers.containsString("offline")));
    }

    @Test
    void reportsWhyADeviceCannotBeCommanded() throws Exception {
        mvc.perform(get("/api/v1/uavs/1/readiness").header("Authorization", bearer))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.commandable").value(true))
            .andExpect(jsonPath("$.data.readiness").value("COMMANDABLE"));

        mvc.perform(get("/api/v1/uavs/4/readiness").header("Authorization", bearer))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.commandable").value(false));
    }

    @Test
    void rejectsAnUnknownCommandType() throws Exception {
        mvc.perform(post("/api/v1/uavs/1/commands").header("Authorization", bearer)
                .contentType("application/json")
                .content("{\"type\":\"SELF_DESTRUCT\",\"source\":\"MANUAL\"}"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void servesTelemetryHistoryAtBothResolutions() throws Exception {
        String to = Instant.now().plusSeconds(60).toString();
        String from = Instant.now().minusSeconds(3_600).toString();

        mvc.perform(get("/api/v1/uavs/1/telemetry?from=" + from + "&to=" + to + "&resolution=raw")
                .header("Authorization", bearer))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data").isArray());

        mvc.perform(get("/api/v1/uavs/1/telemetry?from=" + from + "&to=" + to + "&resolution=1m")
                .header("Authorization", bearer))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data").isArray());
    }

    @Test
    void refusesATelemetryQueryThatIsTooWideOrBackwards() throws Exception {
        String now = Instant.now().toString();
        String weekAgo = Instant.now().minus(Duration.ofDays(6)).toString();

        mvc.perform(get("/api/v1/uavs/1/telemetry?from=" + weekAgo + "&to=" + now)
                .header("Authorization", bearer))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/v1/uavs/1/telemetry?from=" + now + "&to=" + weekAgo)
                .header("Authorization", bearer))
            .andExpect(status().isBadRequest());

        mvc.perform(get("/api/v1/uavs/1/telemetry?from=" + weekAgo + "&to=" + now
                + "&resolution=hourly").header("Authorization", bearer))
            .andExpect(status().isBadRequest());
    }
}
