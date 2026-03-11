LightMonitor 部署包使用说明
================================

本压缩包包含 LightMonitor 数据库监控工具的运行文件，不包含 node_modules。
首次启动会自动安装生产依赖（需要可用的 npm 与网络访问）。

前提条件
--------
目标机器必须安装 Node.js (建议 v16 或更高版本)。
如果未安装，请先下载并安装 Node.js: https://nodejs.org/

安装与运行
----------
1. 解压本压缩包到任意目录（例如 D:\LightMonitor）。
2. 进入解压后的目录。
3. 运行启动脚本：
   - 方式一（推荐）：双击运行 `scripts\start.ps1` (如果系统支持)。
   - 方式二：打开 PowerShell 或 CMD，进入目录，运行：
     npm start
     或者
     node server/index.js

4. 服务启动后，打开浏览器访问：
   http://localhost:8080
   (如果修改了端口，请使用相应的端口)

配置
----
默认端口为 8080。
可以通过设置环境变量 PORT 来修改端口。
例如在 PowerShell 中：
$env:PORT=9090
node server/index.js

常见问题
--------
Q: 启动时提示缺少模块？
A: 首次启动会自动执行 `npm i --omit=dev` 安装依赖，请确保目标机器可联网并可访问 npm registry。

Q: 页面显示空白？
A: 请确保使用现代浏览器（Chrome, Edge, Firefox 等）。
