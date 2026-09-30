# 活动配电负载排演（Power Load Rehearsal）

可**本地一键部署**的活动配电负载排演网站：录入「配电箱 → 配电柜 → 末级回路」的树状结构、
各回路额定功率，以及设备功率、接入回路和运行时段；页面按时间轴显示每个回路的实时负载与
**超限区间**。设备改接回路必须**先预演、再确认**，预演后配置一旦变化，确认立即失效。

- 后端：Node.js + Express
- 前端：React 18 + Vite（生产构建由 Express 直接托管，单端口对外）
- 数据库：SQLite（`better-sqlite3`，文件存储，开箱即用，无需外部数据库）

---

## 一、快速启动（推荐：Docker Compose）

前置条件：已安装 Docker 与 Docker Compose Plugin（`docker compose version` 可用）。

```bash
cd <项目目录>
docker compose up -d --build
```

首次启动会自动完成：

1. 构建前端静态资源；
2. 安装后端依赖（含 better-sqlite3）；
3. 初始化 SQLite，自动建表；
4. 当数据库为空时，写入一套**演示数据**（一个配电箱、两个柜、六条末级回路、八台设备）。

访问地址：

- **http://localhost:8080**

如本机 8080 端口被占用，可改用其他宿主机端口：

```bash
APP_PORT=18080 docker compose up -d --build
# 然后访问 http://localhost:18080
```

或直接修改 `docker-compose.yml` 中 `ports` 左边的宿主机端口。

常用命令：

```bash
docker compose logs -f       # 查看日志
docker compose restart app   # 重启
docker compose down          # 停止（数据保留在命名卷中）
docker compose down -v       # 停止并删除数据卷（等于清空全部配置）
```

健康检查：`GET http://localhost:8080/api/health`。

---

## 二、不用 Docker，直接用 Node.js 运行

要求 Node.js ≥ 20（自带 npm）。

```bash
# 1) 安装后端依赖
npm install

# 2) 构建前端（产物输出到 web/dist，由 Express 托管）
npm run build:web

# 3) 启动（首次自动建表 + 演示数据）
npm start
```

访问 **http://localhost:8080**。

开发模式（前端热更新，:5173 自动代理 /api 到 :8080）：

```bash
npm run dev:server     # 终端1：后端 http://localhost:8080
npm run dev:web        # 终端2：前端 http://localhost:5173
```

端到端冒烟测试（先启动服务，再执行；会创建并清理临时数据）：

```bash
npm run test:smoke
```

---

## 三、配置项（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | HTTP 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `SQLITE_PATH` | `./data/app.db`（本地）/ `/app/data/app.db`（容器） | SQLite 数据库文件路径，目录会自动创建 |
| `APP_PORT` | `8080` | **仅 Compose 使用**：宿主机映射端口 |

可选：复制 `.env.example` 为 `.env` 后按需修改（`docker compose` 会自动读取）。

数据存放：

- Docker：命名卷 `power-sqlite-data` → 容器内 `/app/data`；
- 本地 Node：项目根目录 `./data/app.db`（删除该文件即恢复初始演示数据）。

---

## 四、业务规则（与实现一一对应）

1. **树结构**：回路通过「上级回路」构成树，顶层即配电箱。环路会被明确拒绝
   （`CIRCULAR_TREE`：不能把回路挂到自身或自己的后代下）。
2. **上级负载汇总**：任一回路的负载 = 接入其**自身或任意后代回路**且当前处于运行时段内的
   **全部设备功率之和**。
3. **时段语义**：统一为**左闭右开** `[start, end)`，且要求**起点严格早于终点**
   （`start < end`）；终点时刻设备即视为停止。
4. **同设备重叠只计一次**：同一设备的多个运行时段先做**并集**再参与汇总，
   因此重叠时段绝不会把该设备功率重复累加（不同设备的重叠当然各自计入）。
5. **超限检测**：某回路在某时段负载严格大于额定功率（`load > rated`）即为超限，
   页面红色区间标出，API 返回每段的起、止、峰值与运行设备清单。
6. **设备改接：先预演，后确认**
   - `POST /api/moves` 预演：**不改动任何配置**，按「设备已挂到目标回路」的虚拟配置重算；
   - 只要**任一祖先回路在任一时段超额**，整次改接即被拒绝，响应中逐条给出
     **回路、超额时段、峰值（及运行设备）**；
   - 预演通过后才能 `POST /api/moves/:token/confirm` 落库；
   - 预演结果带**配置版本号**；预演之后任何回路/设备/时段变化都会推进版本，
     旧 token 确认时返回 `REHEARSAL_STALE`，必须重新预演；
   - 预演一次性、目标回路变更也必须重新预演；不允许通过普通设备编辑接口绕过预演直接改接。
7. **明确报错 & 不留半成品**：环路、缺失回路、非正功率、非法时段等都返回结构化中文错误
   （`{error:{code,message,details}}`）；所有写操作在数据库事务中执行，失败整体回滚，
   不会留下部分配置。删除仍有下级回路或挂接设备的回路会被拒绝。

---

## 五、页面使用

- **左上「回路树」**：查看层级、额定功率与各回路峰值占用率（绿 <80%、黄 80–100%、红超限）；
  树内可新增子回路、在该回路接入设备、编辑、删除。
- **「设备」页签**：设备卡片展示功率、接入回路与全部运行时段，可编辑/删除/**改接**。
- **右侧负载时间轴**：每个回路一张阶梯图——蓝区为负载、红带为超限区间、黄色虚线为额定功率；
  鼠标悬停查看该时段负载与正在运行的设备；下方红色标签列出全部超限时段与峰值。
  顶部可自定义观察时间窗口（起点/终点），「重置」恢复为覆盖全部运行时段。
- **改接弹窗**：选择目标回路 →「预演」→ 通过（且未失效）后「确认改接」；
  不通过时列出所有超额回路/时段/峰值，并给出改接前后对比表与目标回路时间轴。

---

## 六、HTTP API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/circuits` | 回路树（含 `configVersion`） |
| POST | `/api/circuits` | 新增回路 `{name, ratedKw, parentId?}` |
| PATCH | `/api/circuits/:id` | 修改名称/额定功率/上级（自动查环路） |
| DELETE | `/api/circuits/:id` | 删除（有下级或设备时拒绝） |
| GET | `/api/devices` | 设备列表（含运行时段） |
| POST | `/api/devices` | 新增 `{name, powerKw, circuitId, periods:[{start,end}]}` |
| PATCH | `/api/devices/:id` | 修改名称/功率/时段（**改接不走此接口**） |
| DELETE | `/api/devices/:id` | 删除设备及其时段 |
| GET | `/api/analysis?from=&to=` | 全回路时间线、峰值、超限区间（from/to 可省略） |
| POST | `/api/moves` | 创建改接预演 `{deviceId, targetCircuitId}` |
| GET | `/api/moves/:token` | 查询预演状态（含是否已失效） |
| DELETE | `/api/moves/:token` | 作废预演 |
| POST | `/api/moves/:token/confirm` | 确认改接（版本不一致/未通过则拒绝） |

时间字段接受 ISO 8601 字符串（如 `"2026-10-01T20:00"`，按浏览器本地时区解析）或毫秒时间戳。

错误响应统一形如：

```json
{ "error": { "code": "INVALID_PERIOD_RANGE", "message": "……", "details": { } } }
```

---

## 七、目录结构

```
.
├── Dockerfile                # 多阶段：构建前端 + 运行后端
├── docker-compose.yml        # 一键启动（命名卷持久化 SQLite）
├── .env.example
├── package.json              # 后端依赖与脚本
├── server/                   # Express + SQLite + 负载引擎
│   ├── server.js             # 入口（API + 托管 web/dist + SPA 回退）
│   ├── db.js                 # 建表/迁移/演示数据/配置版本
│   ├── load.js               # 扫描线负载引擎（祖先汇总、并集去重、超限分段）
│   ├── intervals.js          # 区间并集
│   ├── validation.js         # 入参校验（功率/时段/环路/缺失引用）
│   ├── repo.js               # 查询与事务封装
│   └── routes/               # circuits / devices / analysis / moves
├── scripts/smoke.js          # HTTP 端到端冒烟测试
└── web/                      # React + Vite 前端
    └── src/
        ├── App.jsx
        └── components/       # 回路树、设备列表、负载时间轴、改接预演弹窗等
```
