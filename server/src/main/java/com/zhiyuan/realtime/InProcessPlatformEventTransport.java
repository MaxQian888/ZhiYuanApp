package com.zhiyuan.realtime;

import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * Single-instance transport: hands the event straight to the local bus.
 *
 * <p>Correct whenever exactly one instance is running. A multi-instance deployment must
 * replace this with the MQTT transport, otherwise an operator connected to instance B never
 * sees an event that instance A ingested. The production configuration check refuses to
 * start a clustered deployment on this implementation.
 */
public class InProcessPlatformEventTransport implements PlatformEventTransport {

    private final PlatformEventBus bus;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public InProcessPlatformEventTransport(PlatformEventBus bus) {
        this.bus = bus;
    }

    @Override
    public String providerName() {
        return "IN_PROCESS";
    }

    @Override
    public void broadcast(String eventType, String aggregateId, String payloadJson) {
        try {
            // Parsed rather than forwarded as a string so SSE clients receive an object.
            bus.publish(eventType, objectMapper.readTree(payloadJson));
        } catch (com.fasterxml.jackson.core.JsonProcessingException malformed) {
            throw new IllegalArgumentException("Outbox payload is not valid JSON", malformed);
        }
    }
}
