#!/usr/bin/env bash
set -euo pipefail

readonly clickhouse_password="${CLICKHOUSE_PASSWORD:-zhiyuan-dev}"
readonly client=(docker compose exec -T clickhouse clickhouse-client
  --user zhiyuan --password "${clickhouse_password}")

query() {
  "${client[@]}" --format TSVRaw --query "$1"
}

assert_equals() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "${label}: expected '${expected}', got '${actual}'" >&2
    exit 1
  fi
}

restore_fresh_schema() {
  set +e
  "${client[@]}" --multiquery <<'SQL'
DROP TABLE IF EXISTS zhiyuan.telemetry_1m_mv;
DROP TABLE IF EXISTS zhiyuan.telemetry_1m_legacy_20260830_mv;
DROP TABLE IF EXISTS zhiyuan.telemetry_1m_migration_002_cutoff;
DROP TABLE IF EXISTS zhiyuan.telemetry_1m_failed_20260830;
DROP TABLE IF EXISTS zhiyuan.telemetry_1m_legacy_20260830;
DROP TABLE IF EXISTS zhiyuan.telemetry_1m;
DROP TABLE IF EXISTS zhiyuan.telemetry_raw;
SQL
  "${client[@]}" --multiquery < server/src/main/resources/clickhouse/schema.sql
}
trap restore_fresh_schema EXIT

"${client[@]}" --multiquery < server/src/test/resources/clickhouse/legacy_telemetry_schema.sql
"${client[@]}" --multiquery \
  < server/src/main/resources/clickhouse/migrations/002_event_time_rollup_up.sql

history="$(query "
  SELECT concat(argMaxMerge(status), '|', toString(argMaxMerge(battery)))
  FROM zhiyuan.telemetry_1m
  WHERE uav_code = 'MIGRATION-HISTORY'
  GROUP BY uav_code, minute")"
assert_equals "ONLINE|55" "${history}" "legacy history migration"

recent_query="
  SELECT concat(argMaxMerge(status), '|', toString(argMaxMerge(battery)), '|',
    toString(argMaxMerge(latitude)), '|', toString(argMaxMerge(longitude)), '|',
    toString(maxMerge(altitude)), '|', toString(maxMerge(speed)))
  FROM zhiyuan.telemetry_1m
  WHERE uav_code = 'MIGRATION-RECENT'
  GROUP BY uav_code, minute"
assert_equals "FLYING|62|32.07|118.79|58.5|14.3" "$(query "${recent_query}")" \
  "reordered retry migration"

# Replay the older event after the newer one through the migrated materialized view.
"${client[@]}" --multiquery <<'SQL'
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
    'migration-event-1', 'MIGRATION-RECENT', 1,
    toStartOfMinute(now64(3, 'UTC')) + INTERVAL 10 SECOND,
    'ONLINE', 73, 32.06, 118.78, 48.5, 12.3;
SQL
assert_equals "FLYING|62|32.07|118.79|58.5|14.3" "$(query "${recent_query}")" \
  "post-cutover replay"

"${client[@]}" --multiquery \
  < server/src/main/resources/clickhouse/migrations/002_event_time_rollup_down.sql

legacy="$(query "
  SELECT concat(anyLast(status), '|', toString(anyLast(battery)), '|',
    toString(sum(samples)))
  FROM zhiyuan.telemetry_1m
  WHERE uav_code = 'MIGRATION-HISTORY'
  GROUP BY uav_code, minute")"
assert_equals "ONLINE|55|42" "${legacy}" "legacy rollback query"

rollback_recent="$(query "
  SELECT concat(toString(max(altitude)), '|', toString(sum(samples)))
  FROM zhiyuan.telemetry_1m
  WHERE uav_code = 'MIGRATION-RECENT'
  GROUP BY uav_code, minute")"
assert_equals "58.5|6" "${rollback_recent}" "legacy shadow view during rollback window"

echo "ClickHouse telemetry rollup up/down migration contract passed."
