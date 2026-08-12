package com.zhiyuan.uav;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

@Component
@ConditionalOnProperty(name = "zhiyuan.simulator-enabled", havingValue = "true", matchIfMissing = true)
public class SimulatorUavAdapter implements UavAdapter {
    @Override
    public CompletableFuture<String> send(long uavId, String type) {
        return CompletableFuture.supplyAsync(() -> "ACKNOWLEDGED", CompletableFuture.delayedExecutor(450, TimeUnit.MILLISECONDS));
    }

    @Override
    public String providerName() {
        return "SIMULATOR";
    }
}
