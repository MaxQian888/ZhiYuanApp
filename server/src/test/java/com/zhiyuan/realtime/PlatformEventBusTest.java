package com.zhiyuan.realtime;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

/**
 * The properties that let one bus serve a hundred operators.
 *
 * <p>The old design gave every client its own thread and resent the whole fleet on a timer;
 * these tests pin the behaviours that replaced it.
 */
class PlatformEventBusTest {

    private PlatformEventBus bus;

    private PlatformEventBus bus(int maxSubscribers, int queue, int replay) {
        bus = new PlatformEventBus(maxSubscribers, queue, replay);
        return bus;
    }

    @AfterEach
    void tearDown() {
        if (bus != null) bus.stop();
    }

    private static List<PlatformEventBus.Event> snapshot() {
        return List.of(new PlatformEventBus.Event(0, "telemetry", List.of(), Instant.now()));
    }

    @Test
    void numbersEventsMonotonicallySoAClientCanResume() {
        PlatformEventBus events = bus(10, 8, 16);

        PlatformEventBus.Event first = events.publish("telemetry", Map.of("a", 1));
        PlatformEventBus.Event second = events.publish("alert", Map.of("b", 2));

        assertThat(first.id()).isEqualTo(1);
        assertThat(second.id()).isEqualTo(2);
        assertThat(second.name()).isEqualTo("alert");
    }

    @Test
    void replaysOnlyWhatAResumingClientMissed() {
        PlatformEventBus events = bus(10, 8, 16);
        events.publish("telemetry", Map.of("n", 1));
        events.publish("telemetry", Map.of("n", 2));
        events.publish("telemetry", Map.of("n", 3));

        List<PlatformEventBus.Event> missed = events.replaySince("1");

        assertThat(missed).extracting(PlatformEventBus.Event::id).containsExactly(2L, 3L);
    }

    @Test
    void aClientThatFellFurtherBehindThanTheBufferGetsAFullSnapshotInstead() {
        PlatformEventBus events = bus(10, 8, 2);
        events.publish("telemetry", Map.of("n", 1));
        events.publish("telemetry", Map.of("n", 2));
        events.publish("telemetry", Map.of("n", 3));

        // Event 1 has already rolled out of the two-slot buffer, so the gap cannot be served.
        assertThat(events.replaySince("0")).isEmpty();
    }

    @Test
    void aMissingOrMalformedLastEventIdIsTreatedAsAFreshConnection() {
        PlatformEventBus events = bus(10, 8, 16);
        events.publish("telemetry", Map.of("n", 1));

        assertThat(events.replaySince(null)).isEmpty();
        assertThat(events.replaySince("   ")).isEmpty();
        assertThat(events.replaySince("not-a-number")).isEmpty();
    }

    @Test
    void acceptsSubscribersUpToTheCapAndRefusesThereafter() {
        PlatformEventBus events = bus(2, 8, 16);

        events.subscribe(null, snapshot());
        events.subscribe(null, snapshot());

        assertThatThrownBy(() -> events.subscribe(null, snapshot()))
            .isInstanceOf(PlatformEventBus.SubscriptionRejectedException.class)
            .hasMessageContaining("limit of 2");
        assertThat(events.subscriberCount()).isEqualTo(2);
    }

    @Test
    void aNewSubscriberIsHandedTheFullSnapshot() {
        PlatformEventBus events = bus(10, 8, 16);

        SseEmitter emitter = events.subscribe(null, snapshot());

        assertThat(emitter).isNotNull();
        assertThat(events.subscriberCount()).isOne();
    }

    @Test
    void aSubscriberThatCannotKeepUpIsDroppedRatherThanStallingThePublisher() {
        // A one-slot queue and a client that never drains: the second event has nowhere to go.
        PlatformEventBus events = bus(10, 1, 64);
        events.subscribe(null, List.of());

        for (int index = 0; index < 200; index++) {
            events.publish("telemetry", Map.of("n", index));
        }

        await().atMost(Duration.ofSeconds(5))
            .until(() -> events.droppedSubscriberCount() > 0 || events.subscriberCount() == 0);
        assertThat(events.subscriberCount()).isZero();
    }

    @Test
    void publishingWithNoSubscribersIsHarmless() {
        PlatformEventBus events = bus(10, 8, 16);
        assertThat(events.publish("telemetry", Map.of()).id()).isEqualTo(1);
        assertThat(events.subscriberCount()).isZero();
    }
}
