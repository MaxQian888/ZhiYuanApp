-- ClickHouse schema for telemetry history (ADR 0003).
--
-- Applied out of band, not by Flyway: Flyway owns the transactional database, and mixing
-- the two would make a MySQL migration failure roll back — or fail to roll back — a
-- ClickHouse change. Run this once per environment before pointing the API at it:
--
--   clickhouse-client --host <host> --secure --user <user> --password <pw> \
--     --queries-file server/src/main/resources/clickhouse/schema.sql

CREATE DATABASE IF NOT EXISTS zhiyuan;

-- Every sample as the device sent it.
--
-- ReplacingMergeTree keyed on the natural identity of a sample is what makes a retried
-- batch safe: a redelivered message converges to the same single row rather than inflating
-- the track. `event_id` is in the key because a device may legitimately emit two samples
-- with the same timestamp after a clock adjustment.
CREATE TABLE IF NOT EXISTS zhiyuan.telemetry_raw
(
    event_id    String,
    uav_code    LowCardinality(String),
    sequence    UInt64,
    observed_at DateTime64(3, 'UTC'),
    status      LowCardinality(String),
    battery     UInt8,
    latitude    Float64,
    longitude   Float64,
    altitude    Float32,
    speed       Float32,
    ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY toYYYYMMDD(observed_at)
ORDER BY (uav_code, observed_at, event_id)
TTL toDateTime(observed_at) + INTERVAL 7 DAY
SETTINGS index_granularity = 8192;

-- One row per device per minute, for trends and capacity work.
--
-- Aggregate states make retries and out-of-order delivery deterministic. The event-time tuple
-- breaks timestamp ties with the device sequence and immutable event id. We intentionally do not
-- retain an exact event-id set in the 365-day table: at fleet scale it would outgrow raw history.
CREATE TABLE IF NOT EXISTS zhiyuan.telemetry_1m
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

-- Keeps the rollup current as raw rows land, so no batch job can fall behind or be missed.
CREATE MATERIALIZED VIEW IF NOT EXISTS zhiyuan.telemetry_1m_mv TO zhiyuan.telemetry_1m AS
SELECT
    uav_code,
    toStartOfMinute(observed_at)                                        AS minute,
    argMaxState(toString(status), tuple(observed_at, sequence, event_id)) AS status,
    argMaxState(battery, tuple(observed_at, sequence, event_id))         AS battery,
    argMaxState(latitude, tuple(observed_at, sequence, event_id))        AS latitude,
    argMaxState(longitude, tuple(observed_at, sequence, event_id))       AS longitude,
    maxState(altitude)                                                   AS altitude,
    maxState(speed)                                                      AS speed
FROM zhiyuan.telemetry_raw
GROUP BY uav_code, minute;
