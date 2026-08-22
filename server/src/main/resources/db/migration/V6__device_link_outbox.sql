-- ADR 0002 · 设备链路 outbox 与快照
--
-- Additive, like every migration in this programme (ADR 0004).

-- The device's own monotonic counter, kept alongside the snapshot so a redelivered or
-- reordered QoS 1 message can be recognised and discarded at the storage layer, not just
-- in memory. A restarted instance therefore rejects stale messages immediately rather than
-- accepting one stale sample per device while its in-memory view warms up.
ALTER TABLE uavs ADD COLUMN last_sequence BIGINT NOT NULL DEFAULT 0;

-- When the device sampled the position we are storing, as opposed to when we wrote it.
-- `updated_at` answers "when did this row change"; this answers "how old is this fix",
-- which is the question the command freshness gate actually asks.
ALTER TABLE uavs ADD COLUMN observed_at TIMESTAMP NULL;

-- Transactional outbox.
--
-- Written in the same transaction as the snapshot it describes, so "the device moved" and
-- "everyone was told the device moved" cannot come apart. Publishing directly from the
-- ingest path would lose events whenever the process died between commit and publish, and
-- publishing before commit would announce changes that then rolled back.
CREATE TABLE outbox (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  event_type VARCHAR(48) NOT NULL,
  aggregate_id VARCHAR(64) NOT NULL,
  payload TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP NULL,
  attempts INT NOT NULL DEFAULT 0,
  INDEX idx_outbox_pending (published_at, id),
  INDEX idx_outbox_created (created_at)
);

-- Rejected device messages, kept so "the fleet went quiet" can be told apart from "the
-- fleet is fine and we are dropping everything it sends". Without this, a firmware release
-- that changes a field name looks identical to a network outage.
CREATE TABLE device_message_rejections (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  uav_code VARCHAR(32) NULL,
  topic VARCHAR(128) NOT NULL,
  reason VARCHAR(64) NOT NULL,
  detail VARCHAR(512) NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rejection_time (occurred_at),
  INDEX idx_rejection_reason (reason, occurred_at)
);
