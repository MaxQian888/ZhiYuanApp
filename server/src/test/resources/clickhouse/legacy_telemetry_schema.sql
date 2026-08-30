DROP TABLE IF EXISTS zhiyuan.telemetry_1m_mv;
DROP TABLE IF EXISTS zhiyuan.telemetry_1m_legacy_20260830_mv;
DROP TABLE IF EXISTS zhiyuan.telemetry_1m_migration_002_cutoff;
DROP TABLE IF EXISTS zhiyuan.telemetry_1m_failed_20260830;
DROP TABLE IF EXISTS zhiyuan.telemetry_1m_legacy_20260830;
DROP TABLE IF EXISTS zhiyuan.telemetry_1m;

TRUNCATE TABLE zhiyuan.telemetry_raw;

CREATE TABLE zhiyuan.telemetry_1m
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
TTL minute + INTERVAL 365 DAY;

CREATE MATERIALIZED VIEW zhiyuan.telemetry_1m_mv TO zhiyuan.telemetry_1m AS
SELECT
    uav_code,
    toStartOfMinute(observed_at) AS minute,
    anyLast(status) AS status,
    anyLast(battery) AS battery,
    anyLast(latitude) AS latitude,
    anyLast(longitude) AS longitude,
    max(altitude) AS altitude,
    max(speed) AS speed,
    count() AS samples
FROM zhiyuan.telemetry_raw
GROUP BY uav_code, minute;

INSERT INTO zhiyuan.telemetry_1m
SELECT
    'MIGRATION-HISTORY',
    toStartOfMinute(now('UTC') - INTERVAL 8 DAY),
    'ONLINE', 55, 31.90, 118.60, 40.0, 8.0, 42;

INSERT INTO zhiyuan.telemetry_raw
    (event_id, uav_code, sequence, observed_at, status, battery, latitude, longitude,
     altitude, speed)
SELECT
    'migration-event-1', 'MIGRATION-RECENT', 1,
    toStartOfMinute(now64(3, 'UTC')) + INTERVAL 10 SECOND,
    'ONLINE', 73, 32.06, 118.78, 48.5, 12.3;

INSERT INTO zhiyuan.telemetry_raw
    (event_id, uav_code, sequence, observed_at, status, battery, latitude, longitude,
     altitude, speed)
SELECT
    'migration-event-2', 'MIGRATION-RECENT', 2,
    toStartOfMinute(now64(3, 'UTC')) + INTERVAL 20 SECOND,
    'FLYING', 62, 32.07, 118.79, 58.5, 14.3;

INSERT INTO zhiyuan.telemetry_raw
    (event_id, uav_code, sequence, observed_at, status, battery, latitude, longitude,
     altitude, speed)
SELECT
    'migration-event-2', 'MIGRATION-RECENT', 2,
    toStartOfMinute(now64(3, 'UTC')) + INTERVAL 20 SECOND,
    'FLYING', 62, 32.07, 118.79, 58.5, 14.3
UNION ALL
SELECT
    'migration-event-1', 'MIGRATION-RECENT', 1,
    toStartOfMinute(now64(3, 'UTC')) + INTERVAL 10 SECOND,
    'ONLINE', 73, 32.06, 118.78, 48.5, 12.3;
