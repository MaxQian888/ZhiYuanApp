package com.zhiyuan.api;

import com.jayway.jsonpath.JsonPath;
import com.zhiyuan.asr.AsrSessionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties = {
    "zhiyuan.realtime.publisher-enabled=false",
    "zhiyuan.asr.enabled=true",
    "zhiyuan.asr.public-websocket-url=wss://api.test/api/v1/asr/ws"
})
@AutoConfigureMockMvc
class AsrControllerTest {
    @Autowired MockMvc mvc;
    @Autowired AsrSessionService sessions;

    @Test
    void requiresAnAuthenticatedStaffSession() throws Exception {
        mvc.perform(post("/api/v1/asr/sessions"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void createsAShortLivedOpaqueGatewaySessionWithoutProviderCredentials() throws Exception {
        String login = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String bearer = "Bearer " + JsonPath.<String>read(login, "$.data.accessToken");

        String body = mvc.perform(post("/api/v1/asr/sessions").header("Authorization", bearer))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.sessionId").isString())
            .andExpect(jsonPath("$.data.websocketUrl").value(org.hamcrest.Matchers.startsWith(
                "wss://api.test/api/v1/asr/ws?session=")))
            .andExpect(jsonPath("$.data.expiresAt").isString())
            .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContainIgnoringCase("accessKey", "apiKey", "appKey", "token");
    }

    @Test
    void gatewayTicketCanBeConsumedOnlyOnce() throws Exception {
        String login = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andReturn().getResponse().getContentAsString();
        String bearer = "Bearer " + JsonPath.<String>read(login, "$.data.accessToken");
        String body = mvc.perform(post("/api/v1/asr/sessions").header("Authorization", bearer))
            .andReturn().getResponse().getContentAsString();
        String url = JsonPath.read(body, "$.data.websocketUrl");
        String token = URLDecoder.decode(URI.create(url).getRawQuery().substring("session=".length()),
            StandardCharsets.UTF_8);

        assertThat(sessions.consume(token)).get()
            .extracting(AsrSessionService.ClaimedSession::staffId).isEqualTo(1L);
        assertThat(sessions.consume(token)).isEmpty();
        assertThat(sessions.purgeExpired()).isZero();
    }
}
