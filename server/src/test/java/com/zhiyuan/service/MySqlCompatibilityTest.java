package com.zhiyuan.service;

import com.zhiyuan.persistence.PlatformDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
class MySqlCompatibilityTest {
    @Container
    static final MySQLContainer MYSQL = new MySQLContainer("mysql:8.4")
        .withDatabaseName("zhiyuan")
        .withUsername("zhiyuan")
        .withPassword("zhiyuan-test");

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
        registry.add("spring.datasource.username", MYSQL::getUsername);
        registry.add("spring.datasource.password", MYSQL::getPassword);
    }

    @Autowired
    PlatformStore store;

    @Autowired
    PlatformDatabase database;

    @Autowired
    PlatformTransactionManager transactionManager;

    @Test
    void generatedKeysFlywayAndTransactionalOrderWritesWorkOnMySql() {
        var user = store.addUser("MySQL 验证用户", "13977778888");
        var address = store.addAddress(user.id(), user.username(), user.phone(), "南京市雨花台区", 31.99, 118.78, true);
        var order = store.createOrder(user.id(), address.id(), List.of(new PlatformStore.OrderLine(1, 1)));

        PlatformStore reloaded = new PlatformStore(database, transactionManager);
        assertThat(reloaded.order(order.id()).addressSnapshot().detail()).isEqualTo("南京市雨花台区");
        assertThat(reloaded.users("MySQL 验证用户")).singleElement().extracting(item -> item.id()).isEqualTo(user.id());
    }
}
