-- Persist enough of command delivery to replay an idempotent HTTP result and recover
-- deadlines after a process restart.
ALTER TABLE control_commands ADD COLUMN expires_at TIMESTAMP NULL;
ALTER TABLE control_commands ADD COLUMN dispatch_adapter VARCHAR(64) NULL;
ALTER TABLE control_commands ADD COLUMN dispatch_accepted BOOLEAN NULL;
ALTER TABLE control_commands ADD COLUMN dispatch_reason VARCHAR(255) NULL;

CREATE INDEX idx_commands_recovery ON control_commands (status, expires_at);
