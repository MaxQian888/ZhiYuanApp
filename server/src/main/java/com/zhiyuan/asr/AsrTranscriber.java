package com.zhiyuan.asr;

public interface AsrTranscriber {
    AsrTranscription transcribe(byte[] pcm16le);
}
