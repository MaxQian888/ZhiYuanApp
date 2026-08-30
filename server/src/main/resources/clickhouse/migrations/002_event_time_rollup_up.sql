-- Existing-environment migration for the deterministic telemetry_1m schema.
--
-- Preconditions:
--   1. Disable telemetry ingestion on every API instance.
--   2. Wait until the telemetry archive backlog is empty.
--   3. Take a ClickHouse backup/snapshot.
--
-- Fresh environments use ../schema.sql and MUST NOT run this migration. The legacy table and
-- materialized view remain live after cutover so 002_event_time_rollup_down.sql can roll back
-- without losing samples received during the observation window.

DROP TABLE IF EXISTS zhiyuan.telemetry_1m_mv;

RENAME TABLE zhiyuan.telemetry_1m TO zhiyuan.telemetry_1m_legacy_20260830;

CREATE TABLE zhiyuan.telemetry_1m_migration_002_cutoff
(
    cutoff DateTime('UTC')
)
ENGINE = TinyLog;

INSERT INTO zhiyuan.telemetry_1m_migration_002_cutoff
SELECT toStartOfMinute(now('UTC') - INTERVAL 7 DAY);

CREATE TABLE zhiyuan.telemetry_1m
(
    uav_code   LowCardinality(String),
    minute     DateTime('UTC'),
    status     AggregateFunction(argMax, String,
                   Tuple(DateTime64(3, 'UTC'), UInt64, String)),
    battery    AggregateFunction(argMax, UInt8,
                   Tuple(DateTime64(3, 'UTC'), UInt64, String)),
    latitude   AggregateFunction(argMax, Float64,
                   Tuple(DateTime64(3, 'UTC'), UInt64, String)),
    longitude  AggregateFunction(argMax, Float64,
                   Tuple(DateTime64(3, 'UTC'), UInt64, String)),
    altitude   AggregateFunction(max, Float32),
    speed      AggregateFunction(max, Float32)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(minute)
ORDER BY (uav_code, minute)
TTL minute + INTERVAL 365 DAY
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW zhiyuan.telemetry_1m_mv TO zhiyuan.telemetry_1m AS
SELECT
    uav_code,
    toStartOfMinute(observed_at)                                         AS minute,
    argMaxState(toString(status), tuple(observed_at, sequence, event_id)) AS status,
    argMaxState(battery, tuple(observed_at, sequence, event_id))          AS battery,
    argMaxState(latitude, tuple(observed_at, sequence, event_id))         AS latitude,
    argMaxState(longitude, tuple(observed_at, sequence, event_id))        AS longitude,
    maxState(altitude)                                                    AS altitude,
    maxState(speed)                                                       AS speed
FROM zhiyuan.telemetry_raw
GROUP BY uav_code, minute;

-- Keep the old rollup current during the observation window. It is only a rollback target;
-- the application reads telemetry_1m after this migration.
CREATE MATERIALIZED VIEW zhiyuan.telemetry_1m_legacy_20260830_mv
TO zhiyuan.telemetry_1m_legacy_20260830 AS
SELECT
    uav_code,
    toStartOfMinute(observed_at) AS minute,
    anyLast(status)              AS status,
    anyLast(battery)             AS battery,
    anyLast(latitude)            AS latitude,
    anyLast(longitude)           AS longitude,
    max(altitude)                AS altitude,
    max(speed)                   AS speed,
    count()                      AS samples
FROM zhiyuan.telemetry_raw
GROUP BY uav_code, minute;

-- Preserve rollups older than raw retention. Their original event timestamps are no longer
-- available, so the already-selected legacy point is represented at the start of its minute.
INSERT INTO zhiyuan.telemetry_1m
SELECT
    uav_code,
    minute,
    argMaxState(toString(status), legacy_order) AS status,
    argMaxState(battery, legacy_order)           AS battery,
    argMaxState(latitude, legacy_order)          AS latitude,
    argMaxState(longitude, legacy_order)         AS longitude,
    maxState(altitude)                           AS altitude,
    maxState(speed)                              AS speed
FROM
(
    SELECT
        uav_code,
        minute,
        anyLast(status) AS status,
        anyLast(battery) AS battery,
        anyLast(latitude) AS latitude,
        anyLast(longitude) AS longitude,
        max(altitude) AS altitude,
        max(speed) AS speed,
        tuple(toDateTime64(minute, 3, 'UTC'), toUInt64(0), 'legacy') AS legacy_order
    FROM zhiyuan.telemetry_1m_legacy_20260830
    WHERE minute <= (SELECT cutoff FROM zhiyuan.telemetry_1m_migration_002_cutoff)
    GROUP BY uav_code, minute
)
GROUP BY uav_code, minute;

-- Rebuild the recent window from raw immutable event identities. FINAL removes retried raw rows
-- before their aggregate states are generated.
INSERT INTO zhiyuan.telemetry_1m
SELECT
    uav_code,
    toStartOfMinute(observed_at)                                         AS minute,
    argMaxState(toString(status), tuple(observed_at, sequence, event_id)) AS status,
    argMaxState(battery, tuple(observed_at, sequence, event_id))          AS battery,
    argMaxState(latitude, tuple(observed_at, sequence, event_id))         AS latitude,
    argMaxState(longitude, tuple(observed_at, sequence, event_id))        AS longitude,
    maxState(altitude)                                                    AS altitude,
    maxState(speed)                                                       AS speed
FROM zhiyuan.telemetry_raw FINAL
WHERE toStartOfMinute(observed_at) >
    (SELECT cutoff FROM zhiyuan.telemetry_1m_migration_002_cutoff)
GROUP BY uav_code, minute;

DROP TABLE zhiyuan.telemetry_1m_migration_002_cutoff;

-- Resume telemetry ingestion only after every statement succeeds. Keep the legacy table and
-- view for the agreed observation window; drop both after the rollback window closes.
