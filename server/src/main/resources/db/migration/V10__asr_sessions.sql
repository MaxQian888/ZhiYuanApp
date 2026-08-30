CREATE TABLE asr_sessions (
  session_id VARCHAR(36) PRIMARY KEY,
  token_hash CHAR(64) NOT NULL UNIQUE,
  staff_id BIGINT NOT NULL,
  expires_at TIMESTAMP(6) NOT NULL,
  consumed_at TIMESTAMP(6) NULL,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_asr_sessions_staff FOREIGN KEY (staff_id) REFERENCES admins(id),
  INDEX idx_asr_sessions_expiry (expires_at, consumed_at)
);
