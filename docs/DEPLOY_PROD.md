# LightMonitor 生产部署文档

本文档用于将 LightMonitor 部署到生产机进行测试与运行。

## 1. 产物说明

当前已在本机生成发布包：
- `dist/LightMonitor-0.1.0.zip`：包含 `server/`、`public/`、`package.json` 以及 **node_modules**，适合“同操作系统/同CPU架构/同Node ABI”的机器直接解压运行。

重要说明：
- `better-sqlite3` 属于本地二进制依赖（native addon），`node_modules` **不可跨平台复用**。例如：在 Windows 打出来的包，直接拷到 Linux 上通常无法运行。
- 如果你的生产机与打包机操作系统不同，建议走“在线安装部署（推荐）”，在生产机上执行 `npm ci` 安装依赖。

## 2. 运行时目录与数据

LightMonitor 运行时会在项目根目录生成：
- `data/monitor.db`：SQLite 数据库（自动创建）
- `logs/`：日志目录（自动创建）

建议：
- 将 `data/` 与 `logs/` 放在持久化磁盘上，并纳入备份。

## 3. 环境要求

### 3.1 Node.js
- 推荐 Node.js 18 LTS 或以上（更佳兼容性）
- 即使使用离线包（已带 node_modules），生产机也必须安装 Node.js 运行时；否则会出现 “npm 不是内部或外部命令” 或 “node 不是内部或外部命令”

### 3.2 端口
- 默认监听 `8080`（可通过环境变量 `PORT` 修改）

## 4. 部署方式 A：在线安装部署（推荐，跨平台）

适用于 Linux/Windows，依赖在目标机安装，最稳妥。

### 4.1 上传源码

将整个项目目录上传到生产机（或从仓库拉取）。

目录要求：
- 保留 `server/`、`src/`、`package.json`、`package-lock.json`

### 4.2 安装依赖

在项目根目录执行：

```bash
npm ci
```

如果生产机不需要前端构建工具长期驻留，可使用：

```bash
npm ci --omit=dev
```

但注意：`npm run build` 需要 devDependencies（vite）。如果要在生产机构建前端，请不要 `--omit=dev`，或者在构建完成后再做精简。

### 4.3 构建前端

```bash
npm run build
```

构建产物会输出到 `public/`，后端会直接用静态文件方式提供页面。

### 4.4 启动服务

```bash
npm run start
```

访问：
- `http://<生产机IP>:8080/`

## 5. 部署方式 B：使用离线包（同平台快速测试）

适用于生产机与打包机同平台（例如都是 Windows x64）。

### 5.1 上传并解压

上传 `dist/LightMonitor-0.1.0.zip` 到生产机并解压：

```bash
unzip LightMonitor-0.1.0.zip -d LightMonitor
cd LightMonitor
```

### 5.2 启动

不依赖 npm 的启动方式（推荐）：

Windows（CMD）：

```bat
scripts\start.cmd
```

Windows（PowerShell）：

PowerShell 下执行脚本需要带 `.\` 前缀（否则会提示“不是内部或外部命令”）：

```powershell
.\scripts\start.cmd
```

或使用 PowerShell 脚本：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

如果你已正确安装 Node.js，也可以直接：

```bash
node server/index.js
```

## 6. 环境变量配置

可通过环境变量进行运行参数调整：

- `PORT`：服务端口，默认 `8080`
- `SAMPLE_MS`：采样间隔（毫秒），默认 `5000`
- `RETAIN_HOURS`：指标保留小时数，默认 `168`（7天）
- `LIGHTMONITOR_DATA_DIR` / `DATA_DIR`：数据目录（用于保存既有监控目标与历史数据），默认使用程序目录下的 `data/`
- `LIGHTMONITOR_DB_PATH` / `DB_PATH`：直接指定 SQLite 数据库文件路径（优先级高于 DATA_DIR）
- `DB_MMAP_MB`：SQLite `mmap_size`（MB），默认 `512`

示例（Linux）：

```bash
export PORT=8080
export SAMPLE_MS=5000
export RETAIN_HOURS=168
npm run start
```

示例（Windows PowerShell）：

```powershell
$env:PORT="8080"
$env:SAMPLE_MS="5000"
$env:RETAIN_HOURS="168"
$env:LIGHTMONITOR_DATA_DIR="D:\LightMonitorData"
npm run start
```

## 7. Windows 升级（保留既有监控目标）

目标：升级程序文件，但 **不删除/不清空** 生产机上已经录入的监控目标（SQLite：`data/monitor.db`）。

推荐做法：把数据放到独立目录，然后升级时只替换程序目录。

### 7.1 一次性迁移数据到独立目录（推荐）

1) 停止 LightMonitor（如果你用任务计划/服务管理器，请先停止；如果是前台运行，直接关闭窗口）。

2) 备份当前数据库：

```bat
copy D:\LightMonitor-0.1.0\data\monitor.db D:\LightMonitorBackup\monitor.db.bak
```

3) 创建独立数据目录并迁移：

```bat
mkdir D:\LightMonitorData
copy D:\LightMonitor-0.1.0\data\monitor.db D:\LightMonitorData\monitor.db
```

4) 解压新版本到新目录（不要覆盖旧目录）：
- 例如：`D:\LightMonitor-0.1.1\`

5) 启动时指定数据目录（PowerShell 示例）：

```powershell
$env:LIGHTMONITOR_DATA_DIR="D:\LightMonitorData"
node .\server\index.js
```

启动时指定数据目录（Windows CMD 示例）：

```bat
set LIGHTMONITOR_DATA_DIR=D:\LightMonitorData
node server\index.js
```

此后升级到新版本时，只要继续使用同一个 `LIGHTMONITOR_DATA_DIR`，录入的监控目标就会保留。

### 7.2 快速升级（不迁移，直接覆盖也尽量安全）

如果你必须覆盖原目录，务必确保：
- 覆盖前先备份 `D:\LightMonitor-0.1.0\data\monitor.db`
- 解压工具不要选择“删除目标目录后再解压”的选项

建议仍优先使用 7.1 的方式，风险最低。

## 8. Linux systemd（可选）

创建服务文件 `/etc/systemd/system/lightmonitor.service`：

```ini
[Unit]
Description=LightMonitor
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/lightmonitor
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
Environment=PORT=8080
Environment=SAMPLE_MS=5000
Environment=RETAIN_HOURS=168

[Install]
WantedBy=multi-user.target
```

## 9. 性能问题记录

- 2026-03 全站卡顿根因与修复：[PERF_RCA_2026-03.md](file:///e:/LightMonitor-1/docs/PERF_RCA_2026-03.md)

启用与启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable lightmonitor
sudo systemctl start lightmonitor
sudo systemctl status lightmonitor
```

## 9. 升级与回滚建议

推荐采用“代码目录 + 数据目录”分离：
- `/opt/lightmonitor/releases/<version>/`：程序目录（可回滚）
- `/opt/lightmonitor/data/`：数据目录（持久化）
- `/opt/lightmonitor/logs/`：日志目录（持久化）

如需分离数据目录，可通过软链接方式：
- 将 `releases/<version>/data` 链接到 `/opt/lightmonitor/data`
- 将 `releases/<version>/logs` 链接到 `/opt/lightmonitor/logs`

## 10. 常见问题排查

- 页面 404：确认 `public/index.html` 与 `public/assets/` 存在；如使用方式A，请先 `npm run build`
- 依赖报错（better-sqlite3 / mysql2）：确认 Node 版本与操作系统架构匹配；跨平台部署请用方式A在目标机重新安装依赖
- 端口占用：修改 `PORT` 或释放占用端口

