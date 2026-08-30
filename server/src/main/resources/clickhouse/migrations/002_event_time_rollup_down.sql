-- Coordinated rollback for 002_event_time_rollup_up.sql.
-- Disable telemetry ingestion before running, then deploy the previous application version.

DROP TABLE IF EXISTS zhiyuan.telemetry_1m_mv;
DROP TABLE IF EXISTS zhiyuan.telemetry_1m_legacy_20260830_mv;
DROP TABLE IF EXISTS zhiyuan.telemetry_1m_migration_002_cutoff;

RENAME TABLE
    zhiyuan.telemetry_1m TO zhiyuan.telemetry_1m_failed_20260830,
    zhiyuan.telemetry_1m_legacy_20260830 TO zhiyuan.telemetry_1m;

CREATE MATERIALIZED VIEW zhiyuan.telemetry_1m_mv TO zhiyuan.telemetry_1m AS
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

-- Resume telemetry ingestion after the previous application version is healthy. Retain
-- telemetry_1m_failed_20260830 until rollback validation and any required reconciliation finish.
