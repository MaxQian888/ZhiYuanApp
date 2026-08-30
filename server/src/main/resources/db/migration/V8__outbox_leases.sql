-- Reliable multi-instance outbox consumption. Existing publishers ignore these additive
-- columns, which is why the rollout runbook enables the new publisher only after every old
-- instance has left the fleet.
ALTER TABLE outbox ADD COLUMN claim_token VARCHAR(64) NULL;
ALTER TABLE outbox ADD COLUMN claim_until TIMESTAMP NULL;
ALTER TABLE outbox ADD COLUMN next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX idx_outbox_claimable
  ON outbox (published_at, next_attempt_at, claim_until, id);
