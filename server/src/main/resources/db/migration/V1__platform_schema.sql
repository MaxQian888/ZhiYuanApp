CREATE TABLE admins (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  role VARCHAR(16) NOT NULL,
  phone VARCHAR(24) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(80) NOT NULL,
  phone VARCHAR(24) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_addresses (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  receiver_name VARCHAR(80) NOT NULL,
  receiver_phone VARCHAR(24) NOT NULL,
  detail VARCHAR(255) NOT NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT fk_address_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_address_user (user_id)
);

CREATE TABLE goods (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(24) NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  stock INT NOT NULL,
  weight DECIMAL(10,3) NOT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  INDEX idx_goods_category_status (category, status)
);

CREATE TABLE uavs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  rfid_tag VARCHAR(64) NOT NULL UNIQUE,
  model VARCHAR(80) NOT NULL,
  owner_name VARCHAR(80) NOT NULL,
  status VARCHAR(16) NOT NULL,
  battery INT NOT NULL,
  in_hibernate_pod BOOLEAN NOT NULL DEFAULT FALSE,
  region VARCHAR(80) NOT NULL,
  altitude DECIMAL(10,2) NOT NULL DEFAULT 0,
  speed DECIMAL(10,2) NOT NULL DEFAULT 0,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_uav_status_region (status, region)
);

CREATE TABLE hibernate_pods (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(64) NOT NULL UNIQUE,
  region VARCHAR(80) NOT NULL,
  door_status VARCHAR(16) NOT NULL,
  uav_id BIGINT NULL UNIQUE,
  CONSTRAINT fk_pod_uav FOREIGN KEY (uav_id) REFERENCES uavs(id) ON DELETE SET NULL
);

CREATE TABLE orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_no VARCHAR(48) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL,
  address_id BIGINT NOT NULL,
  address_snapshot JSON NOT NULL,
  total_price DECIMAL(12,2) NOT NULL,
  status VARCHAR(24) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_order_address FOREIGN KEY (address_id) REFERENCES user_addresses(id),
  INDEX idx_order_status_created (status, created_at)
);

CREATE TABLE order_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  goods_id BIGINT NOT NULL,
  goods_name VARCHAR(120) NOT NULL,
  count INT NOT NULL,
  price DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_goods FOREIGN KEY (goods_id) REFERENCES goods(id)
);

CREATE TABLE uav_tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL UNIQUE,
  uav_id BIGINT NOT NULL,
  task_status VARCHAR(24) NOT NULL,
  start_time TIMESTAMP NULL,
  end_time TIMESTAMP NULL,
  failure_reason VARCHAR(255) NULL,
  CONSTRAINT fk_task_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_task_uav FOREIGN KEY (uav_id) REFERENCES uavs(id),
  INDEX idx_task_status (task_status)
);

CREATE TABLE alerts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  uav_id BIGINT NULL,
  title VARCHAR(255) NOT NULL,
  level VARCHAR(16) NOT NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by BIGINT NULL,
  resolved_at TIMESTAMP NULL,
  CONSTRAINT fk_alert_uav FOREIGN KEY (uav_id) REFERENCES uavs(id) ON DELETE SET NULL,
  INDEX idx_alert_level_resolved (level, resolved)
);

CREATE TABLE flight_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  uav_id BIGINT NOT NULL,
  event VARCHAR(80) NOT NULL,
  detail VARCHAR(255) NOT NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_flight_uav FOREIGN KEY (uav_id) REFERENCES uavs(id) ON DELETE CASCADE,
  INDEX idx_flight_uav_time (uav_id, occurred_at)
);

CREATE TABLE control_commands (
  id VARCHAR(36) PRIMARY KEY,
  uav_id BIGINT NOT NULL,
  type VARCHAR(24) NOT NULL,
  status VARCHAR(24) NOT NULL,
  source VARCHAR(16) NOT NULL,
  transcript VARCHAR(255) NULL,
  operator_id BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_command_uav FOREIGN KEY (uav_id) REFERENCES uavs(id),
  CONSTRAINT fk_command_admin FOREIGN KEY (operator_id) REFERENCES admins(id),
  INDEX idx_command_uav_time (uav_id, created_at)
);

CREATE TABLE device_bindings (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  staff_id BIGINT NOT NULL,
  uav_id BIGINT NOT NULL,
  bound_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unbound_at TIMESTAMP NULL,
  CONSTRAINT fk_binding_admin FOREIGN KEY (staff_id) REFERENCES admins(id),
  CONSTRAINT fk_binding_uav FOREIGN KEY (uav_id) REFERENCES uavs(id),
  INDEX idx_binding_active (staff_id, unbound_at)
);

CREATE TABLE refresh_sessions (
  id VARCHAR(36) PRIMARY KEY,
  staff_id BIGINT NOT NULL,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  user_agent VARCHAR(255) NOT NULL,
  ip_address VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP NULL,
  CONSTRAINT fk_session_admin FOREIGN KEY (staff_id) REFERENCES admins(id) ON DELETE CASCADE,
  INDEX idx_session_staff_active (staff_id, revoked_at, expires_at)
);
