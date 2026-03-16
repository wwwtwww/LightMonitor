# LightMonitor 讨论纪要 / 决策清单（里程碑）

日期：2026-03-12  
主题：无代理数据库监控的详情页信息架构、扩展策略与性能路线（结合 Oracle 迭代）

## 1. 背景与目标

LightMonitor 定位为无代理（仅 DB 账号）数据库监控。近期围绕 Oracle 详情页进行能力补齐与页面结构优化，并同步复盘了项目维护性、扩展性与性能风险。

本里程碑文档用于沉淀团队共识：
- 统一详情页的信息层级，减少重复与误解
- 明确“无代理”边界与产品表达
- 形成可执行的架构/性能演进路线，避免高风险改动与低 ROI 优化

## 2. 共识（已对齐）

### 2.1 “Latest vs Trend”的信息分层

同一指标允许在“数值区”和“图表区”同时出现，但必须表达不同维度：
- KPI（Latest Snapshot）：回答“现在是多少/是否越线”
- Trend（趋势图）：回答“什么时候开始/波动幅度/持续性”，展示 Max/Min/Avg

### 2.2 无代理边界明确

项目不做 agent 采集，主机 CPU/内存/磁盘/网络不作为详情页的常规内容出现；统一使用“无代理模式说明”替代 N/A 占位，避免噪音与误导。

### 2.3 数据模型的分层策略

为避免 JSON 查询与后续告警/筛选受限，采用“高频 KPI 入列 + 结构化明细走 JSON/专项接口”的组合策略：
- 高频 KPI：落到 metrics 表独立列（可直接筛选、趋势、告警）
- 结构化明细：放 extra_data 或通过按需接口获取（如 locks/capacity）

相关参考：
- metrics 表结构：`server/store.js`
- Oracle connector：`server/connectors/oracle.js`

## 3. 关键讨论结论（对齐 GEMINI / GPT 观点）

### 3.1 路由与模块化（可维护性）

现状：后端 API 分发集中在 `server/index.js` 的 handleApi，分支不断增长。  
结论：无需引入大型框架也应拆分路由模块（按 targets/metrics/mysql/oracle/mssql/maintenance），入口仅做聚合注册，提高可读性与可测试性。

### 3.2 详情页 KPI 的归属（扩展性）

现状：`src/views/DetailLayout.vue` 仍存在按 db_type 分支渲染 KPI 的逻辑（尤其 MSSQL）。  
结论：详情页容器应只负责“壳”（面包屑、时间范围、自动刷新、选中目标），KPI+趋势+诊断统一下沉到各数据库 Panel（MysqlPanel/SqlServerPanel/OraclePanel），减少跨库耦合。

### 3.3 性能路线（优先级）

复盘：曾出现“全站一起慢”，根因是 SQLite 同步查询阻塞事件循环（详见 `docs/PERF_RCA_2026-03.md`）。  
结论：前端可见性优化（如 IntersectionObserver）属于锦上添花；优先推进后端查询与请求策略优化（增量、缓存、按需加载），收益更大且更贴合已知风险。

## 4. 决策清单（需在会议/评审中确认）

### D1. 详情页 KPI 归属
- 选项 A（推荐）：KPI 全部下沉到各 Panel；DetailLayout 只保留通用壳
- 选项 B：继续由 DetailLayout 统一渲染（将导致扩展成本随类型增加而上升）

### D2. 诊断数据的加载策略
- 选项 A（推荐）：Locks/Slow/Capacity 均“按 tab 激活再请求”，减少无效 IO
- 选项 B：详情页初始化时全部请求（高并发/多目标时风险更大）

### D3. UI 现代化路线
- 选项 A（推荐）：优先统一信息层级与组件规范（Latest/Trend/诊断），保持现有浅色基调
- 选项 B：启动全站暗色主题重构（需设计与持续投入，否则易半成品）

## 5. 行动清单（建议执行顺序）

优先级按照 ROI 与风险控制排序：

1) 面板化收敛
- 将 DetailLayout 中按类型分支的 KPI 逐步迁移到各 Panel
- 目标：新增数据库类型无需修改 DetailLayout

2) 性能与请求策略（对齐项目 TODO）
- locks/slow/capacity 按需加载
- metrics 增量拉取（基于 last timestamp），减少大范围同步查询
- 后端 3~5 秒短缓存（相同参数重复请求去重）
- 适当降低 maxPoints 默认值

参考：`TODO.md`

3) API 形态统一
- 统一专项接口返回结构（例如统一 `{ data: [...] }` 或 `{ waits: [...] }` 的一套规范）
- 统一错误码与“不可用/无权限/视图不存在”的返回语义，降低前端适配成本

## 6. 里程碑验收标准（Definition of Done）

- 详情页解释成本降低：用户可明确区分 Latest 与 Trend
- 无代理边界明确：不出现长期 N/A 的 Host Metrics 占位
- 扩展成本降低：新增/增强某一种 DB 类型的 KPI/诊断，无需改动通用容器（DetailLayout）
- 性能风险受控：高范围 metrics 请求不再拖慢轻接口（参照 PERF_RCA 的并发验证方法）

## 7. 补充：规模与运维评审（500 目标 / 30 天保留）

面向 DBA 内部使用、不对外暴露、约 500 目标、30 天保留的容量与运维评审建议已单独沉淀：
- [ARCH_REVIEW_2026-03-12.md](file:///e:/LightMonitor-1/docs/ARCH_REVIEW_2026-03-12.md)
