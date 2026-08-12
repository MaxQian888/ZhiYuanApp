package com.zhiyuan.uav;

import java.util.concurrent.CompletableFuture;

public interface UavAdapter {
    CompletableFuture<String> send(long uavId, String type);
    String providerName();
}
