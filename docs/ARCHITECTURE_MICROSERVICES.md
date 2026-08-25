# 服务架构

> 后端由 **6 个代码单元、9 个部署单元**构成。本文定义它们各自的边界、通信方式与数据所有权。
> 每条约束的理由见 [`adr/`](adr/)；代码结构见 [`agents/project-structure-python.md`](agents/project-structure-python.md)；镜像构建见 [`agents/docker-build.md`](agents/docker-build.md)。

---

## 1. 划分服务的判据

一个东西配不配单独成为服务，看**四条运行时边界**。命中两条以上才拆：

| 判据 | 问的问题 |
|---|---|
| 网络位置 | 它必须部署在别的服务到不了的网段吗？ |
| 扩缩维度 | 它按什么扩？QPS / 连接数 / 硬件分片 / 队列深度 / CPU 核 |
| 故障爆炸半径 | 它挂掉或吃满内存时，不该拖累谁？ |
| 变更节奏 | 它的发布需要独立于其它部分吗？ |

**不构成拆分理由**：目录大、业务域不同、"看起来该独立"。按业务域拆出来的 CRUD 服务只会把一次进程内查询换成一次跨网络往返，外加一套迁移、CI、镜像与告警。

按判据逐项过一遍系统里的成分：

| 成分 | 网络位置 | 扩缩维度 | 爆炸半径 | 结论 |
|---|---|---|---|---|
| OPC UA 连接、订阅、采样、归档 | **工控网** | PLC 分片，单活 | 高：重复会话击穿 PLC 会话上限 | 独立服务 |
| 对上位系统暴露 opc.tcp 端点 | 独占宿主机端口段 | 不水平扩，单活 | 中：重启期间端点整体不可用 | 独立服务 |
| 报告渲染 / 台账重算回填 / 建模训练 / 3D 拆分 | 无 | 队列深度、CPU 核 | 高：OOM 拖垮 API | 独立进程角色 |
| 看板实时发布 | 无 | 活跃看板数 | 中 | 独立进程角色 |
| WebSocket 连接与扇出 | 无 | 连接数 | 中 | 独立服务 |
| 认证与授权判定 | 无 | QPS，且是全站前置 | 高：挂了全站不可用 | 独立服务 |
| 组态大屏 / 点位配置 / 台账 / 报告 / 素材的查询与 CRUD | 无 | QPS | 低 | 同一个无状态 API 服务 |

**代码单元 ≠ 部署单元**，这是本架构的核心。一个 `services/<svc>/` 目录可以按角色跑出多个进程，各有独立的扩缩策略与资源画像。扩缩与故障隔离在部署层解决，不必在代码层再切一刀。

---

## 2. 服务清单

### 2.1 代码单元（`server/services/*`，6 个）

| 服务 | 职责 | 对外前缀 | 端口 |
|---|---|---|---|
| `auth-server` | 认证、RBAC 权限判定、路由规则、边缘鉴权端点 `/verify` | `/api/v1/auth` | 8004 |
| `platform-server` | 组态大屏、点位配置、数据台账、报告、AI 建模、素材、运行参数 | `/api/v1/platform` | 8005 |
| `collector-server` | 连接 PLC、订阅、采样、写快照与历史 | 无业务面（仅探针） | 8007 |
| `opcua-server` | 对上位系统暴露 opc.tcp 端点，托管多个 OPC UA 服务器实例 | `/api/v1/opcua` | 8008 |
| `realtime-hub` | WebSocket 连接与订阅、服务→客户端扇出、通知 | `/api/v1/realtime` | 8000 |
| `ai-assistant` | 技能驱动的对话式助手：按页面装技能、点位召回、改画布的工具下发到浏览器 | `/api/v1/assistant` | 8006 |

### 2.2 部署单元（9 个）

| # | 部署单元 | 代码单元 | 角色 | 副本策略 |
|---|---|---|---|---|
| 1 | `edge-gateway` | `docker/nginx` | — | 边缘，1–2 |
| 2 | `auth-server` | auth-server | api | HPA（QPS） |
| 3 | `realtime-hub` | realtime-hub | hub | 按连接数 |
| 4 | `collector` | collector-server | leader | **单活 + 热备**（租约竞选，`replicas: 2`） |
| 5 | `opcua-server` | opcua-server | api | **单活无热备**（`replicas: 1`，端口独占，不做租约竞选，见 [ADR-0006](adr/0006-opcua服务端独立成代码单元.md)） |
| 6 | `platform-api` | platform-server | `api` | HPA（QPS），**完全无状态** |
| 7 | `platform-worker` | platform-server | `worker` | HPA（队列深度） |
| 8 | `platform-publisher` | platform-server | `publisher` | **单活**（租约） |
| 9 | `ai-assistant` | ai-assistant | api | HPA |
| — | `migrate` | 各服务 | one-shot | 部署前 Job |

`platform-publisher` 与 `platform-worker` 可以合成一个进程（`ROLE=worker,publisher`）省一份内存。一旦实测批任务的 CPU 抖动把推送延迟拉高就拆开——两者是同一镜像换启动参数，拆分成本接近零。

---

## 3. 各服务的边界

### 3.1 `edge-gateway`

唯一的入口。它做**且只做**：TLS 终结、按前缀反向代理、`auth_request` 前置鉴权（子请求打 auth-server 的 `/verify`）、公开面限流、前端静态资源发布、对象存储的只读代理。

它**不做**：业务逻辑、数据聚合、协议转换。任何需要读库才能回答的问题都不属于边缘。

### 3.2 `auth-server`

签发与校验令牌、维护用户与角色、维护权限码目录、维护路由规则表，并对边缘暴露 `/verify`。

`/verify` 的口径是硬约束：**先认证、再查规则**。"查不到权限码"绝不等于"匿名放行"——这条必须有专门的测试锁死（见 [`agents/testing-standard-python.md`](agents/testing-standard-python.md) §7.1）。

### 3.3 `collector-server`

它是唯一持有 PLC 连接的进程。职责：按采集计划建立与维持会话、订阅节点、接收数据变更、写实时快照（Redis）、写历史归档（TimescaleDB），并响应来自 platform 的地址空间浏览请求。

**它不认识大屏、不认识绑定、不认识台账**。它只认识"服务器端点 + 节点集合 + 采样参数"，也就是**采集计划**。

采集计划由 platform 下发（内部 API + Redis pub/sub 变更通知），collector 侧缓存。这是 collector 能被单独放到工控网侧机器上的前提——它对 platform 的数据库零依赖。

浏览 PLC 地址空间必须由持连接的进程执行，走命令总线 RPC：platform 发命令、collector 执行并回值。

### 3.4 `platform-server`

系统的业务主体，按 `apps/<feature>/` 分模块：`dashboard`（组态大屏与绑定）、`opcua`（点位服务器与节点配置）、`dataset`（数据台账与公式）、`report`（报告模板与渲染）、`modeling`（AI 建模流水线）、`asset`（素材）、`runtime_params`（运行参数）。

三种运行角色：

| 角色 | 跑什么 | 状态 |
|---|---|---|
| `api` | 全部 HTTP 路由 | 完全无状态，可任意扩缩 |
| `worker` | 队列消费：报告渲染与定时生成、台账聚合采集与重算回填、保留期清理、建模训练、3D 模型拆分、素材暂存 GC | 无全局单例，多副本各取各的任务 |
| `publisher` | 看板实时发布循环 | 全局单例，Redis 租约选主 |

**API 角色永不跑重任务**。发起训练或渲染的 HTTP 请求只做一件事：入队。CPU 密集的进程池只在 worker 角色里存在，否则 sklearn 的内存与 BLAS 线程会落进每一个 API 副本。

点位配置面（`apps/opcua`）留在 platform 而不是 collector：删除一个节点要检查"还有没有大屏绑着它"，构建实时计划要读绑定表，这两个问题的答案都在 platform 的表里。放在一起，这些是普通的进程内调用；分开，就要造一条反向 RPC。

### 3.5 `realtime-hub`

管理 WebSocket 连接与订阅关系，把其它服务推来的消息按订阅扇出给客户端。

**它不读任何业务表。** 它认识的是"连接、用户、主题、载荷"，不认识大屏、点位或台账。看板实时发布器因此不放在这里——那需要读绑定表并按绑定计划求值，会让通道服务重新长出业务知识。

对外只有两类接口：客户端的 WebSocket 端点（带鉴权），以及服务端的推送端点（服务级密钥，不是用户权限码——权限码挂在人身上，而这里要挡的正是"任何人"）。

### 3.6 `opcua-server`

对上位系统（SCADA、MES）暴露 `opc.tcp` 端点的**发布面**。方向与 `collector-server` 相反：那里本平台是 OPC UA 客户端，主动去连 PLC；这里本平台是 OPC UA 服务端，被上位机连。两者共用协议，不共用运行时，也不共用数据。

一期是纯人造数据：节点值由 `/api/v1/opcua` 管理面写入，上位机也可反向写值。**它不桥接内部点位**——把采集快照映射成 OPC UA 节点会让它依赖采集运行时，那条路留插件点不实现。

单进程内托管多个实例，每个实例一个 `opc.tcp` 端口，从固定端口池（默认 `4840`–`4859`）分配。**端口池是部署期常量**，由容器端口段映射决定，运行期开不出池外的新端口——池满即**响亮失败**，不许静默降级成一个"显示运行中但连不上"的实例。副本固定为 1 且不做租约竞选，理由见 [ADR-0006](adr/0006-opcua服务端独立成代码单元.md)。

**它的 `opc.tcp` 端口不经 edge-gateway。** 边缘只有 http block，转不了二进制 TCP；这段流量的安全完全由 OPC UA 自身的 SecurityPolicy 与身份令牌承担。只有 `/api/v1/opcua` 的 HTTP 管理面走边缘。

明确**不做**：OPC UA PubSub、GDS（全局发现服务）、Issued Token 身份令牌。

### 3.7 `ai-assistant`

对话式助手。它是**纯消费方**：经 HTTP 调 platform 取业务数据、调 auth 校验身份，不直连任何其它服务的数据库。

---

## 4. 代码结构

`server/` 分三层，依赖方向严格单向 `services → domain → lib`：

```
server/
├── lib/          ← 通用基础设施，零项目名词
├── domain/       ← 领域共享包，可含项目名词，不含 ORM 模型
└── services/     ← 可部署单元
```

`domain/*` 的入场券极窄：**必须已经有 ≥ 2 个服务真实消费它**。"将来可能共用"不构成理由——先放在使用它的那个服务里，第二个消费方出现时再抽。

初始只有两个包：

| 包 | 内容 | 消费方 |
|---|---|---|
| `domain/formula` | 台账公式的解析、求值、函数库、记法、上下文 | platform 的 `api` 与 `worker` 角色 |
| `domain/timeseries` | 点位历史宽表的 DDL 契约、值编解码、`node_key` 拆分口径 | collector（写）、platform（读） |

完整约束见 [ADR-0004](adr/0004-server分三层且domain承载领域共享包.md)，结构闸见 [`agents/project-structure-python.md`](agents/project-structure-python.md) §7。

---

## 5. 数据所有权

一个 database，每个服务独占一个 schema：

| schema | 内容 | 属主 |
|---|---|---|
| `auth` | 用户、角色、权限码、路由规则、API 密钥 | auth-server |
| `opcua` | 服务器实例、地址空间节点与类型、方法定义、实例凭据与信任证书 | opcua-server |
| `realtime` | 主题登记、用户订阅 | realtime-hub |
| `assistant` | 会话、消息、回合步骤 | ai-assistant |
| `platform` | 大屏、绑定、项目、模板、素材、点位配置、台账、报告、建模 | platform-server |
| `collect` | 点位历史、采集运行态 | collector-server |

口径是 **写独占、读放行**：一张表只有一个属主，只有属主能写、只有属主管迁移；跨 schema 只读允许，但要用独立的只读 DB role 授权，不靠自觉。

三条禁令保住将来分库的可能：**禁止跨 schema JOIN、禁止跨 schema 外键、禁止跨 schema 事务。** 做到这三条，任何一个 schema 都能整体搬到独立实例，只改连接串。

理由与例外见 [ADR-0003](adr/0003-一库多schema且写独占读放行.md)。

---

## 6. 跨服务通信

| 场景 | 机制 | 说明 |
|---|---|---|
| 客户端 → 任意服务 | HTTP，经 edge-gateway | 边缘统一鉴权，服务侧只读 `X-Auth-*` 头 |
| 边缘 → auth-server | `auth_request` 子请求 | 每个受保护请求一次，必须快 |
| platform → collector | 内部 HTTP（采集计划）+ Redis 命令总线（浏览 RPC） | collector 无业务 HTTP 面 |
| collector → platform | **无**（单向） | 采集结果经 Redis 快照与 `collect` schema 落地，platform 自取 |
| 任意服务 → 客户端 | HTTP 打 realtime-hub 推送端点 | 服务级密钥鉴权 |
| ai-assistant → platform | 内部 HTTP | 带调用方身份头 |
| 服务 → 自己的重任务 | Redis Stream + consumer group | 入队与消费分属 `api` 与 `worker` 角色 |

**不允许**的通信：任何服务直连另一个服务的 schema 做写入；任何两个服务之间的双向同步 RPC（会形成分布式死锁与循环等待）。

---

## 7. 部署形态

`collector` 与其余服务同集群。跨网段靠**宿主机多网卡**（外网 + 工控网），不靠服务拆分。由此产生两条硬约束：

- collector 必须**调度到有工控网卡的节点**：K8s 用 `nodeSelector`，compose 用固定宿主机。
- collector 的容器网络必须能路由到工控网段（host network、macvlan，或宿主机侧静态路由）。这是节点级配置，属部署前置条件，不是应用配置——写进部署手册，并在 collector 启动时做一次可达性自检，**连不通就响亮失败**，不要静默退化成一个连不上 PLC 的采集器。

`platform-worker` 需要单独一档资源画像（训练、渲染、几何处理都吃 CPU 与内存）。其余服务无特殊调度约束。

---

## 8. 建设顺序

依赖关系决定顺序，每一步结束都应当是可部署、可验证的：

1. **`server/` workspace 骨架**：`lib` 的配置、日志、异常、响应包封、DB 会话、Redis 客户端，加 `create_app()` 工厂与结构闸。此时没有任何业务。
2. **`auth-server` + `edge-gateway`**：鉴权链路是所有其它服务的前提。先跑通"匿名被拒、带 token 放行、权限码不足被拒"三条路径。
3. **`opcua-server`**：它自成闭环——纯人造数据，不依赖任何未建成的服务，单独跑通就有完整价值（上位机能连、能读、能写）。它同时就是第 6 步所需的那个**可控 OPC UA 假件**，采集链路不必再另造一个。
4. **`realtime-hub`**（先不带 `platform-publisher`）：hub 建成时需要一个真实推送方来趟通主题登记与推送端点，`opcua-server` 正是它的第一个消费方。跨服务耦合点靠假件验证不出来。
5. **`platform-server` 的 `api` 角色**，随后接上 `platform-publisher`：从点位配置与组态大屏两个模块起步，此时数据全部来自手工录入；发布器接上后大屏能收到变化。
6. **`collector-server`**：接上真实 PLC，采集计划下发 → 快照 → 历史归档。至此实时数据面完整。
7. **`platform-worker`**：队列骨架 + 台账聚合，再逐个接入报告渲染、建模、3D 拆分。
8. **`ai-assistant`**：它是纯消费方，最后接。

第 2 步之前不写任何业务代码，第 6 步之前不接真实 PLC——用第 3 步产出的那台可控 OPC UA 服务器把采集链路先验证完。

---

## 9. 什么情况下重新审视这份划分

按业务域进一步拆分（dashboard / dataset / report / modeling 各自独立）**不在计划内**：它们的查询与 CRUD 面共享领域模型，拆开只买到跨服务 JOIN。

`opcua-server` 的独立不属于此列：它划的是**网络形态**——对外开放非 HTTP 监听端口且必须单活，判据见 §1 与 [ADR-0006](adr/0006-opcua服务端独立成代码单元.md)。

满足以下任意两条时重新评估：

- 某个模块的发布被另一个模块堵住 ≥ 2 次；
- 团队分成了按域负责的独立小组；
- 某个模块的资源画像极端到必须单独调度；
- `platform-server` 的模块间 import 计数持续上升，白名单闸频繁被要求放宽。

在此之前，platform 内部靠 `apps/<feature>/` 的模块边界与**跨模块 import 白名单闸**维持可拆分性——真要拆时，拆分动作应当只是把目录搬走。
</content>
