package com.zhiyuan.api;

import com.jayway.jsonpath.JsonPath;
import com.zhiyuan.persistence.AdminEntity;
import com.zhiyuan.persistence.AdminMapper;
import com.zhiyuan.security.LoginThrottle;
import com.zhiyuan.security.MfaService;
import com.zhiyuan.security.Totp;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Sign-in, rate limiting and the second factor, over HTTP against the real wiring. */
@SpringBootTest
@AutoConfigureMockMvc
class AuthControllerTest {

    @Autowired MockMvc mvc;
    @Autowired AdminMapper admins;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired MfaService mfa;

    private static final AtomicInteger SEQUENCE = new AtomicInteger();
    private static final String PASSWORD = "correct-horse-battery";

    private AdminEntity account;

    @BeforeEach
    void setUp() {
        jdbc.update("DELETE FROM login_attempts");
        int index = SEQUENCE.incrementAndGet();
        AdminEntity admin = new AdminEntity();
        admin.setUsername("auth-user-" + index);
        admin.setPasswordHash(passwordEncoder.encode(PASSWORD));
        admin.setDisplayName("Auth Tester " + index);
        admin.setRole("manager");
        admin.setPhone("139" + String.format("%08d", 60_000_000 + index));
        admin.setEnabled(true);
        admins.insert(admin);
        account = admins.findById(admin.getId());
    }

    private String login(String password) throws Exception {
        return mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(json(account.getUsername(), password)))
            .andReturn().getResponse().getContentAsString();
    }

    private static String json(String username, String password) {
        return "{\"username\":\"" + username + "\",\"password\":\"" + password + "\"}";
    }

    private String signIn() throws Exception {
        return "Bearer " + JsonPath.<String>read(login(PASSWORD), "$.data.accessToken");
    }

    // --- password sign-in ---------------------------------------------------------------

    @Test
    void signsInWithTheRightPasswordAndSaysNoSecondFactorIsOwed() throws Exception {
        mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(json(account.getUsername(), PASSWORD)))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.accessToken").isNotEmpty())
            .andExpect(jsonPath("$.data.mfaRequired").value(false));
    }

    @Test
    void answersTheSameWayForAWrongPasswordAndAnUnknownAccount() throws Exception {
        // Distinguishing the two turns the login form into a directory of who works here.
        String wrongPassword = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(json(account.getUsername(), "not-the-password")))
            .andExpect(status().isUnauthorized()).andReturn().getResponse().getContentAsString();
        String unknownAccount = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(json("nobody-here-" + SEQUENCE.get(), "not-the-password")))
            .andExpect(status().isUnauthorized()).andReturn().getResponse().getContentAsString();

        assertThat(JsonPath.<String>read(wrongPassword, "$.message"))
            .isEqualTo(JsonPath.read(unknownAccount, "$.message"));
    }

    @Test
    void everyResponseCarriesTheTraceIdItWasHandledUnder() throws Exception {
        // The id an operator reads off an error has to be the one in the logs, or asking
        // them for it is theatre.
        var result = mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(json(account.getUsername(), PASSWORD)))
            .andExpect(header().exists("X-Trace-Id")).andReturn();

        assertThat(JsonPath.<String>read(result.getResponse().getContentAsString(), "$.traceId"))
            .isEqualTo(result.getResponse().getHeader("X-Trace-Id"));
    }

    @Test
    void keepsAnInboundTraceIdSoOneRequestHasOneIdEndToEnd() throws Exception {
        mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .header("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
                .content(json(account.getUsername(), PASSWORD)))
            .andExpect(header().string("X-Trace-Id", "4bf92f3577b34da6a3ce929d0e0e4736"));
    }

    // --- rate limiting -------------------------------------------------------------------

    @Test
    void locksOutAfterFiveFailuresAndSaysWhenToComeBack() throws Exception {
        for (int attempt = 0; attempt < LoginThrottle.MAX_FAILURES; attempt++) {
            mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(json(account.getUsername(), "wrong"))).andExpect(status().isUnauthorized());
        }

        mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(json(account.getUsername(), "wrong")))
            .andExpect(status().isTooManyRequests())
            .andExpect(header().exists("Retry-After"))
            .andExpect(jsonPath("$.code").value(429));
    }

    @Test
    void refusesTheCorrectPasswordWhileLockedOut() throws Exception {
        // Otherwise the limit is decorative: an attacker's correct guess still lets them in.
        for (int attempt = 0; attempt < LoginThrottle.MAX_FAILURES; attempt++) {
            mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(json(account.getUsername(), "wrong")));
        }

        mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(json(account.getUsername(), PASSWORD)))
            .andExpect(status().isTooManyRequests());
    }

    @Test
    void aSuccessfulSignInForgetsTheEarlierMistakes() throws Exception {
        for (int attempt = 0; attempt < LoginThrottle.MAX_FAILURES - 1; attempt++) {
            mvc.perform(post("/api/v1/auth/login").contentType("application/json")
                .content(json(account.getUsername(), "wrong")));
        }

        mvc.perform(post("/api/v1/auth/login").contentType("application/json")
            .content(json(account.getUsername(), PASSWORD))).andExpect(status().isOk());

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM login_attempts WHERE username = ?",
            Integer.class, account.getUsername().toLowerCase())).isZero();
    }

    // --- second factor -------------------------------------------------------------------

    @Test
    void reportsThatNoSecondFactorIsEnrolled() throws Exception {
        mvc.perform(get("/api/v1/auth/mfa").header("Authorization", signIn()))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.enabled").value(false))
            .andExpect(jsonPath("$.data.pendingEnrolment").value(false));
    }

    @Test
    void walksAnOperatorFromEnrolmentThroughAGuardedSignIn() throws Exception {
        String bearer = signIn();

        String setup = mvc.perform(post("/api/v1/auth/mfa/setup").header("Authorization", bearer))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.provisioningUri").value(org.hamcrest.Matchers
                .startsWith("otpauth://totp/")))
            .andReturn().getResponse().getContentAsString();
        String secret = JsonPath.read(setup, "$.data.secret");

        // Staged but not yet guarding anything: a lost phone here is not a lockout.
        mvc.perform(get("/api/v1/auth/mfa").header("Authorization", bearer))
            .andExpect(jsonPath("$.data.enabled").value(false))
            .andExpect(jsonPath("$.data.pendingEnrolment").value(true));

        String confirmed = mvc.perform(post("/api/v1/auth/mfa/confirm")
                .header("Authorization", bearer).contentType("application/json")
                .content("{\"code\":\"" + code(secret) + "\"}"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        List<String> recovery = JsonPath.read(confirmed, "$.data.recoveryCodes");
        assertThat(recovery).hasSize(MfaService.RECOVERY_CODE_COUNT);

        // From here the password alone is no longer a sign-in.
        String challenge = login(PASSWORD);
        assertThat(JsonPath.<Boolean>read(challenge, "$.data.mfaRequired")).isTrue();
        // Not merely null — absent. A half-completed sign-in must not hand out anything a
        // client could mistake for a session.
        assertThat(challenge).doesNotContain("accessToken").doesNotContain("refreshToken");
        String mfaToken = JsonPath.read(challenge, "$.data.mfaToken");

        mvc.perform(post("/api/v1/auth/mfa/verify").contentType("application/json")
                .content("{\"mfaToken\":\"" + mfaToken + "\",\"code\":\"" + nextCode(secret) + "\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.accessToken").isNotEmpty())
            .andExpect(jsonPath("$.data.mfaRequired").value(false));
    }

    @Test
    void refusesACodeThatHasAlreadyBeenUsed() throws Exception {
        // The confirmation code is spent. Presenting it again — from a shoulder-surfer, a
        // screenshot, a proxy log — must not work.
        String secret = enrol();
        String mfaToken = JsonPath.read(login(PASSWORD), "$.data.mfaToken");

        mvc.perform(post("/api/v1/auth/mfa/verify").contentType("application/json")
                .content("{\"mfaToken\":\"" + mfaToken + "\",\"code\":\"" + code(secret) + "\"}"))
            .andExpect(status().isUnauthorized())
            .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers
                .containsString("already been used")));
    }

    @Test
    void refusesAWrongCodeAtTheSecondStep() throws Exception {
        String secret = enrol();
        String mfaToken = JsonPath.read(login(PASSWORD), "$.data.mfaToken");

        mvc.perform(post("/api/v1/auth/mfa/verify").contentType("application/json")
                .content("{\"mfaToken\":\"" + mfaToken + "\",\"code\":\"000000\"}"))
            .andExpect(status().isUnauthorized());
        assertThat(secret).isNotBlank();
    }

    @Test
    void refusesAChallengeTokenThatIsNotOne() throws Exception {
        // An access token must not be usable where a challenge token is expected: the whole
        // point of the challenge is that its holder is not authenticated yet.
        String accessToken = JsonPath.read(login(PASSWORD), "$.data.accessToken");

        mvc.perform(post("/api/v1/auth/mfa/verify").contentType("application/json")
                .content("{\"mfaToken\":\"" + accessToken + "\",\"code\":\"000000\"}"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    void countsFailedCodesAgainstTheSameBudgetAsThePassword() throws Exception {
        // Six digits is 10^6. Someone who already has the password must not get a free run.
        enrol();
        String mfaToken = JsonPath.read(login(PASSWORD), "$.data.mfaToken");

        for (int attempt = 0; attempt < LoginThrottle.MAX_FAILURES; attempt++) {
            mvc.perform(post("/api/v1/auth/mfa/verify").contentType("application/json")
                .content("{\"mfaToken\":\"" + mfaToken + "\",\"code\":\"000000\"}"))
                .andExpect(status().isUnauthorized());
        }

        mvc.perform(post("/api/v1/auth/mfa/verify").contentType("application/json")
                .content("{\"mfaToken\":\"" + mfaToken + "\",\"code\":\"000000\"}"))
            .andExpect(status().isTooManyRequests());
    }

    @Test
    void acceptsARecoveryCodeInPlaceOfTheAuthenticator() throws Exception {
        String bearer = signIn();
        String setup = mvc.perform(post("/api/v1/auth/mfa/setup").header("Authorization", bearer))
            .andReturn().getResponse().getContentAsString();
        String secret = JsonPath.read(setup, "$.data.secret");
        String confirmed = mvc.perform(post("/api/v1/auth/mfa/confirm")
                .header("Authorization", bearer).contentType("application/json")
                .content("{\"code\":\"" + code(secret) + "\"}"))
            .andReturn().getResponse().getContentAsString();
        List<String> recovery = JsonPath.read(confirmed, "$.data.recoveryCodes");
        String mfaToken = JsonPath.read(login(PASSWORD), "$.data.mfaToken");

        mvc.perform(post("/api/v1/auth/mfa/verify").contentType("application/json")
                .content("{\"mfaToken\":\"" + mfaToken + "\",\"code\":\"" + recovery.get(0) + "\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.accessToken").isNotEmpty());
    }

    @Test
    void enrollingTwiceIsAConflictRatherThanASilentReset() throws Exception {
        String bearer = signIn();
        enrol();

        mvc.perform(post("/api/v1/auth/mfa/setup").header("Authorization", bearer))
            .andExpect(status().isConflict());
    }

    @Test
    void removingTheSecondFactorRequiresACurrentCode() throws Exception {
        // The session predates enrolment, which is the realistic case: nobody signs out to
        // turn their second factor off. It also keeps this test to two codes, and only three
        // distinct steps are ever valid at once.
        String bearer = signIn();
        String secret = enrol(bearer);

        mvc.perform(delete("/api/v1/auth/mfa").header("Authorization", bearer)
                .contentType("application/json").content("{\"code\":\"000000\"}"))
            .andExpect(status().isUnauthorized());

        mvc.perform(delete("/api/v1/auth/mfa").header("Authorization", bearer)
                .contentType("application/json").content("{\"code\":\"" + nextCode(secret) + "\"}"))
            .andExpect(status().isOk());
        mvc.perform(get("/api/v1/auth/mfa").header("Authorization", bearer))
            .andExpect(jsonPath("$.data.enabled").value(false));
    }

    /** Enrols the account and returns its secret. Spends the current time step. */
    private String enrol() throws Exception {
        return enrol(signIn());
    }

    private String enrol(String bearer) throws Exception {
        String setup = mvc.perform(post("/api/v1/auth/mfa/setup").header("Authorization", bearer))
            .andReturn().getResponse().getContentAsString();
        String secret = JsonPath.read(setup, "$.data.secret");
        mvc.perform(post("/api/v1/auth/mfa/confirm").header("Authorization", bearer)
            .contentType("application/json").content("{\"code\":\"" + code(secret) + "\"}"))
            .andExpect(status().isOk());
        return secret;
    }

    private static String code(String secret) {
        return Totp.codeAt(secret, Totp.stepAt(Instant.now()));
    }

    /**
     * The code the authenticator will show next.
     *
     * <p>Needed because the replay guard refuses a step it has already accepted, so an
     * operator who confirms enrolment and then signs in inside the same thirty-second window
     * genuinely has to wait for the next code. That is correct TOTP behaviour, not a test
     * artefact — the drift window accepts step+1, which is what a person would type.
     */
    private static String nextCode(String secret) {
        return Totp.codeAt(secret, Totp.stepAt(Instant.now()) + 1);
    }
}
