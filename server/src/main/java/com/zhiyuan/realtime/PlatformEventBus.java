package com.zhiyuan.realtime;

import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Fans platform events out to every connected operator.
 *
 * <p>Replaces a design that gave each client its own scheduler thread and pushed the entire
 * fleet every five seconds. At the target of 100 operators and 500 devices that is 100
 * threads and 100 × 500 rows every tick, most of it unchanged. This bus instead:
 *
 * <ul>
 *   <li>runs <b>one</b> scheduler and one delivery pool for all subscribers;
 *   <li>numbers every event so a reconnecting client can resume with {@code Last-Event-ID}
 *       instead of refetching everything;
 *   <li>gives each subscriber a bounded queue and <b>drops the subscriber, not the
 *       publisher</b>, when it fills — one operator on hotel wifi must not stall the fleet;
 *   <li>caps concurrent subscriptions so a runaway client cannot exhaust the server.
 * </ul>
 */
@Component
public class PlatformEventBus {
    private static final Logger log = LoggerFactory.getLogger(PlatformEventBus.class);

    public record Event(long id, String name, Object payload, Instant at) {}

    private final int maxSubscribers;
    private final int queueCapacity;
    private final int replayCapacity;

    private final AtomicLong sequence = new AtomicLong();
    private final Map<String, Subscriber> subscribers = new ConcurrentHashMap<>();

    /** Recent events, newest last, for {@code Last-Event-ID} replay. */
    private final Deque<Event> replayBuffer = new ArrayDeque<>();

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(
        daemon("platform-events-scheduler"));

    /**
     * Delivery runs off the publishing thread so a blocking {@code SseEmitter.send} cannot
     * hold up ingest. Two threads is enough: each subscriber drains its own queue serially,
     * and the work is a socket write.
     */
    private final ExecutorService delivery = Executors.newFixedThreadPool(2,
        daemon("platform-events-delivery"));

    public PlatformEventBus(
        @Value("${zhiyuan.realtime.max-subscribers:200}") int maxSubscribers,
        @Value("${zhiyuan.realtime.subscriber-queue:64}") int queueCapacity,
        @Value("${zhiyuan.realtime.replay-buffer:512}") int replayCapacity) {
        this.maxSubscribers = maxSubscribers;
        this.queueCapacity = queueCapacity;
        this.replayCapacity = replayCapacity;
        scheduler.scheduleAtFixedRate(this::heartbeat, 15, 15, TimeUnit.SECONDS);
    }

    /** Raised when the subscription cap is already reached. */
    public static class SubscriptionRejectedException extends RuntimeException {
        public SubscriptionRejectedException(int cap) {
            super("Realtime subscription limit of " + cap + " reached");
        }
    }

    /**
     * Publishes one event to every subscriber.
     *
     * <p>Never blocks and never throws: a failing subscriber is removed, not propagated.
     */
    public Event publish(String name, Object payload) {
        Event event = new Event(sequence.incrementAndGet(), name, payload, Instant.now());
        remember(event);
        subscribers.values().forEach(subscriber -> subscriber.enqueue(event));
        return event;
    }

    /**
     * Attaches an emitter to the stream.
     *
     * @param lastEventId the client's {@code Last-Event-ID}, or null for a fresh connection
     * @param initial     the full-state events sent before any replay, so a new client
     *                    starts from a complete picture
     */
    public SseEmitter subscribe(String lastEventId, List<Event> initial) {
        if (subscribers.size() >= maxSubscribers) {
            throw new SubscriptionRejectedException(maxSubscribers);
        }

        SseEmitter emitter = new SseEmitter(0L);
        Subscriber subscriber = new Subscriber(emitter, queueCapacity);
        String id = subscriber.id;
        subscribers.put(id, subscriber);

        emitter.onCompletion(() -> subscribers.remove(id));
        emitter.onTimeout(() -> {
            subscribers.remove(id);
            emitter.complete();
        });
        emitter.onError(error -> subscribers.remove(id));

        List<Event> replay = replaySince(lastEventId);
        // A resuming client that we can still serve from the buffer only needs the gap.
        // Everyone else needs the full picture first.
        (replay.isEmpty() ? initial : replay).forEach(subscriber::enqueue);
        subscriber.scheduleDrain();
        return emitter;
    }

    /**
     * Events after {@code lastEventId}, or empty when the client cannot be resumed —
     * either it sent no id, or it fell so far behind that the buffer has rolled past it.
     * Returning empty is the signal to send a full snapshot instead of silently skipping.
     */
    List<Event> replaySince(String lastEventId) {
        if (lastEventId == null || lastEventId.isBlank()) return List.of();
        long since;
        try {
            since = Long.parseLong(lastEventId.trim());
        } catch (NumberFormatException malformed) {
            return List.of();
        }
        synchronized (replayBuffer) {
            if (replayBuffer.isEmpty()) return List.of();
            if (replayBuffer.peekFirst().id() > since + 1) return List.of();
            List<Event> missed = new ArrayList<>();
            for (Event event : replayBuffer) {
                if (event.id() > since) missed.add(event);
            }
            return missed;
        }
    }

    private void remember(Event event) {
        synchronized (replayBuffer) {
            replayBuffer.addLast(event);
            while (replayBuffer.size() > replayCapacity) replayBuffer.removeFirst();
        }
    }

    private void heartbeat() {
        publish("heartbeat", Map.of("at", Instant.now().toString(), "subscribers", subscribers.size()));
    }

    /** The configured cap, so health and metrics can report how close we are to it. */
    public int maxSubscribers() {
        return maxSubscribers;
    }

    public int subscriberCount() {
        return subscribers.size();
    }

    /** Diagnostics: how many subscribers have been dropped for falling behind. */
    private final AtomicLong droppedSubscribers = new AtomicLong();

    public long droppedSubscriberCount() {
        return droppedSubscribers.get();
    }

    private final class Subscriber {
        private final String id = java.util.UUID.randomUUID().toString();
        private final SseEmitter emitter;
        private final BlockingQueue<Event> queue;
        private final AtomicBoolean draining = new AtomicBoolean();

        Subscriber(SseEmitter emitter, int capacity) {
            this.emitter = emitter;
            this.queue = new ArrayBlockingQueue<>(capacity);
        }

        void enqueue(Event event) {
            if (queue.offer(event)) {
                scheduleDrain();
                return;
            }
            // Backpressure: this client cannot keep up. Disconnecting it is correct — it
            // will reconnect with Last-Event-ID and be resynchronised, whereas blocking
            // here would hold up every other operator.
            droppedSubscribers.incrementAndGet();
            log.warn("Dropping realtime subscriber {}: delivery queue full", id);
            terminate();
        }

        void scheduleDrain() {
            if (!draining.compareAndSet(false, true)) return;
            delivery.execute(this::drain);
        }

        private void drain() {
            try {
                Event event;
                while ((event = queue.poll()) != null) {
                    emitter.send(SseEmitter.event()
                        .id(String.valueOf(event.id()))
                        .name(event.name())
                        .data(event.payload()));
                }
            } catch (IOException | IllegalStateException disconnected) {
                // The client is gone, or the response is already committed. Either way this
                // subscriber is finished; the others are unaffected.
                terminate();
            } finally {
                draining.set(false);
                // A publish that raced with the loop exit would otherwise sit unsent.
                if (!queue.isEmpty()) scheduleDrain();
            }
        }

        private void terminate() {
            subscribers.remove(id);
            queue.clear();
            try {
                emitter.complete();
            } catch (RuntimeException ignored) {
                // Completing an already-dead emitter is not an error worth reporting.
            }
        }
    }

    private static java.util.concurrent.ThreadFactory daemon(String name) {
        AtomicLong counter = new AtomicLong();
        return runnable -> {
            Thread thread = new Thread(runnable, name + "-" + counter.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }

    @PreDestroy
    public void stop() {
        scheduler.shutdownNow();
        delivery.shutdownNow();
        subscribers.values().forEach(Subscriber::terminate);
    }
}
