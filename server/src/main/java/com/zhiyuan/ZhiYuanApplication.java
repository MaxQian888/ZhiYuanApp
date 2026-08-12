package com.zhiyuan;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(excludeName = "org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration")
public class ZhiYuanApplication {
    public static void main(String[] args) {
        SpringApplication.run(ZhiYuanApplication.class, args);
    }
}
