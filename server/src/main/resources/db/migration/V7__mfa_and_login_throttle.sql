-- Slice 4 · 二次验证与登录限流
--
-- Additive, like every migration in this programme (ADR 0004).

-- TOTP enrolment.
--
-- `mfa_secret` is populated by /auth/mfa/setup and only becomes usable once
-- `mfa_enabled` is set by /auth/mfa/confirm. Keeping the two apart means an operator who
-- scans a QR code and then loses their phone before confirming is not locked out — the
-- secret is there, but it is not yet guarding anything.
ALTER TABLE admins ADD COLUMN mfa_secret VARCHAR(64) NULL;
ALTER TABLE admins ADD COLUMN mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- The last time step accepted for this account.
--
-- A one-time password that can be used twice is not one: without this, anyone who observes
-- a code — over a shoulder, in a screenshot, in a proxy log — has the full 90-second window
-- to replay it.
ALTER TABLE admins ADD COLUMN mfa_last_step BIGINT NULL;

-- Recovery codes, stored as BCrypt hashes for the same reason passwords are: this table
-- being readable must not be the same thing as the accounts being open.
--
-- Single use, and used ones are kept rather than deleted — "this code was already spent"
-- is a materially different answer from "this code never existed", and during an incident
-- the difference is what tells you whether someone else got there first.
CREATE TABLE mfa_recovery_codes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  admin_id BIGINT NOT NULL,
  code_hash VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMP NULL,
  CONSTRAINT fk_recovery_admin FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  INDEX idx_recovery_admin (admin_id, used_at)
);

-- Failed sign-in attempts.
--
-- In the database rather than in process memory because the platform runs multiple
-- instances behind a load balancer: an in-memory counter gives an attacker N times the
-- budget, where N is however many instances happen to be running, and the number changes
-- when we scale.
--
-- Only failures are recorded. Logging successful sign-ins here as well would turn a table
-- that is written to rarely into one written to on every request-bearing login, and the
-- audit log already covers who signed in and when.
CREATE TABLE login_attempts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL,
  ip_address VARCHAR(64) NOT NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_attempt_window (username, ip_address, occurred_at),
  INDEX idx_attempt_cleanup (occurred_at)
);
