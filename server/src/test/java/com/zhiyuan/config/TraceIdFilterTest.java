package com.zhiyuan.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** How a request gets its trace id, and what a client is allowed to influence. */
class TraceIdFilterTest {

    private static final String VALID_TRACEPARENT =
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

    @Test
    void adoptsTheTraceIdFromAWellFormedTraceparent() {
        // A request arriving from a load balancer keeps the id that system knows it by,
        // otherwise the two halves of one trace can never be joined up.
        assertThat(TraceIdFilter.resolve(VALID_TRACEPARENT, null))
            .isEqualTo("4bf92f3577b34da6a3ce929d0e0e4736");
    }

    @Test
    void preferstheTraceparentOverAnExplicitHeader() {
        assertThat(TraceIdFilter.resolve(VALID_TRACEPARENT, "something-else"))
            .isEqualTo("4bf92f3577b34da6a3ce929d0e0e4736");
    }

    @Test
    void fallsBackToTheExplicitHeaderWhenThereIsNoTraceparent() {
        assertThat(TraceIdFilter.resolve(null, "run-42")).isEqualTo("run-42");
    }

    @Test
    void generatesOneWhenTheClientOffersNothing() {
        String first = TraceIdFilter.resolve(null, null);

        assertThat(first).hasSize(32).matches("[0-9a-f]+");
        assertThat(TraceIdFilter.resolve(null, null)).isNotEqualTo(first);
    }

    @Test
    void ignoresAMalformedTraceparentRatherThanTrustingIt() {
        assertThat(TraceIdFilter.resolve("garbage", null)).hasSize(32);
        assertThat(TraceIdFilter.resolve("00-tooshort-00f067aa0ba902b7-01", null)).hasSize(32);
        assertThat(TraceIdFilter.resolve("", null)).hasSize(32);
    }

    @Test
    void refusesASuppliedIdThatCouldForgeALogLine() {
        // The id is echoed into a response header and stamped on every log line the request
        // produces. A newline in it would let a client write log entries of its own.
        assertThat(TraceIdFilter.resolve(null, "abc\ndef INFO forged")).hasSize(32);
        assertThat(TraceIdFilter.resolve(null, "abc\r\ndef")).hasSize(32);
        assertThat(TraceIdFilter.resolve(null, "has space")).hasSize(32);
        assertThat(TraceIdFilter.resolve(null, "\"quoted\"")).hasSize(32);
    }

    @Test
    void refusesAnOversizedSuppliedId() {
        assertThat(TraceIdFilter.resolve(null, "x".repeat(65))).hasSize(32);
        assertThat(TraceIdFilter.resolve(null, "x".repeat(64))).hasSize(64);
    }

    @Test
    void refusesAnEmptySuppliedId() {
        assertThat(TraceIdFilter.resolve(null, "   ")).hasSize(32);
    }

    @Test
    void currentReturnsAnIdEvenOutsideARequest() {
        // Background work — the outbox publisher, the archive flusher — still logs.
        assertThat(TraceIdFilter.current()).isNotBlank();
    }
}
