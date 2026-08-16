# 业务平台上下文

本服务是系统的业务主体，当前承载**全场空调台账**、**空间配置**、**空调数据面**
（查看现场能源管理系统里的原始数据）、**大屏组态**（项目、大屏、画布节点、
数据绑定的配置面）与**采集配置面**（数据源、点位、采集计划下发、点位历史读侧）。
采集**运行时**不在本上下文内（它在 `collector-server`），切线见
[ADR-0001](../../../docs/adr/0001-采集运行时独立成服务而配置面留在平台.md)。

数据面的完整规格见 [`docs/AC_DATA_DESIGN.md`](../../../docs/AC_DATA_DESIGN.md)，
直读外库而不落地的理由见
[ADR-0009](../../../docs/adr/0009-空调原始数据由平台直读外部EMS库.md)。

---

## 1. 通用语言

### 1.1 台账与空间

| 词 | 指什么 | 不叫什么 |
|---|---|---|
| **车间** `workshop` | 空间树的顶层。名字全场唯一 | 不叫厂房 / 区域 |
| **房间** `room` | 车间内的一个封闭空间。名字**只在车间内**唯一 | 不叫区域 / 工位 |
| **空调** `ac_unit` | 一台空调。必定属于且只属于一个房间 | 不叫设备 / 机组 |
| **序号** `serial` | 空调的**全场唯一**设备编号（铭牌号 / 资产号） | 不是排序号 |

层级是固定两级，**不是任意深度的树**：车间 → 房间 → 空调。

### 1.2 大屏组态

| 词 | 指什么 | 不叫什么 |
|---|---|---|
| **项目** `dashboard_project` | 一组大屏的容器，持有主题与品牌 | 不叫工程 / 空间 |
| **大屏** `dashboard` | 一张画布：设计坐标系尺寸 + 一棵节点树 | 不叫看板 / 页面 |
| **节点** `dashboard_node` | 画布上的一个渲染单元，容器也是节点 | 不叫组件 / 控件 |
| **模块** `module` | 节点的**类型**，由前端 manifest 定义 | 不叫组件类型 |
| **绑定** `dashboard_binding` | 把节点的一个数据槽接到一个来源上 | 不叫数据源 |
| **绑定槽** `field_key` | 模块声明的数据入口，数组槽形如 `hotspots[0].value` | 不叫字段 |

⚠ **三个 node 不是一回事**：画布节点（本模块）、采集点位（`node_key`，
`apps/collect`）、OPC UA 地址空间节点（`opcua-server`）。顶层资源名因此带
`dashboard-` 前缀，不叫光秃秃的 `nodes`。

### 1.3 采集配置面

| 词 | 指什么 | 不叫什么 |
|---|---|---|
| **数据源** `collect_source` | 一个可连接的现场端点：协议 + 地址 + 凭据 | 不叫服务器（`opcua-server` 已占用那个词且方向相反） |
| **点位** `collect_point` | 数据源下的一个测点 | 不叫节点（大屏那边的 node 是画布节点） |
| **点位身份** `node_key` | `{source_id}:{point_code}`，全系统指代一个点位 | 不含协议名 |
| **寻址串** `address` | 协议特有的地址，如 `ns=2;s=Temp1` | 不是身份，是**可改的配置** |
| **采集计划** `plan` | 下发给 collector 的全量配置 + 内容摘要版本号 | 不叫配置快照 |

⚠ **`code` 是身份、`address` 是配置**：换协议只改 `address`，历史曲线是连续的
一条；`code` 改名等于换身份，故**不提供改名接口**（COLLECT_DESIGN §2）。

### 1.4 实时发布（`publisher` 角色，两条链路）

| 词 | 指什么 | 不叫什么 |
|---|---|---|
| **链路** `Lane` | 一个对账器 + 一个发布器。眼下两条：大屏、采集配置页 | 不叫角色（两条共用同一个进程与同一把租约） |
| **主题** `topic` | `dashboard:{dashboard_id}` 或 `collect:{source_id}`，hub 眼里的一个不透明键 | 不叫频道 |
| **观看者** `viewer` | hub 那张订阅表里的一条**连接**，不是一个人 | 不叫用户（一人可以开三个标签页） |
| **活跃大屏 / 活跃数据源** | 此刻至少有一条连接订着它的主题的那些 | 不叫在线大屏 |
| **发布计划** `DashboardPlan` / `LivePlan` | 一张大屏 / 一个数据源当前要推的点位身份 | 不叫采集计划（那是下发给 collector 的） |
| **条目** `item` | 一个点位的一条推送记录：身份 + 状态 + 值 + 时刻 + 质量 | 不叫消息（消息是 hub 那层的信封） |
| **全量帧 / 增量帧** | 带上整份点位清单 / 只带与上一次不同的那些 | 两者形状相同，客户端按 `nodeKey` 合并 |
| **采集运行态** `SourceRuntime` | collector 写的「这个数据源此刻连没连上」 | 不叫启用态（`is_enabled` 是配置说它该采） |

⚠ 两条链路的**推送方名字必须不同**（`platform-publisher` / `platform-collect`）：
对账靠「向 hub 要我名下的主题，多出来的注销掉」收敛，同名就会互相注销光。
⚠ 两条链路**各自兜错**：配置页那条读库失败，不许顺带让全厂大屏这一拍不更新。

### 1.5 数据面

| 词 | 指什么 | 不叫什么 |
|---|---|---|
| **数据集** `dataset` | 一台空调可看的一类数据。当前只有 `raw_minute`（原始分钟数据） | 不叫数据源 / 表 |
| **数据源对象** `source_object` | 外部 EMS 库里承载某个数据集的那个视图名，例如 `KTStartData_K01` | 不叫表名 / 视图 |
| **绑定** `binding` | 「这台空调的这个数据集，读那个对象」这条对应关系 | 不叫关联 / 映射 |
| **指标** `metric` | 数据集里的一个可读量，例如 `workshop_temp_avg` | 不叫字段 / 列 / 点位 |
| **达标范围** `metric limit` | 一台空调某个指标的上下限，用于后期判定是否达标 | 不叫阈值 / 报警线 |

**`dataset` 是数据面唯一的扩展轴。** 要看别的数据（能耗、报警、开停机记录）是往
`apps/hvac/datasets.py` 的目录里加一项，不是加一个页面。

## 2. 不变量

1. **一台空调必定有房间**（`room_id NOT NULL`）。不存在「待分配」这种中间态——
   录台账前先把车间与房间建好。
2. **序号全场唯一**，由唯一约束保证，不靠「先查再插」——并发下先查再插必然重复。
3. **同一房间内的空调互相影响**。房间不是展示用的标签，它是热耦合边界，也是
   后续开机预测的最小聚合单位。这条决定了空间配置页把房间画成容器而不是一列文字。
4. **删除不级联**：车间下有房间、房间里有空调时，删除一律 409。级联删会让一次
   误点把整段台账连根带走，而台账是人一台一台录进去的。
5. `null` 不表示「清空」。台账与空间的列全部 NOT NULL，PATCH 里显式传 `null`
   与不传同义（见 `services/changes.py`）。达标范围是例外，见第 8 条。
6. **一台空调的一个数据集只能绑一个对象**，由唯一约束保证。反过来不成立：
   ⚠ 两台空调绑同一个视图是运维过渡期的常态，**不加** `source_object` 的唯一
   约束——拦下来只会让人绕道改数据。
7. **绑定要过三道校验才落库**：白名单正则 → 外库里确实存在 → 列形状够这个数据集
   用。少任何一道，绑一个不存在的视图都要等到有人翻数据时才炸，而那时的错误看
   起来像「数据源不可用」，与真实原因隔得很远。
8. **达标范围的单边为空表示该侧不限制，不表示 0。** 两端都空的条目没有意义，
   按「不配置」处理直接删行，而不是存一行空记录。
9. **达标范围的 `PUT` 是覆盖式**：请求里没出现的指标视为清除。这与 PATCH 的
   「没给就是不改」相反，用 PUT 正是为了把这个语义摆在方法上。绑定的 `PUT` 同理，
   同一数据集重复调用是覆盖不是新增。
10. **外库的测点 `NULL` 一律原样透出**，不补零、不插值。⚠ 把 `fan_frequency`
    的 `NULL` 折成 `0.0` 会让一次数据断档被读成一次真实的停机加一次开机。
11. **外库不可用时不返回陈旧数据**：查不到就 503 说查不到，故不需要陈旧标注
    （[runtime-resilience §9](../../../docs/agents/runtime-resilience.md)）。
12. **外库的时刻在对外口径里一律 UTC。** 库里存的是 naive 的当地时，换算只在
    `services/ac_source_reader.py` 一处发生，基准是配置项 `PLATFORM_ACSOURCE_TIMEZONE`。

### 2.1 大屏组态的不变量（[ADR-0012](../../../docs/adr/0012-大屏组态以节点为可寻址资源而非整文档替换.md)）

13. **节点与绑定的 id 一经创建永不改变**，整树替换也按 id 做三路比对
    （新增 / 更新 / 删除），不是「删光重插」。实时推送的关联键正是 `binding_id`，
    重生成会让关联每次保存断一次，Agent 上一步建的绑定下一步也就不可寻址了。
14. **`(dashboard_id, client_key)` 唯一**，撞了 `409`。⚠ 不许 `setdefault`
    「先到先得」——那会让第二个节点被安静地并进第一个。
15. **读出来的顺序是确定的**：节点按 `(parent_id, z_index, id)`、绑定按
    `(field_key, id)`，写死在查询里。两次读取同一张未修改的大屏逐字节相同，
    Agent 才能靠 diff 判断自己这一步改了什么。
16. **`:replace-layout` 必带 `expected_version`**，与库里不符即 `409`。任何一次
    结构变更（改元数据、增删改节点或绑定）都推进 `row_version`。
17. **`(node_id, field_key)` 唯一**：一个槽绑两次时取哪个只看行序。
18. **`row_version` 与 `schema_version` 是两列，不许合并**：一个管并发，一个管
    文档格式。⚠ 靠「坐标是不是整数」这类结构启发式判断格式版本，会把 Agent 生成
    的合法文档误判成旧格式，并把每个坐标乘上栅格宽。
19. **写错就响亮失败**：父节点不存在 / 指向自己 / 成环、模块类型未注册、
    `field_key` 不是该模块的槽、`source_kind` 未注册、点位查无此条——一律
    `400` 且 `details[]` 指到字段。⚠ **成环检查做在服务端**，不是交给前端：
    前端拖不出环，Agent 与直接调接口的人拖得出。
20. **逐节点端点与 `:replace-layout` 共用同一套校验与同一套 id 保持逻辑**。
    批量路径更宽松就等于「先用批量接口写进去、再用单条接口读出来」这条后门。
21. **数组槽的索引必须连续且从 0 起**。`rows[7]` 在没有 `rows[0..6]` 时存在，
    渲染出来是一列全空的行。

### 2.2 采集配置面的不变量（[ADR-0001](../../../docs/adr/0001-采集运行时独立成服务而配置面留在平台.md)、[ADR-0011](../../../docs/adr/0011-采集按驱动适配器分协议而采集计划保持协议无关.md)）

22. **平台侧绝不建立任何现场连接**。浏览地址空间、连通性测试、寻址串校验、下发
    写值，四件都经 Redis 命令总线交给持有会话的 collector 执行。自己也开一条连接
    就是在物理设备上叠加会话，而工业设备的会话上限往往只有个位数。
23. **删点位前必须问「有没有大屏绑着它」**，被绑着就 409 并列出那些大屏。这条正是
    配置面留在 platform 的理由：绑定表在同一个库里，问一句是进程内调用。
24. **`:write` 必须带 `Idempotency-Key`**，比 api-contract §7 的「支持」更严；
    且**写超时按不可重试处理**——超时不代表没写成功，重试可能向 PLC 下发两次。
    这条链路上没有任何一层重试。
25. **寻址串校验没做成不许当作通过**。超时、采集侧离线、动作还不被支持，三者一律
    标 `unverified` 并如实回给调用方；只有被现场明确拒掉才 400。
26. **采集计划的版本号是内容摘要**，不是 `max(updated_at)`。删掉一个点位不会让任何
    一行的时刻变新，用时间戳做版本删除就永远推不下去，而 collector 会继续采一个
    已经删掉的点位。
27. **归档宽表跨 schema 只读**：`collect.point_history` 归 collector 写独占，本服务
    走独立只读连接池 + `SET TRANSACTION READ ONLY`，**不跨 schema JOIN、不建外键、
    不共用事务**。
28. **时序集合一律游标分页**，且区间必须双向有界——单边开区间会让计划器扫遍全部
    分块，而那张表按 6 小时切块。

### 2.3 大屏实时发布的不变量（[ADR-0005](../../../docs/adr/0005-实时通道与边缘网关的职责分界.md)、[ADR-0007](../../../docs/adr/0007-实时通道薄化与开放主题命名空间.md)）

29. **只推有人在看的大屏**，活跃集合由 hub 的订阅关系推导，见下面第 4.2 节的
    「活跃大屏怎么来」。
30. **新观看者出现推一次全量**，运行态零 HTTP——首帧初值也走 WS。判据是**连接
    集合变大**而不是人数变化：人数不变的换人同样是一位新观看者。
31. **`seq` 归 hub**，publisher 不编号也不读回执里的号。推送方自己编号会在副本
    切换时倒退，而客户端把倒退读成丢帧。
32. **节流全在推送方**：合并窗口、条目上限、分片。⚠ hub 一旦知道「哪些载荷可以
    合并」，就又长出业务知识了。
33. **取不到就说取不到**：没有快照值一律 `state: "error"` 加原因，绝不推空值或
    零值冒充读数；值太旧照推但标 `state: "stale"`，且时刻照实是旧值的时刻。
34. **hub 不可达降级为「没有实时通道」，绝不降级为「大屏打不开」**：每一处调用
    失败只记日志并吞掉，配置面照常工作。
35. **一条链路只有一层负责重试**：推失败就丢这一批，客户端据 `seq` 缺口自己发现。
    这一层重推会与下一拍抢顺序。
36. **只把真的推出去的条目记进「已发送」**。记多了下一拍就会以为客户端已经有这些
    值，那批数据永远补不回来，而日志里只有一条推送失败。
37. **主题登记与注销都按 at-least-once，且有一条周期对账**（`topic_reconcile`）。
    ⚠ 对账的权威是**大屏表**；取不到 hub 的清单时一个都不注销——空清单意味着
    「我没看见任何主题」，按它去清会把全量主题清光。
38. **publisher 全局单活**，Redis 租约选主，renew-or-die；**Redis 不可达一律判非
    leader**。关停顺序 = 停收新活 → drain → **让租约** → 关资源。
39. **本角色不挂任何探针**：它不接流量，「摘掉它」没有意义。

## 3. 鉴权

**本服务不校验令牌。** 它读 edge-gateway 在调过 auth-server `/verify` 之后注入的
签名身份头（`X-Auth-*`），验签用 `PLATFORM_EDGE_SIGNING_SECRET`，取值必须与
auth-server 的 `AUTH_EDGE_SIGNING_SECRET` 逐字相同。

- ⚠ 验签是关键：没有它，任何人直接 `curl -H "X-Auth-Permissions: …"` 打 8005
  就是超管。任何一步不过一律 401，不做部分信任。
- ⚠ 权限集超长时边缘只发 `X-Auth-Permissions-Truncated`，此时签名覆盖的是完整
  权限串、无法验签，一律判不可信。正解是回查 auth-server 的 `/internal` 权限
  端点，本期没做——当前目录只有 9 个权限码，离 3072 字节上限很远。
- 权限码：`ac:view`（全部读面）/ `ac:manage`（全部写面）；大屏面另有
  `dashboard:view|edit|manage`；采集面另有 `collect:view|operate|manage`。
  **目录的唯一真源是 auth-server 的 `apps/auth/catalog.py`**，本服务各
  `apps/<feature>/catalog.py` 只是闸 2 要判定的字面量复述，两边必须逐字一致。
- ⚠ **采集面的三个码不是「读 / 写」两档而是三档**：`operate` 单列出来，是因为
  `:test` / `:browse` / `:write` 会在**物理设备**上产生一次真实往返，与「改一行
  配置」不是同一类风险。能改配置的人未必该被允许对着 PLC 下发写值。
- **内部面 `/internal/v1/platform/collect-plan` 不走权限码**，走服务级密钥
  （`X-Service-Key`，逐字 `compare_digest`，未配置即拒绝）：它要挡的是「任何人」，
  而权限码挂在人身上（ADR-0005）。边缘对 `/internal/` 一律 deny。
- ⚠ **`GET /ac-datasets/{dataset}/source-objects` 要 `ac:manage` 而不是 `ac:view`**：
  它列的是外库里有哪些对象、列形状如何，暴露的是外部库的结构而不是业务数据。
  边缘的闸 1 只按方法兜（`GET` → `ac:view`），故这是本服务唯一一处闸 2 严于闸 1
  的端点。方向是安全的（边缘放行、端点拒绝），但**反过来会是一个静默的越权洞**，
  所以它登记在 `tests/contract/test_route_matrix.py` 的 `STRICTER_THAN_GATE_ONE`
  表里，并由两条断言守着：只许收紧到 `ac:manage`，且必须指向真实存在的路由。
- ⚠ **闸 1 按方法兜住 `/api/v1/platform/*` 整个对外面**，这意味着一个**忘了写闸 2
  的新端点不会被边缘拦下**——任何持 `ac:view` 的人都能打到它。堵住这个洞的是本服务
  `tests/contract/test_route_matrix.py::test_no_public_route_is_left_unguarded`
  「每条对外路由都必须自己声明权限码」。⚠ 这是一处**跨服务承重**关系：闸 1 的
  宽口径在 auth-server，兜住它的断言在这里。删或放松那条用例之前，先想清楚谁来
  接这个洞。

## 4. 模块结构

```
apps/dashboard/
├── api/          dashboard_projects · dashboards（含 :replace-layout / :validate）
│                 · dashboard_nodes · dashboard_bindings · module_types
├── services/     事务边界
│   ├── validation           校验的汇合点：两条写入路径都从这里过
│   ├── node_rules           父节点、成环、模块类型、client_key
│   ├── binding_rules        绑定槽、数组索引连续性、来源与点位
│   ├── layout_plan          整树替换的 id 保持与父在子前排序
│   ├── layout_service       三路比对写回
│   ├── module_catalog       模块清单的装载与槽键解析
│   ├── point_catalog        点位存在性的查询口（Protocol）
│   ├── idempotency          幂等键
│   ├── state · drafts       当前状态与校验形态
│   └── presenters · changes
├── crud/         只做数据访问，不提交
├── models/       dashboard_projects · dashboards · dashboard_nodes
│                 · dashboard_bindings
├── schemas/      入参出参（⚠ 几何四列对外叫 x/y/w/h，Python 侧写全名）
├── module_types.json  模块清单（前端构建期的导出产物，见下）
├── source_kinds.py    绑定来源的闭合集合
├── deps.py       闸 2 与写上下文
├── catalog.py    权限码字面量
└── errors.py     错误码领域号 10

apps/hvac/
├── api/          workshops · rooms · ac_units（含 :relocate 动作端点）· ac_data
├── services/     事务边界
│   ├── ac_data_service      数据集目录、绑定、达标范围
│   ├── ac_reading_service   区间校验、游标、桶档位、指标白名单
│   ├── ac_source_reader     外库适配：SQL 形状、时区换算、驱动异常收敛
│   ├── ac_unit_service · room_service · workshop_service
│   ├── edge_identity        身份头验签的纯函数
│   ├── presenters           ORM → 对外模型
│   └── changes              PATCH 的「没给就是不改」
├── crud/         只做数据访问，不提交
├── models/       hvac_workshops · hvac_rooms · hvac_ac_units
│                 · hvac_ac_data_bindings · hvac_ac_metric_limits
├── schemas/      入参出参
├── datasets.py   数据集与指标目录（外部视图形状的唯一真源）
├── deps.py       闸 2（依赖注入件）与外库读取面的装配
├── catalog.py    权限码字面量
└── errors.py     错误码领域号 16
```

⚠ `deps.py` 与 `edge_identity.py` 其实是**服务级**而非模块级的东西，现在放在
`apps/hvac/` 里是因为它只有一个消费方。第二个功能模块出现时，跨模块 import 会被
结构闸挡下——那就是把它们上移的信号，不要靠放宽白名单绕过去。

⚠ `module_types.json` 是一处**有意的重复**：模块清单的唯一真源在**前端**
（渲染组件与 manifest 同处一地才不会漂），服务端这份是前端在构建期导出的产物，
进版本库。不这么做的话，Agent 要么读不到清单，要么服务端得反过来解析前端源码。
两侧一致性由 `tests/contract/test_dashboard_module_catalog.py` 守：闭合联合
（控件类型、绑定数据类型、外观、区域、来源种类、运算符）逐条与
`web/packages/contracts/src/{module,binding}.ts` 比对。⚠ 漏了这道测试，Agent 会
按过期清单生成配置，而配置在前端渲染成空白。

⚠ **点位台账在本模块里是一个注入口而不是一张表**：`services/point_catalog.py`
只声明 `PointCatalog` 协议，组合根现在装的是空名单 `StaticPointCatalog()`——
采集配置面（`apps/collect`）落地前本服务没有点位表，故 `opcua` / `archive`
绑定一律 `400` 并指到字段，而不是静默放行一条永远产不出数据的绑定。接线点是
`container.build_container`。

⚠ `datasets.py` 是 19 个指标 key 的**唯一真源**：SQL 的列清单、指标白名单、建表
的 CHECK 约束都从它来。对外模型 `RawSampleOut` 的字段是手写的，两边由
`tests/contract/test_ac_data_contract.py` 钉住——漂了不会报错，只会让某个指标在
表格里永远是空的。

外库的连接由 `container.py` 装配成 `lib.db.ReadOnlySqlSource`，只跑 `SELECT`，
**不进任何一条 alembic 迁移链**，也**不进就绪探针**（见第 5 节）。

### 4.1 采集配置面的解剖

```
apps/collect/
├── api/          collect_sources（含 :test / :browse）· collect_points（含 :write）
│                 · point_histories（含 :aggregate）· internal（采集计划）
├── services/     事务边界
│   ├── command_bus          命令总线发起端：信封、traceparent、结论翻译
│   ├── command_transport    Redis list 传输面，键名与 collector 逐字一致
│   ├── address_check        寻址串校验的三档结论
│   ├── binding_guard        删点位前问大屏绑定（只走 dashboard 的 services 公开面）
│   ├── plan_service         全量计划 + 内容摘要版本
│   ├── plan_notifier        计划变更广播（加速器，不是保证）
│   ├── history_service      游标分页与分桶聚合
│   ├── history_source       归档库的只读连接
│   ├── state_source         采集运行态的只读面（跨 schema 读 collector 写的表）
│   ├── point_catalog        大屏绑定问的那张点位台账（PointCatalog 的真实现）
│   └── transactions         跨进程调用之前放掉只读事务
├── crud/         source · point · history（跨 schema 只读 SQL）
├── models/       collect_sources · collect_points
└── protocols.py  protocol / read_mode / data_type 三组闭合集合
```

⚠ **采集运行态在事务外贴**：它来自 collect schema 的另一条只读连接，在业务事务
里读它就是「事务内做外部 IO」。故写路径一律先 commit、再 `attach_runtime`。

⚠ **两处刻意的重复**，都由「服务之间不许互相 import」逼出来，改一边就要改另一边：
`services/command_transport.py` 的键名与信封字段复述自 collector-server 的
`commands.py`；`schemas/plan.py` 的字段名复述自它的 `apps/collect/schemas/plan.py`
（那边是 `extra="ignore"`，漂了不会报错，只会让某个采样参数怎么改都不生效）。

### 4.2 实时发布的解剖（`publisher` 角色，两条链路）

```
publisher.py                 角色装配 + 发布循环（租约、合并窗口、对账节奏、关停）
                             ⚠ 循环持有 Lane 元组，逐条跑并**逐条兜错**
lease.py                     Redis 租约（⚠ 与 collector-server 同源的刻意重复）
realtime.py                  hub 内部端点的瘦客户端 + FramePublisher/TopicRegistrar 协议
apps/dashboard/services/     —— 大屏那条链路
├── topics                   `dashboard:{id}` 的命名与解析、它要求的权限码
├── viewers                  活跃大屏（跨 schema 只读 realtime.subscription）
├── publish_plan             一屏要推哪些点位 + 行版本；大屏清单（对账用）
├── publish_service          一拍：活跃集 → 计划 → 取值 → 批推
└── topic_reconcile          主题登记的周期对账
apps/collect/services/       —— 采集配置页那条链路 + 两者共用的件
├── point_frames             条目组装：ok / stale / error、增量比对、分片（两条链路共用）
├── snapshot_source          点位当前值的读侧（Redis HMGET，⚠ 绝不 HGETALL）
├── topics                   `collect:{id}` 的命名与解析、它要求的权限码
├── watchers                 活跃数据源（同一张订阅表，另一个主题前缀）
├── live_plan                一个数据源要推哪些点位（TTL 重读 + 逐条比对）
├── live_publisher           一拍：活跃集 → 清单 → 取值 → 批推
└── topic_reconcile          采集主题登记的周期对账
apps/dashboard/crud/publish   三条只读查询：大屏清单、行版本、实时绑定的点位身份
```

⚠ **`point_frames` 住在 `apps/collect` 而不是 `apps/dashboard`**：它的输入是
`PointReading`、输出是点位条目，一个大屏名词也没有。放在大屏那边会让采集链路
反向 import，而那是一个 import 期的环。

⚠ **采集点位表没有行版本可比**，故 `live_plan` 靠周期重读 + 逐条比对收敛。
到期重读**不等于**清单变了：不比对就会每个 TTL 推一帧全量。

**活跃大屏怎么来，以及它为什么没让 hub 长出业务知识**：hub 的
`realtime.subscription` 里只有「连接 × 主题」两列，主题对它是不透明键；本服务
跨 schema **只读**这张表，再把 `dashboard:{id}` 解析成一张大屏——这一步发生在
`services/viewers.py`，hub 那边没有一行代码认识大屏（由
`tests/contract/test_realtime_publish_wire.py` 的两条用例钉住：hub 源码里不许出现
`dashboard:` 前缀与 `dashboard:view` 这个码）。参考实现的做法相反：它让 hub 在
订阅/退订时另外维护一份「活跃看板 / 观看者」登记供业务查询，那是**通道服务替业务
保管业务状态**，[ADR-0007](../../../docs/adr/0007-实时通道薄化与开放主题命名空间.md)
§理由一点名反对。

**主题什么时候登记**：由 publisher 的周期对账登记与注销，不在建大屏的请求路径上
打 hub（那会把一次跨服务调用塞进事务边界附近，且 hub 抖动时连大屏都建不了）。
⚠ 代价写在明处：`PLATFORM_PUBLISH_RECONCILE_INTERVAL_S`（默认 5 秒）同时是
**新建的大屏多久之后可被订阅**的上界——在那之前 hub 会以「主题未登记」拒订，
前端重试一次即可。

⚠ **发布面刻意不进 `apps/dashboard/services/__init__.py` 的公开面清单**：它要读
`apps/collect` 的快照公开面，而后者又要读本模块的 `point_usage`（删点位前问大屏
绑定）。两份清单互相 import 就是一个 **import 期的环**，报出来的是
「partially initialized module」而不是任何业务错误。两个方向都是真实的领域依赖，
删不掉，故让其中一份清单不参与，消费方按子模块精确 import。

## 5. 外部依赖的边界

现场能源管理系统（EMS）的 SQL Server 库是**外部依赖**：库是厂商的、表结构是厂商
的、写入是厂商的，我们只读。

- **只读到底**：连接只跑 `SELECT`，不建表、不迁移、不写入。
- ⚠ **它不进就绪探针**。EMS 抖一下只该让空调数据面返回 503，台账页与空间配置页
  照常工作；进了就绪判定就是整个副本被摘掉流量，而那两页根本不读它。
- **启动自检会 ping 一次并记日志，但不阻断启动**（`ac_source_selfcheck_passed`
  / `ac_source_selfcheck_failed`）。
- **可绑定对象按列形状发现，不按名字前缀**。⚠ `KTStartData%` 这个前缀下混着几个
  只有 4 列、连时间列都没有的非时序视图，按名字过滤会把它们放进下拉框。
- **深翻页很贵**：游标式取一页 5 ms，`OFFSET 400000` 是 594 ms。这把
  [api-contract §5.1](../../../docs/agents/api-contract.md)「时序数据禁止用页码
  分页」从一条规范变成了一条性能约束。表格也因此不返回 `total`。
- ⚠ 游标只带时刻锚点、不带去重序号，前提是**外库的时刻全表无重复**。这条前提由
  `tests/unit/test_ac_reading.py` 的契约用例记着；厂商哪天开始写重复时间戳，翻页
  处会静默漏行。

## 6. 本期有意没做

- **大屏的公开分享面**：表里留了 `is_public` / `public_token`，接口不开。
- **绑定求值仍在前端**：`publisher` 推的是**点位当前值**（按 `nodeKey` 索引），
  `computed` / `static` / `archive` 三种来源的求值留在前端 provider 侧。服务端
  多算一遍会让同一个绑定有两处口径，而两处口径一定会漂。
- **`archive` 绑定不走推送**：它要的是历史序列，走 `/point-histories` 的读面。
- **推送侧的观测指标**：只有结构化日志（`dashboard_values_published` /
  `dashboard_frame_dropped` / `publisher_lease_*`），没有 Prometheus 指标。
- **凭据的加密与轮换**：`collect_sources.credential_enc` 建了列，但一期只存一个
  「配过没配过」的标记，采集计划里**不下发凭据**。存明文一旦上线就再也收不回来，
  而下发一个假的比不下发更糟。
- **按点位保留期的执行**：`archive_retention_days` 收在配置里，夜间批处理归
  `platform-worker`，本期不做（迁移里禁止回填数据）。

- **审计表**：台账 CRUD 不属于「写值 / 授权 / 发布」，只出结构化日志。
- **软删**：真删 + 删除守卫，比软删简单也更诚实（database-standard §2.2）。
- **平面图坐标**：房间即分组，同房间的空调不分先后。要画平面图是加两列可空的
  坐标，属扩展步，不动现有结构。
- **外库数据不落地、不缓存、不同步**（ADR-0009）。同步方案要额外造增量水位、
  补洞、乱序处理、失败重试与保留期，买回来的是「查询更快」与「厂商库压力更小」，
  而实测这两条收益都不成立。
- **不做跨空调聚合**（全场达标率之类）：那要逐台查外库 17 次，等有真实需求再说。
- **不在图表上体现达标范围**，只存不画。
- **不导入 `KTInfo` 的空调清单**：台账是我们自己的，`KTInfo` 只在绑定下拉框里
  提供一个 `caption` 帮人认位置。
