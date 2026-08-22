-- ADR 0001 · 库存预留模型
--
-- Expand step of an expand/contract migration (ADR 0004): every statement here is
-- additive, so a rolling deploy where old and new instances run side by side stays
-- correct. `goods.stock` keeps its existing meaning — available stock — and the
-- physical count becomes stock + reserved_stock.

ALTER TABLE goods ADD COLUMN reserved_stock INT NOT NULL DEFAULT 0;

-- Optimistic concurrency for order transitions. Two operators acting on the same
-- order at once must not both win.
ALTER TABLE orders ADD COLUMN version INT NOT NULL DEFAULT 0;

-- Master data is disabled, never physically deleted, once business rows reference
-- it. Goods already carry `status`; customers did not have an equivalent.
ALTER TABLE users ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Immutable record of every inventory movement. `available_delta` and
-- `reserved_delta` are signed and always sum to the physical change:
--   reserve  (-n, +n)  physical unchanged, availability drops
--   release  (+n, -n)  physical unchanged, availability returns
--   consume  ( 0, -n)  physical drops, the reservation is redeemed
--   adjust   (±n,  0)  manual correction, physical follows availability
CREATE TABLE inventory_ledger (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  goods_id BIGINT NOT NULL,
  order_id BIGINT NULL,
  reason VARCHAR(24) NOT NULL,
  available_delta INT NOT NULL,
  reserved_delta INT NOT NULL,
  available_after INT NOT NULL,
  reserved_after INT NOT NULL,
  operator_id BIGINT NULL,
  idempotency_key VARCHAR(64) NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ledger_goods FOREIGN KEY (goods_id) REFERENCES goods(id),
  CONSTRAINT fk_ledger_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_ledger_operator FOREIGN KEY (operator_id) REFERENCES admins(id),
  INDEX idx_ledger_goods_time (goods_id, occurred_at),
  INDEX idx_ledger_order (order_id)
);

-- Why an order is in the state it is in. Without this, a cancelled order tells you
-- nothing about who cancelled it or why.
CREATE TABLE order_status_history (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  from_status VARCHAR(24) NULL,
  to_status VARCHAR(24) NOT NULL,
  operator_id BIGINT NULL,
  reason VARCHAR(255) NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_history_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_history_operator FOREIGN KEY (operator_id) REFERENCES admins(id),
  INDEX idx_history_order_time (order_id, occurred_at)
);

-- A replayed request returns the original result rather than performing the work a
-- second time. `request_fingerprint` catches a key reused for a different payload,
-- which is a client bug and must surface as a conflict rather than silently
-- returning someone else's order.
CREATE TABLE idempotency_records (
  scope VARCHAR(48) NOT NULL,
  idempotency_key VARCHAR(64) NOT NULL,
  request_fingerprint CHAR(64) NOT NULL,
  result_ref VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, idempotency_key)
);

-- Backfill: every historical order is either finished or cancelled, so nothing is
-- still holding a reservation. In-flight orders at cutover are reconciled by hand
-- against the report the deploy runbook prints (see ADR 0001).
UPDATE goods SET reserved_stock = 0;

-- Seed the history table so existing orders are not left without provenance.
INSERT INTO order_status_history (order_id, from_status, to_status, reason)
SELECT id, NULL, status, 'migrated' FROM orders;
