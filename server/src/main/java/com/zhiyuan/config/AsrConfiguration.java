package com.zhiyuan.config;

import com.zhiyuan.asr.AsrHandshakeInterceptor;
import com.zhiyuan.asr.AsrSessionJanitor;
import com.zhiyuan.asr.AsrSessionService;
import com.zhiyuan.asr.AsrTranscriber;
import com.zhiyuan.asr.AsrWebSocketHandler;
import com.zhiyuan.asr.VolcengineAsrTranscriber;
import com.zhiyuan.asr.VolcengineCredentials;
import com.zhiyuan.realtime.BackgroundFailureReporter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

@Configuration
public class AsrConfiguration {
    @Bean
    AsrTranscriber asrTranscriber(ObjectMapper json,
                                  @Value("${zhiyuan.asr.endpoint}") String endpoint,
                                  @Value("${zhiyuan.asr.api-key:}") String apiKey,
                                  @Value("${zhiyuan.asr.app-key:}") String appKey,
                                  @Value("${zhiyuan.asr.access-key:}") String accessKey,
                                  @Value("${zhiyuan.asr.resource-id}") String resourceId,
                                  @Value("${zhiyuan.asr.timeout-seconds:20}") long timeoutSeconds,
                                  @Qualifier("asrWorker") ExecutorService asrWorker) {
        Duration timeout = Duration.ofSeconds(timeoutSeconds);
        return new VolcengineAsrTranscriber(
            HttpClient.newBuilder().connectTimeout(timeout).build(), json, URI.create(endpoint),
            new VolcengineCredentials(apiKey, appKey, accessKey), resourceId, timeout, asrWorker);
    }

    @Bean(destroyMethod = "shutdownNow")
    ExecutorService asrWorker() {
        return new ThreadPoolExecutor(2, 4, 60, TimeUnit.SECONDS, new ArrayBlockingQueue<>(32),
            runnable -> {
                Thread thread = new Thread(runnable, "asr-request-worker");
                thread.setDaemon(true);
                return thread;
            }, new ThreadPoolExecutor.AbortPolicy());
    }

    @Bean(destroyMethod = "shutdownNow")
    ScheduledExecutorService asrScheduler() {
        ScheduledThreadPoolExecutor scheduler = new ScheduledThreadPoolExecutor(1, runnable -> {
            Thread thread = new Thread(runnable, "asr-session-timeout");
            thread.setDaemon(true);
            return thread;
        });
        scheduler.setRemoveOnCancelPolicy(true);
        return scheduler;
    }

    @Bean
    AsrWebSocketHandler asrWebSocketHandler(AsrTranscriber transcriber, ObjectMapper json,
                                            ScheduledExecutorService asrScheduler,
                                            @Value("${zhiyuan.asr.max-seconds:15}") int maxSeconds) {
        return new AsrWebSocketHandler(transcriber, json, asrScheduler, maxSeconds);
    }

    @Bean
    AsrHandshakeInterceptor asrHandshakeInterceptor(AsrSessionService sessions) {
        return new AsrHandshakeInterceptor(sessions);
    }

    @Bean
    AsrSessionJanitor asrSessionJanitor(AsrSessionService sessions,
                                        ScheduledExecutorService asrScheduler,
                                        BackgroundFailureReporter failures) {
        return new AsrSessionJanitor(sessions, asrScheduler, failures);
    }
}
