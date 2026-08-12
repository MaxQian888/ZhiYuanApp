INSERT INTO admins (username, password_hash, display_name, role, phone) VALUES
('admin', '$2y$10$YRKvnTTrd5BAC4KOQE4OcuQXZkMNzPBlQaQEDHjDR8i5v5eQ7gURS', '陈屿', 'admin', '13800000001'),
('manager', '$2y$10$YRKvnTTrd5BAC4KOQE4OcuQXZkMNzPBlQaQEDHjDR8i5v5eQ7gURS', '林潇', 'manager', '13800000002');

INSERT INTO users (username, phone) VALUES ('王宁', '13900000001'), ('赵青', '13900000002'), ('李晗', '13900000003');
INSERT INTO user_addresses (user_id, receiver_name, receiver_phone, detail, latitude, longitude, is_default) VALUES
(1, '王宁', '13900000001', '南京市玄武区珠江路 1 号', 32.0500000, 118.7900000, TRUE),
(2, '赵青', '13900000002', '苏州市工业园区星海街 8 号', 31.3100000, 120.6700000, TRUE);
INSERT INTO goods (name, category, price, stock, weight, status) VALUES
('应急药品包', 'medicine', 89.00, 42, 0.800, 1), ('冷链餐食 A', 'food', 42.50, 18, 1.200, 1),
('工业检测仪', 'industry', 1299.00, 5, 2.400, 1), ('生活补给包', 'life', 65.00, 0, 1.600, 0);
INSERT INTO uavs (code, name, rfid_tag, model, owner_name, status, battery, in_hibernate_pod, region, altitude, speed, latitude, longitude) VALUES
('UAV-01','巡检一号','RFID-0001','DJI Mavic 3','陈屿','ONLINE',78,TRUE,'南京',30,5.2,32.06,118.78),
('UAV-02','配送二号','RFID-0002','DJI Air 2S','林潇','FLYING',42,FALSE,'苏州',82,12.4,31.30,120.62),
('UAV-03','应急三号','RFID-0003','Autel EVO II','陈屿','CHARGING',15,TRUE,'上海',0,0,31.23,121.47),
('UAV-04','巡检四号','RFID-0004','DJI Mini 4 Pro','周衡','OFFLINE',0,FALSE,'杭州',0,0,30.27,120.15),
('UAV-05','配送五号','RFID-0005','DJI Matrice 30','林潇','ONLINE',63,FALSE,'无锡',12,2.4,31.49,120.31),
('UAV-06','备勤六号','RFID-0006','Autel Alpha','周衡','ONLINE',91,FALSE,'南京',0,0,32.07,118.80);
INSERT INTO hibernate_pods (name, region, door_status, uav_id) VALUES ('POD-01','南京','CLOSED',1),('POD-02','苏州','OPEN',NULL),('POD-03','上海','ERROR',3);
INSERT INTO alerts (uav_id,title,level,resolved) VALUES (2,'UAV-02 电量低于 45%','HIGH',FALSE),(5,'UAV-05 信号弱','MID',FALSE),(NULL,'3 号休眠仓舱门异常','LOW',FALSE);
INSERT INTO flight_logs (uav_id,event,detail) VALUES (2,'任务起飞','订单 ZY-20260812-003'),(1,'遥测同步','高度 30m，速度 5.2m/s'),(3,'进入充电','休眠仓 POD-03');
INSERT INTO orders (order_no,user_id,address_id,address_snapshot,total_price,status) VALUES
('ZY-20260812-001',1,1,JSON_OBJECT('receiverName','王宁','receiverPhone','13900000001','detail','南京市玄武区珠江路 1 号'),89,'CREATED'),
('ZY-20260812-002',2,2,JSON_OBJECT('receiverName','赵青','receiverPhone','13900000002','detail','苏州市工业园区星海街 8 号'),85,'DISPATCHING'),
('ZY-20260812-003',2,2,JSON_OBJECT('receiverName','赵青','receiverPhone','13900000002','detail','苏州市工业园区星海街 8 号'),1299,'DELIVERING');
INSERT INTO order_items (order_id,goods_id,goods_name,count,price) VALUES (1,1,'应急药品包',1,89),(2,2,'冷链餐食 A',2,42.5),(3,3,'工业检测仪',1,1299);
INSERT INTO uav_tasks (order_id,uav_id,task_status,start_time) VALUES (2,1,'WAITING',NULL),(3,2,'FLYING',CURRENT_TIMESTAMP);
INSERT INTO device_bindings (staff_id,uav_id) VALUES (1,1),(1,3);
