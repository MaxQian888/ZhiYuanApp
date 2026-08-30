package com.zhiyuan.service;

import com.zhiyuan.device.DeviceIngestRepository;
import com.zhiyuan.persistence.PlatformDatabase;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.mysql.MySQLContainer;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

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

    @Autowired
    DeviceIngestRepository outbox;

    @Autowired
    JdbcTemplate jdbc;

    @Test
    void generatedKeysFlywayAndTransactionalOrderWritesWorkOnMySql() {
        var user = store.addUser("MySQL 验证用户", "13977778888");
        var address = store.addAddress(user.id(), user.username(), user.phone(), "南京市雨花台区", 31.99, 118.78, true);
        var order = store.createOrder(user.id(), address.id(), List.of(new PlatformStore.OrderLine(1, 1)));

        PlatformStore reloaded = new PlatformStore(database, transactionManager);
        assertThat(reloaded.order(order.id()).addressSnapshot().detail()).isEqualTo("南京市雨花台区");
        assertThat(reloaded.users("MySQL 验证用户")).singleElement().extracting(item -> item.id()).isEqualTo(user.id());
    }

    @Test
    void skipLockedLeasesOneOutboxRowToOnlyOneInstanceAndAllowsTakeover() throws Exception {
        jdbc.update("DELETE FROM outbox WHERE published_at IS NULL");
        String aggregateId = "MYSQL-LEASE-" + UUID.randomUUID();
        jdbc.update("INSERT INTO outbox (event_type, aggregate_id, payload) VALUES (?, ?, '{}')",
            "test.mysql-lease", aggregateId);

        Instant claimedAt = Instant.now().plusSeconds(1);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService workers = Executors.newFixedThreadPool(2);
        try {
            Future<List<DeviceIngestRepository.OutboxRow>> first = workers.submit(() -> {
                start.await();
                return outbox.claimOutbox("mysql-instance-one", claimedAt,
                    Duration.ofSeconds(30), 1);
            });
            Future<List<DeviceIngestRepository.OutboxRow>> second = workers.submit(() -> {
                start.await();
                return outbox.claimOutbox("mysql-instance-two", claimedAt,
                    Duration.ofSeconds(30), 1);
            });
            start.countDown();

            List<DeviceIngestRepository.OutboxRow> firstClaim = first.get();
            List<DeviceIngestRepository.OutboxRow> secondClaim = second.get();
            assertThat(firstClaim.size() + secondClaim.size()).isEqualTo(1);
            assertThat(java.util.stream.Stream.concat(firstClaim.stream(), secondClaim.stream()))
                .singleElement().extracting(DeviceIngestRepository.OutboxRow::aggregateId)
                .isEqualTo(aggregateId);
        } finally {
            workers.shutdownNow();
        }

        assertThat(outbox.claimOutbox("mysql-takeover", claimedAt.plusSeconds(31),
            Duration.ofSeconds(30), 1))
            .singleElement().extracting(DeviceIngestRepository.OutboxRow::aggregateId)
            .isEqualTo(aggregateId);
    }
}
