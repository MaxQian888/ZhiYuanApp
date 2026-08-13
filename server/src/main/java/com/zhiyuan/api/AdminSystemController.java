package com.zhiyuan.api;

import com.zhiyuan.domain.Models;
import com.zhiyuan.persistence.AdminEntity;
import com.zhiyuan.persistence.AdminMapper;
import com.zhiyuan.persistence.RefreshSessionRepository;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class AdminSystemController {
    private final AdminMapper admins;
    private final PasswordEncoder passwordEncoder;
    private final RefreshSessionRepository sessions;
    private final String version;
    private final String updateUrl;

    public AdminSystemController(AdminMapper admins, PasswordEncoder passwordEncoder,
                                 RefreshSessionRepository sessions,
                                 @Value("${zhiyuan.version}") String version,
                                 @Value("${zhiyuan.update-url}") String updateUrl) {
        this.admins = admins;
        this.passwordEncoder = passwordEncoder;
        this.sessions = sessions;
        this.version = version;
        this.updateUrl = updateUrl;
    }

    @GetMapping("/admins")
    @PreAuthorize("hasRole('ADMIN')")
    public ApiResponse<List<Models.StaffAccount>> admins(){return ApiResponse.ok(admins.findAll().stream().map(AdminSystemController::account).toList());}

    @PostMapping("/admins")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ApiResponse<Models.StaffAccount> create(@Valid @RequestBody CreateStaffRequest body) {
        ensureUnique(body.username(), body.phone(), 0);
        AdminEntity admin = new AdminEntity();
        admin.setUsername(body.username());
        admin.setPasswordHash(passwordEncoder.encode(body.password()));
        admin.setDisplayName(body.displayName());
        admin.setRole(body.role());
        admin.setPhone(body.phone());
        admin.setEnabled(true);
        admins.insert(admin);
        return ApiResponse.ok(account(admins.findById(admin.getId())));
    }

    @PutMapping("/admins/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ApiResponse<Models.StaffAccount> update(Authentication authentication, @PathVariable long id,
                                                   @Valid @RequestBody UpdateStaffRequest body) {
        AdminEntity current = required(id);
        long operatorId = Long.parseLong(authentication.getName());
        if (operatorId == id && (!body.enabled() || !"admin".equals(body.role()))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Current administrator cannot remove their own access");
        }
        ensureUnique(body.username(), body.phone(), id);
        boolean accessChanged = !current.getRole().equals(body.role()) ||
            !Boolean.valueOf(body.enabled()).equals(current.getEnabled());
        current.setUsername(body.username());
        current.setDisplayName(body.displayName());
        current.setRole(body.role());
        current.setPhone(body.phone());
        current.setEnabled(body.enabled());
        admins.updateAccount(current);
        if (accessChanged) admins.bumpTokenVersion(id);
        if (body.password() != null) {
            admins.updatePassword(id, passwordEncoder.encode(body.password()));
        }
        if (accessChanged || body.password() != null) sessions.revokeAll(id);
        return ApiResponse.ok(account(admins.findById(id)));
    }

    @DeleteMapping("/admins/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    @Transactional
    public ApiResponse<Models.StaffAccount> disable(Authentication authentication, @PathVariable long id) {
        AdminEntity target = required(id);
        if (Long.parseLong(authentication.getName()) == id) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Current administrator cannot disable their own account");
        }
        if (!Boolean.TRUE.equals(target.getEnabled())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Staff account is already disabled");
        }
        admins.updateEnabled(id, false);
        sessions.revokeAll(id);
        return ApiResponse.ok(account(admins.findById(id)));
    }

    @GetMapping("/system/about")
    public ApiResponse<Map<String,Object>> about(){return ApiResponse.ok(Map.of("name","智鸢无人机运营平台","version",version,"uavAdapter","SIMULATOR","apiVersion","v1"));}

    @GetMapping("/system/version")
    public ApiResponse<Map<String,Object>> version(){return ApiResponse.ok(updateUrl.isBlank()?Map.of("configured",false,"currentVersion",version):Map.of("configured",true,"currentVersion",version,"manifestUrl",updateUrl));}

    private AdminEntity required(long id) {
        AdminEntity admin = admins.findById(id);
        if (admin == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Staff account not found");
        return admin;
    }

    private void ensureUnique(String username, String phone, long excludeId) {
        if (admins.countByUsernameExcept(username, excludeId) > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Username already exists");
        }
        if (admins.countByPhoneExcept(phone, excludeId) > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Phone already exists");
        }
    }

    private static Models.StaffAccount account(AdminEntity admin){return new Models.StaffAccount(admin.getId(),admin.getUsername(),admin.getDisplayName(),admin.getRole(),admin.getPhone(),Boolean.TRUE.equals(admin.getEnabled()));}

    public record CreateStaffRequest(
        @NotBlank @Size(min = 3, max = 32) @Pattern(regexp = "^[A-Za-z0-9._-]+$") String username,
        @NotBlank @Size(min = 8, max = 72) String password,
        @NotBlank @Size(max = 80) String displayName,
        @NotBlank @Pattern(regexp = "admin|manager") String role,
        @NotBlank @Pattern(regexp = "^1[3-9]\\d{9}$") String phone) {}

    public record UpdateStaffRequest(
        @NotBlank @Size(min = 3, max = 32) @Pattern(regexp = "^[A-Za-z0-9._-]+$") String username,
        @Size(min = 8, max = 72) String password,
        @NotBlank @Size(max = 80) String displayName,
        @NotBlank @Pattern(regexp = "admin|manager") String role,
        @NotBlank @Pattern(regexp = "^1[3-9]\\d{9}$") String phone,
        boolean enabled) {}
}
