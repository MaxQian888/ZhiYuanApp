package com.zhiyuan.asr;

import java.net.http.HttpRequest;

public record VolcengineCredentials(String apiKey, String appKey, String accessKey) {
    public VolcengineCredentials {
        apiKey = apiKey == null ? "" : apiKey;
        appKey = appKey == null ? "" : appKey;
        accessKey = accessKey == null ? "" : accessKey;
    }

    public boolean configured() {
        return !apiKey.isBlank() || (!appKey.isBlank() && !accessKey.isBlank());
    }

    public void apply(HttpRequest.Builder request) {
        if (!apiKey.isBlank()) request.header("X-Api-Key", apiKey);
        else request.header("X-Api-App-Key", appKey).header("X-Api-Access-Key", accessKey);
    }
}
