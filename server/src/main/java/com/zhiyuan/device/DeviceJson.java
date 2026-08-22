package com.zhiyuan.device;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.DeserializationContext;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonDeserializer;
import com.fasterxml.jackson.databind.JsonSerializer;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializerProvider;
import com.fasterxml.jackson.databind.module.SimpleModule;

import java.io.IOException;
import java.time.Instant;

/**
 * The device wire format, defined here rather than inherited from whatever the application
 * happens to configure.
 *
 * <p>Device firmware is deployed on a different schedule from the platform and cannot be
 * re-released because a library upgrade changed how a timestamp is written. So the format
 * is pinned explicitly: {@link Instant} is always ISO-8601 UTC, and unknown fields are
 * ignored so a newer device can add one without breaking an older platform.
 *
 * <p>Ignoring unknown fields is forward compatibility, not laziness — the schema version in
 * every envelope is what guards against a genuinely incompatible change.
 */
public final class DeviceJson {

    private static final ObjectMapper MAPPER = new ObjectMapper()
        .registerModule(instantModule())
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

    private DeviceJson() {}

    public static String write(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException impossible) {
            throw new IllegalStateException("Device message is not serialisable", impossible);
        }
    }

    public static byte[] writeBytes(Object value) {
        try {
            return MAPPER.writeValueAsBytes(value);
        } catch (JsonProcessingException impossible) {
            throw new IllegalStateException("Device message is not serialisable", impossible);
        }
    }

    /** @throws MalformedDeviceMessageException when the payload cannot become {@code type} */
    public static <T> T read(String payload, Class<T> type) {
        try {
            T value = MAPPER.readValue(payload, type);
            if (value == null) throw new MalformedDeviceMessageException("Payload was null");
            return value;
        } catch (JsonProcessingException malformed) {
            throw new MalformedDeviceMessageException(malformed.getOriginalMessage());
        }
    }

    /** A payload that will never become valid. Acknowledged and dropped, never retried. */
    public static class MalformedDeviceMessageException extends RuntimeException {
        public MalformedDeviceMessageException(String message) {
            super(message);
        }
    }

    private static SimpleModule instantModule() {
        SimpleModule module = new SimpleModule("zhiyuan-device-instants");
        module.addSerializer(Instant.class, new JsonSerializer<>() {
            @Override
            public void serialize(Instant value, JsonGenerator generator, SerializerProvider provider)
                throws IOException {
                generator.writeString(value.toString());
            }
        });
        module.addDeserializer(Instant.class, new JsonDeserializer<>() {
            @Override
            public Instant deserialize(JsonParser parser, DeserializationContext context)
                throws IOException {
                String text = parser.getText();
                try {
                    return Instant.parse(text);
                } catch (RuntimeException malformed) {
                    throw new MalformedDeviceMessageException(
                        "'" + text + "' is not an ISO-8601 instant");
                }
            }
        });
        return module;
    }
}
