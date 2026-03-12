# 性能问题根因记录（2026-03）

## 现象

- 页面卡顿、接口偶发超时，表现为“全站一起慢”
- 慢点出现时，即使是很轻量的接口（例如 `/api/maintenance/config`）也会超时

## 复现与定位

- 主要慢点集中在：`GET /api/databases/:id/metrics`
  - 典型表现：`range=6h`、`range=24h` 请求耗时很长甚至超时
- 并发验证方法：
  - 发起一个慢的 `/api/databases/:id/metrics?range=24h&maxPoints=720` 请求
  - 同时请求 `/api/maintenance/config`
  - 若后者也被拖慢/超时，说明进程被同步任务阻塞（事件循环卡住），不是单接口慢

结论：问题不是“采集频率/清理任务”单独导致，而是 metrics 查询在 Node 进程内同步执行且耗时过长，导致事件循环阻塞，从而拖慢全部接口。

## 根因

- 后端使用 `better-sqlite3`，SQLite 查询为同步执行
- `rangeMetrics()` 的下采样 SQL 采用“分桶聚合 + join 回表取整行”的模式，容易触发大量随机回表读取
- 当 `metrics` 表数据量增大、磁盘/缓存命中变差时，该查询会变得极慢，并同步阻塞整个 Node 进程

## 修复措施

- 将 `rangeMetrics()` 下采样改为窗口函数一次扫描选取每桶最新一条，减少随机回表与 IO 开销
  - 如运行环境 SQLite 不支持窗口函数，自动回退到旧 SQL（兼容）
- 启用 SQLite `mmap_size`（默认 512MB，可通过 `DB_MMAP_MB` 调整）以降低随机读成本

## 防回归建议

- 排查“全站一起慢”优先验证是否存在同步阻塞：
  - 并发发起一个重接口（例如大范围 `/metrics`）+ 一个轻接口（例如 `/maintenance/config`）
  - 轻接口被拖慢说明是同步阻塞，优先检查 SQLite 同步查询、文件 IO、CPU 密集逻辑
- 线上压测建议保留一套固定脚本，记录：
  - `/metrics` 不同范围（1h/6h/24h）的 p50/p95/p99
  - 并发时轻接口是否还能稳定返回

## 相关配置

- `DB_MMAP_MB`：SQLite `mmap_size` 的 MB 值（默认 512）
