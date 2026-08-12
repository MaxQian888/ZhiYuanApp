package com.zhiyuan.api;

import com.zhiyuan.domain.Models;
import com.zhiyuan.persistence.AdminEntity;
import com.zhiyuan.persistence.AdminMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class AdminSystemController {
    private final AdminMapper admins;
    private final String version;
    private final String updateUrl;

    public AdminSystemController(AdminMapper admins,@Value("${zhiyuan.version}")String version,@Value("${zhiyuan.update-url}")String updateUrl){this.admins=admins;this.version=version;this.updateUrl=updateUrl;}

    @GetMapping("/admins")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<List<Models.Staff>> admins(){return ApiResponse.ok(admins.findAll().stream().map(AdminSystemController::staff).toList());}

    @GetMapping("/system/about")
    public ApiResponse<Map<String,Object>> about(){return ApiResponse.ok(Map.of("name","智鸢无人机运营平台","version",version,"uavAdapter","SIMULATOR","apiVersion","v1"));}

    @GetMapping("/system/version")
    public ApiResponse<Map<String,Object>> version(){return ApiResponse.ok(updateUrl.isBlank()?Map.of("configured",false,"currentVersion",version):Map.of("configured",true,"currentVersion",version,"manifestUrl",updateUrl));}

    private static Models.Staff staff(AdminEntity admin){return new Models.Staff(admin.getId(),admin.getUsername(),admin.getDisplayName(),admin.getRole(),admin.getPhone());}
}
