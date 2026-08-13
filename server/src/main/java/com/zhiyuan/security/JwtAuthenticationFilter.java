package com.zhiyuan.security;

import com.auth0.jwt.interfaces.DecodedJWT;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.zhiyuan.persistence.AdminEntity;
import com.zhiyuan.persistence.AdminMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    private final JwtService jwtService;
    private final ObjectProvider<AdminMapper> adminProvider;

    public JwtAuthenticationFilter(JwtService jwtService, ObjectProvider<AdminMapper> adminProvider) {
        this.jwtService = jwtService;
        this.adminProvider = adminProvider;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            DecodedJWT jwt = null;
            try {
                jwt = jwtService.verify(header.substring(7), "access");
            } catch (JWTVerificationException | IllegalArgumentException ignored) {
                SecurityContextHolder.clearContext();
            }
            if (jwt != null) {
                AdminMapper admins = adminProvider.getIfAvailable();
                String role = jwt.getClaim("role").asString();
                if (admins != null) {
                    AdminEntity admin = admins.findById(Long.parseLong(jwt.getSubject()));
                    Long tokenVersion = jwt.getClaim("tokenVersion").asLong();
                    if (admin == null || !Boolean.TRUE.equals(admin.getEnabled()) ||
                        tokenVersion == null || !tokenVersion.equals(admin.getTokenVersion())) {
                        SecurityContextHolder.clearContext();
                        chain.doFilter(request, response);
                        return;
                    }
                    role = admin.getRole();
                }
                var authority = new SimpleGrantedAuthority("ROLE_" + role.toUpperCase());
                var authentication = new UsernamePasswordAuthenticationToken(jwt.getSubject(), null, List.of(authority));
                authentication.setDetails(jwt.getId());
                SecurityContextHolder.getContext().setAuthentication(authentication);
            }
        }
        chain.doFilter(request, response);
    }
}
