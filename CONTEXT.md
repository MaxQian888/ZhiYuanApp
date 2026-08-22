# 智鸢领域词汇表 / ZhiYuan Domain Vocabulary

本文件是智鸢平台的**统一语言（ubiquitous language）**。代码标识符、数据库列、API 字段、日志和界面文案都必须使用这里定义的词。

改变一个词的含义等同于改变领域模型 —— 请先更新本文件，并在需要时补一条 ADR（见 `docs/content/docs/adr/`）。

---

## 1. 身份与访问 / Identity

| 术语           | 标识符                | 含义                                                                             |
| -------------- | --------------------- | -------------------------------------------------------------------------------- |
| 员工 / Staff   | `Staff`, `admins` 表  | 平台的操作人员。**不是**客户。角色为 `admin` 或 `manager`。                      |
| 客户 / User    | `User`, `users` 表    | 下单收货的一方。**永远不登录运营台。**                                           |
| 角色 / Role    | `role`                | 仅 `admin`（全权）与 `manager`（无员工管理、无系统设置）两种。不引入第三种角色。 |
| 会话 / Session | `refresh_sessions` 表 | 一条 refresh token 的存活记录，可被单独撤销。access token 不落库。               |
| MFA 挑战       | `challengeToken`      | 登录第一阶段通过、但尚未提供 TOTP 时签发的短时令牌。**不是** access token。      |
| 恢复码         | `recoveryCode`        | 一次性 MFA 兜底凭据。只存哈希，用后即焚。                                        |

**"用户" 这个词在本仓库有歧义，禁止单独使用。** 说 `staff`（员工）或 `customer/User`（客户）。

## 2. 设备 / Fleet

| 术语                    | 标识符            | 含义                                                                                      |
| ----------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| 无人机 / UAV            | `Uav`, `uavs` 表  | 一台受管设备。业务主键是 `uavCode`（如 `UAV-01`），MQTT topic 用它，不用数据库自增 `id`。 |
| 休眠仓 / Pod            | `Pod`             | 停放与充电站。舱门状态 `OPEN` / `CLOSED` / `ERROR`。                                      |
| 绑定 / Binding          | `Binding`         | 员工与设备的责任关系，可撤销（`unboundAt`）。绑定**不**授予控制权，权限由角色决定。       |
| 遥测 / Telemetry        | `telemetry`       | 设备**主动上报**的位置与状态采样。飞行态 5Hz。                                            |
| 在线状态 / Presence     | `presence`        | 设备连接与否。由 MQTT retained Last-Will 维持，**与遥测新鲜度是两件事**。                 |
| 新鲜度 / Freshness      | `observedAt`      | 遥测的采样时刻。飞行态超过 2 秒、地面态超过 5 秒即**过期（stale）**，此时拒绝下发指令。   |
| 指令 / Control command  | `ControlCommand`  | 一次人工下发的动作。状态 `QUEUED → SENT → ACKNOWLEDGED`，失败为 `FAILED` / `TIMEOUT`。    |
| 回执 / Dispatch receipt | `DispatchReceipt` | adapter 对"已交给传输层"的确认。**不代表设备已执行** —— 那是 ACK 的事。                   |

`ONLINE` / `FLYING` / `CHARGING` / `OFFLINE` 是**设备状态**（uav.status）；`live` / `reconnecting` / `offline` 是**前端与服务端的连接状态**（realtimeState）。两者不可混用。

## 3. 库存与订单 / Fulfilment

这是本平台最容易说错的一段。三个"库存"必须区分：

| 术语                     | 标识符           | 含义                                                                |
| ------------------------ | ---------------- | ------------------------------------------------------------------- |
| **可用库存 / Available** | `goods.stock`    | 还能被新订单占用的数量。**下单即减**。                              |
| **预留库存 / Reserved**  | `reserved_stock` | 已被未完成订单占住、但尚未实际发出的数量。                          |
| **在手库存 / On-hand**   | `onHandStock`    | 物理上还在仓里的数量 = `stock + reserved_stock`。派生字段，不落库。 |

生命周期：

```
下单     stock -= n   reserved += n      （占用）
取消     stock += n   reserved -= n      （释放）
送达     　　　　　　  reserved -= n      （核销，在手减少）
任务失败 　　　　　　  reserved 不变       （保留占用，等待重新派单）
```

| 术语         | 标识符                 | 含义                                                                         |
| ------------ | ---------------------- | ---------------------------------------------------------------------------- |
| 订单 / Order | `Order`                | 客户的一次购买。状态见下。                                                   |
| 任务 / Task  | `Task`, `uav_tasks` 表 | 为**一个订单**执行的**一次**配送尝试。订单与任务是 1:1（重派会复用同一行）。 |
| 库存流水     | `inventory_ledger`     | 每一次库存变化的不可变记录，必带订单、操作人、原因、幂等键。                 |
| 幂等键       | `Idempotency-Key`      | 客户端生成，用于让重复请求返回**原来那次**的结果，而不是做第二次。           |

订单状态：`CREATED → DISPATCHING → DELIVERING → FINISHED`，另有 `CANCELLED` 与 `ERROR`。
任务状态：`WAITING → FLYING → ARRIVED`，失败为 `FAILED`。

**"完成" 有两个含义，必须限定：** 订单 `FINISHED`（业务闭环）vs 任务 `ARRIVED`（飞行结束）。

## 4. 数据链路 / Data plane

| 术语            | 标识符           | 含义                                                                                |
| --------------- | ---------------- | ----------------------------------------------------------------------------------- |
| 快照 / Snapshot | `uavs` 表当前行  | 设备**最新一条**状态。MySQL 只保存这一份，不保存历史。                              |
| 轨迹 / Track    | ClickHouse       | 遥测的历史序列。raw 保 7 天，1 分钟降采样保 365 天。                                |
| Outbox          | `outbox` 表      | 与业务写在同一事务里的待发布事件。保证"业务落库"和"事件发出"不会只成功一半。        |
| 平台事件        | `platform event` | outbox 再发布出来的**规范化**事件，所有实例订阅，用于扇出 SSE。与设备原始消息不同。 |
| 共享订阅        | MQTT shared sub  | 多实例分摊消费同一设备流，避免每个实例都处理一遍。                                  |
| 序号 / Sequence | `sequence`       | 设备侧单调递增计数，用于识别乱序与重复。**不是**时间戳。                            |

## 5. 坐标与时间 / Coordinates and time

- **持久化一律 WGS-84 + UTC。** 数据库、API、MQTT 消息里的坐标都是 WGS-84。
- **GCJ-02 只存在于高德地图渲染层**，由 `MapProvider`（`lib/map/`）在显示前转换，转换结果不回写。
- 界面展示使用 `Asia/Shanghai`；转换发生在展示层，不在存储层。

## 6. 语音 / Voice

| 术语            | 标识符            | 含义                                                                  |
| --------------- | ----------------- | --------------------------------------------------------------------- |
| ASR 会话        | `AsrSession`      | 一次认证过的识别通道，最长 15 秒音频。                                |
| partial / final | ASR 事件          | 中间结果 / 最终结果。只有 final 才进入目标解析。                      |
| 目标解析        | target resolution | 把识别文本对应到具体 `uavCode` 的过程。解析不出来就**报歧义，不猜**。 |
| 人工确认        | confirmation      | 操作员对解析结果的显式点击。**ASR 永远不能直接下发指令。**            |

原始音频只在内存中存在，识别结束/超时/断线立即清除。**不落盘、不入库、不进日志。**

---

## 命名约定

- 数据库列 `snake_case`，Java 记录与 API 字段 `camelCase`，TypeScript `camelCase`。
- 状态值一律**大写下划线**（`IN_PROGRESS`），前端不做本地化拼接，走 `lib/i18n-product.ts`。
- 时间字段以 `At` 结尾（`createdAt`、`observedAt`）；时长以单位结尾（`accessMinutes`、`refreshDays`）。
- 布尔字段用 `is` / `has` / `in` 前缀（`isDefault`、`inHibernatePod`）。
