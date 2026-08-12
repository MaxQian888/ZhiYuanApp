package com.zhiyuan.api;

import com.zhiyuan.service.PlatformStore;
import com.zhiyuan.security.JwtService;
import com.zhiyuan.uav.SimulatorUavAdapter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(UavController.class)
@Import({PlatformStore.class, SimulatorUavAdapter.class, JwtService.class})
class UavControllerTest {
    @Autowired MockMvc mvc;

    @Test
    @WithMockUser(roles = "MANAGER")
    void returnsPagedUavs() throws Exception {
        mvc.perform(get("/api/v1/uavs?page=1&size=2"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.items.length()").value(2))
            .andExpect(jsonPath("$.data.total").value(6));
    }

    @Test
    @WithMockUser(username="1",roles = "MANAGER")
    void acceptsCommandsAsynchronously() throws Exception {
        mvc.perform(post("/api/v1/uavs/1/commands").contentType("application/json").content("{\"type\":\"TAKE_OFF\",\"source\":\"MANUAL\"}"))
            .andExpect(status().isAccepted())
            .andExpect(jsonPath("$.data.commandId").isString())
            .andExpect(jsonPath("$.data.adapter").value("SIMULATOR"));
    }
}
