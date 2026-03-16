# LightMonitor 架构评审与改进建议（面向 500 目标 / 30 天保留）

日期：2026-03-12  
适用场景：DBA 内部使用（约 10 人）、不对外暴露、监控目标约 500、指标保留期 30 天

## 1. 现状概览

### 1.1 系统形态

当前系统为单体 Node.js 进程，集成以下职责：
- HTTP API（监控目标管理、指标查询、诊断接口）
- 静态资源托管（前端构建产物由后端直接提供）
- 定时采集（轮询目标库并写入本地 SQLite）
- 定时清理（按保留期清理历史 metrics，并做 WAL truncate）

关键实现位置：
- 服务入口与定时任务：[index.js](file:///e:/LightMonitor-1/server/index.js#L1-L485)
- 采集调度（按目标遍历 + 防重入）：[poller.js](file:///e:/LightMonitor-1/server/poller.js#L1-L37)
- 本地持久化（SQLite WAL + metrics/targets/system_config）：[store.js](file:///e:/LightMonitor-1/server/store.js#L1-L117)
- 部署与目录约定（data/logs 持久化）：[DEPLOY_PROD.md](file:///e:/LightMonitor-1/docs/DEPLOY_PROD.md#L14-L22)

### 1.2 前端信息架构（页面布局）

- 顶层布局：侧边栏 + 主区；列表/详情二选一渲染：[App.vue](file:///e:/LightMonitor-1/src/App.vue#L1-L62)、[SidebarLayout.vue](file:///e:/LightMonitor-1/src/layouts/SidebarLayout.vue#L1-L50)
- 列表页：Overview/MySQL/MSSQL/Oracle 复用 TargetsTable，支持关键字过滤与树形分组：[OverviewList.vue](file:///e:/LightMonitor-1/src/views/OverviewList.vue#L1-L64)
- 详情页：DetailLayout 负责面包屑、时间范围、自动刷新；具体 KPI/趋势/诊断由各 DB Panel 承担：[DetailLayout.vue](file:///e:/LightMonitor-1/src/views/DetailLayout.vue#L1-L262)

## 2. 合理性结论（在目标场景下）

### 2.1 合理的部分（适合工具型内网监控）

- “无代理 + 仅需 DB 账号”降低部署门槛，适合 DBA 团队快速落地
- 前后端一体交付，运维成本低（单进程、单端口、单文件 DB）
- connectors 按数据库类型分离，具备扩展空间：[server/connectors](file:///e:/LightMonitor-1/server/connectors)

### 2.2 不合理的部分（500 目标 / 30 天保留会触发上限）

核心问题集中在“采集并发模型 + 存储策略 + 安全边界”：

1) 采集并发模型不可控（易形成并发风暴）
- 默认采集间隔为 5 秒（环境变量 SAMPLE_MS，默认 5000）：[index.js](file:///e:/LightMonitor-1/server/index.js#L446-L449)
- 每个周期遍历所有 targets，并为每个目标发起一次异步采集；仅用 inFlight 防止单目标重入，但没有全局并发上限：[poller.js](file:///e:/LightMonitor-1/server/poller.js#L1-L34)

2) “全量明细 30 天保留”导致容量与查询不可持续
- 以 500 目标、5 秒采集、30 天保留估算：行数约 2.592 亿（metrics 单表）
- SQLite 同步读写（better-sqlite3）对事件循环阻塞敏感，仓库已有“全站一起慢”的复盘记录：[PERF_RCA_2026-03.md](file:///e:/LightMonitor-1/docs/PERF_RCA_2026-03.md#L17-L29)

3) 安全默认值过于宽松（虽不对外，但内网仍需边界）
- API 无认证/鉴权，且 CORS 允许任意来源（*）：[index.js](file:///e:/LightMonitor-1/server/index.js#L14-L21)
- 监控目标凭据落盘在 targets 表（password 字段）：[store.js](file:///e:/LightMonitor-1/server/store.js#L57-L72)

4) 前端大列表体验与性能边界尚未显式设计
- 列表侧主要依赖前端过滤与树形组装（500 目标可用，但缺少分页/虚拟滚动等可控策略）：[OverviewList.vue](file:///e:/LightMonitor-1/src/views/OverviewList.vue#L1-L64)
- 趋势查询在大范围与高频刷新组合下，容易触发后端同步查询阻塞（与第 2 点叠加）

## 3. 改进建议（分级，尽量保持“轻量工具”定位）

### P0（必须）：稳定性与容量“先止血”

1) 采集：引入全局并发上限 + 错峰（jitter）
- 建议加一个全局并发限制（例如 20~50），并将 500 目标分片到周期内执行，避免同一秒同时打到 500 个被监控库
- 目标：防止 Node 事件循环被瞬时 I/O 回调压垮，也避免被监控库被“监控风暴”打穿

2) 采集频率：默认从 5 秒提升至 30~60 秒
- 500 目标的基线策略建议以 60 秒采集为默认，5 秒作为“单目标临时加速”而非全局默认
- 配置入口：SAMPLE_MS：[index.js](file:///e:/LightMonitor-1/server/index.js#L446-L449)

3) 存储：明细短留 + 聚合长留（Downsampling）
- 建议将存储分为两层：
  - 明细层（raw）：保留 3~7 天用于问题追溯
  - 聚合层（1m 或 5m）：保留 30 天用于趋势展示
- UI 查询 30 天趋势应走聚合层，避免扫描海量明细

4) 查询：为 metrics/诊断接口加硬上限与短缓存
- metrics 查询强制限制 maxPoints、range 上限；对相同参数的重复请求做 3~5 秒短缓存（提升体验并减少同步查询次数）
- 诊断接口（locks/slow/explain 等）建议按需加载 + 节流，避免频繁重查询拖慢主服务

### P1（必须）：安全与运维可控性

1) 内网不对外仍应启用最小认证
- 建议支持至少一种轻量方式：API_TOKEN / Basic Auth / 反向代理统一认证（任选其一即可）
- 同步收紧 CORS 为白名单或同源策略（默认不放开 *）

2) 目标库凭据治理
- 建议提供以下能力的组合（按复杂度递进）：
  - 支持“不落盘密码”（运行期输入/环境注入）
  - 或使用 OS 密钥进行加密落盘（Windows DPAPI / Linux keyring）
  - 明确数据目录权限与备份加密要求（data/monitor.db 一旦泄露即泄露全部目标库账号）

3) 运维闭环：健康检查与自监控指标
- 增加 /healthz（进程、DB 可写、采集延迟）
- 输出关键运维指标：采集成功率、采集耗时分布、队列堆积、db 大小/wal 大小、最后一次清理时间

### P2（建议）：前端体验与代码可维护性

1) 大列表体验（500 目标基线）
- 建议为 TargetsTable 增加分页或虚拟滚动；默认按 business_system 分组并折叠，减少一次渲染与扫描成本

2) 后端可维护性
- 将 API 路由按域拆分模块（targets/metrics/diagnostics/maintenance），入口仅负责注册，降低 [index.js](file:///e:/LightMonitor-1/server/index.js#L1-L485) 分支膨胀风险
- 对齐里程碑讨论中的模块化方向：[MILESTONE_DISCUSSION_2026-03-12.md](file:///e:/LightMonitor-1/docs/MILESTONE_DISCUSSION_2026-03-12.md#L39-L53)

3) 离线交付一致性
- 当前离线包说明“首次启动会联网安装依赖”，在多数 DBA 内网环境不成立：[README_OFFLINE.txt](file:///e:/LightMonitor-1/README_OFFLINE.txt#L4-L6)
- 建议提供真正离线包（包含 node_modules 或提供私有源/缓存与校验指引）

## 4. 推荐的“目标态”（保持轻量、能跑得住）

在不引入外部时序数据库的前提下，推荐目标态为：
- 单体服务保留（降低运维复杂度）
- 采集侧具备全局并发与错峰
- 存储侧具备 raw + 聚合两层
- 查询侧具备边界（限流/上限/缓存）
- 安全侧具备最小认证与凭据治理

## 5. 决策清单（建议在评审中确认）

- D1：采集默认间隔（推荐：60s；是否允许单目标临时提升）
- D2：明细保留天数（推荐：3~7 天）与聚合粒度（推荐：1m 或 5m）
- D3：认证方案（推荐：反向代理统一认证；备选：API_TOKEN）
- D4：离线交付方式（是否打包 node_modules / 是否提供内网 npm 源）
- D5：前端列表策略（分页 vs 虚拟滚动 vs 分组折叠为主）

## 6. 建议的行动顺序（明天继续做的切入点）

建议优先顺序（以风险与 ROI 排序）：
1) 采集并发上限 + 错峰
2) 采集默认间隔调整（SAMPLE_MS）
3) metrics 查询上限 + 短缓存
4) 明细短留 + 聚合长留（数据模型与查询路由）
5) 最小认证 + CORS 收敛 + 凭据治理
6) 前端列表分页/虚拟滚动与分组默认视图优化

