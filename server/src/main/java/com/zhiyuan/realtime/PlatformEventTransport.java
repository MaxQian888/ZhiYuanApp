package com.zhiyuan.realtime;

/**
 * Carries outbox events to every instance.
 *
 * <p>Single-instance deployments use the in-process implementation, which hands the event
 * straight to the local {@link PlatformEventBus}. Multi-instance deployments publish to
 * {@code zhiyuan/v1/platform/events/{eventType}} with an ordinary (non-shared) MQTT
 * subscription, so <em>every</em> instance receives it and can fan out to its own SSE
 * clients — unlike the raw device stream, which uses a shared subscription precisely so
 * only one instance does the ingest work (ADR 0002).
 */
public interface PlatformEventTransport {

    void broadcast(String eventType, String aggregateId, String payloadJson);

    String providerName();
}
