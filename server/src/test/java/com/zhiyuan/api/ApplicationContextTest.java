package com.zhiyuan.api;

import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import jakarta.servlet.http.Cookie;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.hamcrest.Matchers.nullValue;

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
            .andExpect(cookie().doesNotExist("zhiyuan_refresh"))
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

    @Test
    void webRefreshKeepsTheRefreshTokenHttpOnly() throws Exception {
        Cookie refreshCookie = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.refreshToken").doesNotExist())
            .andReturn()
            .getResponse()
            .getCookie("zhiyuan_refresh");

        mvc.perform(post("/api/v1/auth/refresh").cookie(refreshCookie))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.accessToken").isString())
            .andExpect(jsonPath("$.data.refreshToken").doesNotExist());
    }

    @Test
    void voidResponsesRetainTheEnvelopeDataField() throws Exception {
        var login = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andReturn().getResponse();
        Cookie refreshCookie = login.getCookie("zhiyuan_refresh");

        mvc.perform(post("/api/v1/auth/logout").cookie(refreshCookie))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data").value(nullValue()));
    }

    @Test
    void managerCannotReadOrCreateAnotherStaffMembersBindings() throws Exception {
        String managerLogin = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"manager\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String managerAccess = JsonPath.read(managerLogin, "$.data.accessToken");

        mvc.perform(get("/api/v1/device-bindings").header("Authorization", "Bearer " + managerAccess))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data").isEmpty());

        mvc.perform(post("/api/v1/device-bindings").header("Authorization", "Bearer " + managerAccess)
                .contentType("application/json")
                .content("{\"staffId\":1,\"uavId\":2}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.staffId").value(2));
    }

    @Test
    void adminsCanManageStaffAccountsAndDisabledAccountsLoseAccessImmediately() throws Exception {
        String adminLogin = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String adminAccess = JsonPath.read(adminLogin, "$.data.accessToken");

        String managerLogin = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"manager\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String managerAccess = JsonPath.read(managerLogin, "$.data.accessToken");

        mvc.perform(post("/api/v1/admins").header("Authorization", "Bearer " + managerAccess)
                .contentType("application/json")
                .content("{\"username\":\"opsqa\",\"password\":\"opsqa123\",\"displayName\":\"质量运营\",\"role\":\"manager\",\"phone\":\"13800000009\"}"))
            .andExpect(status().isForbidden());

        String createdBody = mvc.perform(post("/api/v1/admins").header("Authorization", "Bearer " + adminAccess)
                .contentType("application/json")
                .content("{\"username\":\"opsqa\",\"password\":\"opsqa123\",\"displayName\":\"质量运营\",\"role\":\"manager\",\"phone\":\"13800000009\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.username").value("opsqa"))
            .andExpect(jsonPath("$.data.enabled").value(true))
            .andReturn().getResponse().getContentAsString();
        int staffId = JsonPath.read(createdBody, "$.data.id");

        var staffLoginResponse = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"opsqa\",\"password\":\"opsqa123\"}"))
            .andExpect(status().isOk()).andReturn().getResponse();
        String staffLogin = staffLoginResponse.getContentAsString();
        String staffAccess = JsonPath.read(staffLogin, "$.data.accessToken");
        Cookie staffRefresh = staffLoginResponse.getCookie("zhiyuan_refresh");

        mvc.perform(put("/api/v1/admins/{id}", staffId).header("Authorization", "Bearer " + adminAccess)
                .contentType("application/json")
                .content("{\"username\":\"opsqa\",\"password\":\"opsqa456\",\"displayName\":\"质量运营主管\",\"role\":\"manager\",\"phone\":\"13800000009\",\"enabled\":true}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.displayName").value("质量运营主管"));

        mvc.perform(get("/api/v1/dashboard").header("Authorization", "Bearer " + staffAccess))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/refresh").cookie(staffRefresh))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"opsqa\",\"password\":\"opsqa123\"}"))
            .andExpect(status().isUnauthorized());
        String resetLogin = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"opsqa\",\"password\":\"opsqa456\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String resetAccess = JsonPath.read(resetLogin, "$.data.accessToken");

        mvc.perform(delete("/api/v1/admins/{id}", staffId).header("Authorization", "Bearer " + adminAccess))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.enabled").value(false));

        mvc.perform(get("/api/v1/dashboard").header("Authorization", "Bearer " + resetAccess))
            .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"opsqa\",\"password\":\"opsqa456\"}"))
            .andExpect(status().isUnauthorized());

        mvc.perform(delete("/api/v1/admins/1").header("Authorization", "Bearer " + adminAccess))
            .andExpect(status().isConflict());
    }

    @Test
    void authenticatedOperationsCreatePersistentOrdersAndEnforceAdminDeletes() throws Exception {
        String adminLogin = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String adminAccess = JsonPath.read(adminLogin, "$.data.accessToken");

        mvc.perform(post("/api/v1/orders").header("Authorization", "Bearer " + adminAccess)
                .contentType("application/json")
                .content("{\"userId\":1,\"addressId\":1,\"items\":[{\"goodsId\":1,\"count\":1}]}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.status").value("CREATED"))
            .andExpect(jsonPath("$.data.addressSnapshot.detail").value("南京市玄武区珠江路 1 号"))
            .andExpect(jsonPath("$.data.items[0].count").value(1));

        mvc.perform(post("/api/v1/orders").header("Authorization", "Bearer " + adminAccess)
                .contentType("application/json")
                .content("{\"userId\":1,\"addressId\":1,\"items\":null}"))
            .andExpect(status().isBadRequest());

        String managerLogin = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content("{\"username\":\"manager\",\"password\":\"admin123\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        String managerAccess = JsonPath.read(managerLogin, "$.data.accessToken");
        mvc.perform(delete("/api/v1/goods/4").header("Authorization", "Bearer " + managerAccess))
            .andExpect(status().isForbidden())
            .andExpect(jsonPath("$.message").value("Insufficient permission"));
    }
}
