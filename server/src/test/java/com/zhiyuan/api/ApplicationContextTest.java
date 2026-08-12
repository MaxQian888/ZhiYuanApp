package com.zhiyuan.api;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class ApplicationContextTest {
    @Autowired MockMvc mvc;

    @Test
    void flywaySeedAndAuthenticationWorkTogether() throws Exception {
        mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk())
            .andExpect(cookie().httpOnly("zhiyuan_refresh", true))
            .andExpect(jsonPath("$.data.staff.role").value("admin"))
            .andExpect(jsonPath("$.data.accessToken").isString());
    }

    @Test
    void tauriRefreshRotatesAndReturnsTheStrongholdToken() throws Exception {
        String loginBody = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\",\"client\":\"tauri\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.refreshToken").isString())
            .andReturn()
            .getResponse()
            .getContentAsString();
        String refreshToken = JsonPath.read(loginBody, "$.data.refreshToken");

        mvc.perform(post("/api/v1/auth/refresh").header("X-Refresh-Token", refreshToken))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.accessToken").isString())
            .andExpect(jsonPath("$.data.refreshToken").isString());
    }
}
