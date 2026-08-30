package com.zhiyuan.asr;

import java.util.concurrent.CompletionStage;

public interface AsrTranscription {
    CompletionStage<String> result();
    void cancel();

    static AsrTranscription of(CompletionStage<String> result) {
        return new AsrTranscription() {
            @Override public CompletionStage<String> result() { return result; }
            @Override public void cancel() {}
        };
    }
}
