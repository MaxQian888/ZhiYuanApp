# ZhiYuan Operations / 智鸢无人机运营平台

智鸢是面向 `admin` 与 `manager` 的无人机运营控制台，覆盖设备监控与控制、地图、语音指令、日志告警、休眠仓、用户地址、商品、订单、配送任务、员工账号、账户安全与更新检查。Web、响应式移动端和 Tauri 桌面端共享同一套功能与 API 契约。

界面遵循 Hallmark Workbench / Cobalt：全宽信息带、语义表格、发丝分隔线和行内展开；不使用卡片墙、渐变、玻璃或阴影容器。中文为默认语言，可在界面中切换英文。

## 技术栈

- Next.js 16 static export、React 19、TypeScript、Tailwind v4、TanStack Query、Zustand、Zod
- Tauri 2，Stronghold 加密保存桌面 refresh token，Updater 在配置 manifest/pubkey 后启用，并提供无边框窗口、单实例、窗口定位、状态恢复与系统信息
- Java 17、Spring Boot 4.0.2、MyBatis-Plus 3.5.17 Boot 4 starter、Flyway、MySQL
- Jest、MockMvc/JUnit、Playwright

## 本地启动

前置环境：Node.js 20+、pnpm 10+、JDK 17、Maven 3.9+、MySQL 8+；桌面构建还需 Rust 1.77.2+。

```bash
pnpm install
cp .env.example .env.local
docker compose up -d mysql
cd server && DB_USERNAME=zhiyuan DB_PASSWORD=zhiyuan-dev JAVA_HOME=/opt/homebrew/opt/openjdk@17 mvn spring-boot:run
cd .. && pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)，开发账号为 `admin / admin123` 或 `manager / admin123`。开发种子位于 `server/src/main/resources/db/dev`；生产必须设置 `FLYWAY_LOCATIONS=classpath:db/migration`，不会写入演示数据。

`.env.example` 默认连接 Spring API，使所有写操作进入数据库。仅在需要脱离后端预览界面时，才把 `NEXT_PUBLIC_API_MODE` 改为 `simulator`：

```dotenv
NEXT_PUBLIC_API_MODE=simulator
NEXT_PUBLIC_API_URL=http://localhost:8080
```

无人机适配器首版明确标识为 `SIMULATOR`。真实设备接入只需实现 `server/.../uav/UavAdapter`，不应绕过指令确认、状态机或审计层。

## 主要路由

`/` 首页；`/uavs` 与 `/uavs/detail?id=1` 设备；`/map` 地图；`/voice` 语音；`/alerts`、`/logs`、`/pods` 运维；`/users`、`/goods`、`/orders`、`/orders/detail?id=1`、`/tasks` 业务；`/settings` 账户。

所有路由均可静态导出；运行时数据直接请求 `/api/v1/**`，不依赖 Next Route Handler、Server Action 或未知动态参数。

审计日志通过 `/api/v1/logs` 在数据库侧完成类型、状态、设备与关键词过滤及分页，统一返回飞行、控制和语音记录。告警采用 `OPEN → ACKNOWLEDGED → RESOLVED` 生命周期，确认与解除分别记录员工及时间，不能跳过确认直接解除。

## 验证

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test --runInBand
pnpm build
pnpm exec playwright test
docker compose up -d mysql
pnpm test:e2e:remote # 真实 Spring + MySQL + HttpOnly Cookie 链路
cd server && JAVA_HOME=/opt/homebrew/opt/openjdk@17 mvn verify
cd ../src-tauri && cargo test
cd .. && pnpm tauri build
```

移动端验收宽度为 320、375、414、768 px，桌面补充 800×600 与 1440 px。更新服务未配置时，产品会明确显示“更新服务未配置”，不会伪报最新版本。

### 桌面窗口能力

- 主窗口采用保留阴影与边缘缩放的无边框布局；自定义标题栏支持拖拽、双击最大化、最小化、还原和关闭，Web/PWA 不渲染该标题栏。
- 进程保持单实例。重复启动会恢复、显示并聚焦现有窗口，同时把启动参数和工作目录转交前端；`--route=/orders` 形式的受信站内路由会直接打开对应页面，外部 URL 会被拒绝。
- 窗口尺寸、位置、最大化、可见性和全屏状态会自动持久化；装饰模式始终由应用配置固定为无边框。设置页可立即保存或恢复，并可把窗口定位到当前显示器的九个标准位置。
- 设置页通过 OS Information 插件显示系统类型、版本、家族、架构、系统语言和可执行扩展名。主机名权限保持关闭，避免无必要暴露设备标识。
- `positioner`、`single-instance` 和 `window-state` 仅编译进 macOS、Windows、Linux；移动端与 Web 构建不调用这些桌面 API。

## 安全与生产配置

- Web refresh token 只通过 `HttpOnly` cookie 使用；access token 仅驻留内存。Tauri 使用 Stronghold，并通过 `X-Refresh-Token` 完成轮换。
- 必须替换 `JWT_SECRET`，精确设置 `CORS_ORIGINS`，为 MySQL 使用非 root 账号并启用 TLS。
- `admin` 可执行全部操作；`manager` 可监控、控制与处理订单任务，但不能管理管理员、删除主数据或修改安全配置。
- updater 需要在 `src-tauri/tauri.conf.json` 配置签名后的 endpoints/pubkey；未配置时保持禁用。
- 桌面端发现已签名的新版本后可直接下载并安装，并显示真实下载进度；Web 端只读取后端版本状态。
- Remote 模式不会在接口加载失败时回退到演示数据；顶部同步带会列出失败模块并提供原位重试。

API、部署和配置说明也可运行 `pnpm docs:dev` 后在 [http://localhost:3001](http://localhost:3001) 查看。
