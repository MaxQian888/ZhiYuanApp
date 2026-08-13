ALTER TABLE alerts ADD COLUMN acknowledged_by BIGINT NULL;
ALTER TABLE alerts ADD COLUMN acknowledged_at TIMESTAMP NULL;
ALTER TABLE alerts ADD COLUMN pod_id BIGINT NULL;
ALTER TABLE alerts ADD CONSTRAINT fk_alert_acknowledged_by
  FOREIGN KEY (acknowledged_by) REFERENCES admins(id) ON DELETE SET NULL;
ALTER TABLE alerts ADD CONSTRAINT fk_alert_resolved_by
  FOREIGN KEY (resolved_by) REFERENCES admins(id) ON DELETE SET NULL;
ALTER TABLE alerts ADD CONSTRAINT fk_alert_pod
  FOREIGN KEY (pod_id) REFERENCES hibernate_pods(id) ON DELETE SET NULL;

UPDATE alerts SET pod_id = 3 WHERE uav_id IS NULL AND title = '3 号休眠仓舱门异常';

ALTER TABLE flight_logs ADD COLUMN latitude DECIMAL(10, 7) NULL;
ALTER TABLE flight_logs ADD COLUMN longitude DECIMAL(10, 7) NULL;
