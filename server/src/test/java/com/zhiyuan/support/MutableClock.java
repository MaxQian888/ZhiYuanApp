package com.zhiyuan.support;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

/**
 * A clock the test moves by hand.
 *
 * <p>Freshness windows, command deadlines and retention limits are all time-dependent, and
 * asserting them with real sleeps would make the suite both slow and flaky. Every component
 * that cares about time takes a {@link Clock} for exactly this reason.
 */
public final class MutableClock extends Clock {

    private Instant now;

    public MutableClock(Instant now) {
        this.now = now;
    }

    public void advance(Duration amount) {
        now = now.plus(amount);
    }

    public void set(Instant instant) {
        this.now = instant;
    }

    @Override
    public Instant instant() {
        return now;
    }

    @Override
    public ZoneOffset getZone() {
        return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        return this;
    }
}
