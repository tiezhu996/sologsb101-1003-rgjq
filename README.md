# 电梯维保工序与困人救援台账（sologsb101-1003 / gbelevsvc）

## 一、Docker 一键启动（推荐）

```bash
cd sologsb101-1003
cp .env.example .env
docker compose up -d --build
```

启动后访问：**http://localhost:22803**

停止与清理：

```bash
docker compose down          # 停止并删除容器
docker compose up -d --build # 代码改动后重建
```

## 二、项目简介

面向电梯维保公司的保养班组与安全管理员，按 **半月 / 季度 / 年度** 三类周期为每台电梯生成保养项并逐项签署，同时记录困人救援从报警到救出的完整时间线。

核心动作：

- 建立电梯与使用单位档案，按周期推算下次保养日期并给出提醒窗口
- 按周期批量生成保养计划、指派执行人、跟踪逾期
- 逐项填写实测值与结果（正常 / 异常 / 建议）并签署，签署时校验未填项
- 异常项一键转年检整改单，复核通过后关闭
- 录入困人救援的报警 / 到场 / 救出时间，自动计算到场与救援时长并按 30 分钟到场要求判定
- 整库 JSON 导出 / 导入与 IndexedDB 结构版本查看

本项目为**纯前端单页应用**：无后端、无数据库服务、无外部接口，全部数据保存在浏览器 IndexedDB。

## 三、技术栈

| 分类 | 选型 | 版本 |
| --- | --- | --- |
| 框架 | Vue | 3.5 |
| 语言 | TypeScript | 5.7 |
| UI 组件库 | Naive UI | 2.40 |
| 构建工具 | Vite | 5.4 |
| 状态管理 | Pinia | 2.3 |
| 路由 | Vue Router | 4.5 |
| 本地持久化 | Dexie（IndexedDB） | 4.0 |
| 容器 | 多阶段构建 node:20-alpine → nginx:alpine | — |

## 四、路由一览

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/elevators` | 电梯档案 | 建立电梯与使用单位档案，按单位与周期筛选 |
| `/plans` | 保养计划 | 按周期批量生成、指派执行人、查看逾期 |
| `/plans/:id/items` | 保养执行 | 逐项填写实测值与结果并签署，异常转整改 |
| `/rescues` | 困人救援时间线 | 录入报警 / 到场 / 救出时间并自动算时长 |
| `/rectifies` | 年检整改与预警 | 整改单跟踪、超期预警与版本 / JSON 管理 |

> 路由使用 history 模式（`createWebHistory`），与 nginx 的 `try_files $uri $uri/ /index.html` 配合，直接访问上述深链接（含刷新）都能命中对应页面。

## 五、目录结构

```
sologsb101-1003/
├── README.md
├── docker-compose.yml           # 顶层 name: gbelevsvc，无 version 字段
├── .env / .env.example          # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── .gitignore
└── frontend/
    ├── Dockerfile               # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf               # try_files 前端路由回退 + gzip
    ├── .dockerignore
    ├── package.json / tsconfig.json / tsconfig.node.json
    ├── vite.config.ts / index.html
    ├── public/favicon.svg
    └── src/
        ├── main.ts              # 入口：createApp + Pinia + Router
        ├── App.vue              # 主题与全局消息容器
        ├── AppLayout.vue        # 应用外壳（侧边导航 + 当前电梯上下文）
        ├── env.d.ts
        ├── styles/main.css
        ├── types/               # elevator.ts plan.ts checkItem.ts rescue.ts rectify.ts persistence.ts
        ├── stores/              # elevatorStore.ts planStore.ts checkStore.ts rescueStore.ts rectifyStore.ts
        ├── components/common/   # StateTag.vue FilterBar.vue StatBadge.vue EmptyPanel.vue
        ├── hooks/               # usePlanProgress.ts useIdbTable.ts
        ├── pages/               # ElevatorList.vue PlanList.vue PlanExecute.vue RescueTimeline.vue RectifyList.vue
        ├── router/index.ts
        └── utils/               # duration.ts cycle.ts db.ts export.ts events.ts
```

## 六、数据存储说明

- **存储介质**：浏览器 IndexedDB，库名 **`gbelevsvc`**，通过 Dexie 4.x 封装。
- **数据结构版本**：`utils/db.ts` 中 `DB_SCHEMA_VERSION = 2`，并登记 v1 → v2 的 `upgrade` 迁移（补齐行修订号、迁移 `executorName → executor`、初始化保养项结果字段、新增 `settings` 表）。
- **数据表**：

  | 表名 | 实体 | 主要索引 |
  | --- | --- | --- |
  | `elevators` | 电梯 | id / regCode / owner / maintCycle / useDate |
  | `plans` | 保养计划 | id / elevatorId / cycleType / state / planDate / executor / [elevatorId+planDate] |
  | `checkItems` | 保养项 | id / planId / seq / result / itemName / [planId+seq] |
  | `rescues` | 困人事件 | id / elevatorId / alarmAt / responder |
  | `rectifies` | 整改单 | id / elevatorId / state / dueDate / reviewer |
  | `settings` | 自定义字典 | id |

- **首屏自动播种**：`initDatabase()` 在 `elevators` 表为空时写入演示数据（幂等）——3 台电梯 × 各 2~4 期计划 × 每期 5~10 个保养项（含异常 / 建议项）+ 3 起困人事件 + 5 条整改单，父子记录通过 `elevatorId / planId` 互相引用。
- **跨页状态**：全部放在 Pinia store（`elevatorStore / planStore / checkStore / rescueStore / rectifyStore`），页面只读 store；Dexie 写入后由 `utils/events.ts` 广播，各 store 自动重新拉取。
- **数据不出浏览器**：容器无状态，不挂载卷、不使用数据库服务。

## 七、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:22803
npm run typecheck  # vue-tsc --noEmit
npm run build      # vue-tsc --noEmit && vite build
npm run preview    # 预览构建产物
```

## 八、容器化细节

- `Dockerfile` 两阶段构建：`node:20-alpine` 安装依赖并执行 `npm run build`（内含 `vue-tsc` 类型检查），随后拷贝 `dist` 到 `nginx:alpine`。
- 运行阶段在 `COPY --from=builder /app/dist /usr/share/nginx/html` 之后执行 `RUN chmod -R a+rX /usr/share/nginx/html`，规避历史遗留的 favicon 权限 0600 导致 nginx 403 的问题。
- `nginx.conf` 使用 `try_files $uri $uri/ /index.html;` 支持前端路由直接刷新，并开启 gzip。
- `docker-compose.yml` 不写 `version:`，顶层 `name: gbelevsvc` 兜底（避免中文目录名导致项目名为空），服务名 `frontend`，容器名 `${COMPOSE_PROJECT_NAME:-gbelevsvc}-frontend`，端口 `${FRONTEND_PORT:-22803}:80`，`restart: unless-stopped`。
