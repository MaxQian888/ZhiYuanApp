package com.zhiyuan.support;

import com.zhiyuan.realtime.BackgroundFailureReporter;
import org.springframework.test.context.TestContext;
import org.springframework.test.context.support.AbstractTestExecutionListener;

/** Fails the owning Spring test when a scheduler exception would otherwise only reach a log. */
public class BackgroundFailureTestExecutionListener extends AbstractTestExecutionListener {
    @Override
    public void afterTestMethod(TestContext testContext) {
        BackgroundFailureReporter reporter;
        try {
            reporter = testContext.getApplicationContext().getBean(BackgroundFailureReporter.class);
        } catch (IllegalStateException unavailableContext) {
            return;
        }

        var failures = reporter.consume();
        if (failures.isEmpty()) return;
        AssertionError assertion = new AssertionError(
            "Unconsumed background failure(s): " + failures.stream()
                .map(failure -> failure.component() + ": " + failure.cause().getMessage())
                .toList());
        failures.forEach(failure -> assertion.addSuppressed(failure.cause()));
        throw assertion;
    }
}
