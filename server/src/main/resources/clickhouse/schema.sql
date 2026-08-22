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
-- Aggregating state rather than plain numbers so the rollup stays correct when parts merge;
-- a plain avg() column would be re-averaged on merge and drift.
CREATE TABLE IF NOT EXISTS zhiyuan.telemetry_1m
(
    uav_code   LowCardinality(String),
    minute     DateTime('UTC'),
    status     SimpleAggregateFunction(anyLast, LowCardinality(String)),
    battery    SimpleAggregateFunction(anyLast, UInt8),
    latitude   SimpleAggregateFunction(anyLast, Float64),
    longitude  SimpleAggregateFunction(anyLast, Float64),
    altitude   SimpleAggregateFunction(max, Float32),
    speed      SimpleAggregateFunction(max, Float32),
    samples    SimpleAggregateFunction(sum, UInt64)
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
