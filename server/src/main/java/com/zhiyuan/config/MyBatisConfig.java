package com.zhiyuan.config;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.Configuration;

@Configuration
@MapperScan("com.zhiyuan.persistence")
public class MyBatisConfig {}
