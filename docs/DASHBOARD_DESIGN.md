# 大屏组态与实时 — 设计

> 后端在 `platform-server/apps/dashboard` + `publisher` 角色，前端在 `web/packages/{modules,runtime,three-core,twin-config}` 与编辑器页面。
> 写入面以节点为可寻址资源（[ADR-0012](adr/0012-大屏组态以节点为可寻址资源而非整文档替换.md)）。
> 一期只落 **header** 与 **twin-view（数字孪生）** 两个模块。

---

## 1. 通用语言

| 词 | 指什么 |
|---|---|
| **项目**（project） | 一组大屏的容器，持有主题与品牌 |
| **大屏**（dashboard） | 一张画布，有设计坐标系尺寸与一棵节点树 |
| **节点**（node） | 画布上的一个渲染单元。容器也是节点——**万物皆节点，节点可套节点** |
| **模块**（module） | 节点的**类型**，由前端 manifest 定义（`header` / `twin-view` / …） |
| **绑定**（binding） | 把节点的一个数据槽接到一个数据来源上 |
| **绑定槽**（binding slot） | 模块声明的数据入口，`BindingSpec.key` |

⚠ 采集那边的"点位"是 point，画布这边的"节点"是 node。**两个 node 不是一回事**，
参考实现里它们同名，导致 `node_id` 一会儿指 OPC UA NodeId、一会儿指画布节点。本仓不许重名。

---

## 2. 数据模型（schema `platform`）

### 2.1 表

`dashboard_projects`：`id`、`name`、`description`、`theme_json`、`brand_json`、时间戳。

`dashboards`：`id`、`project_id`、`name`、`description`、`design_width`(1920)、`design_height`(1080)、
`theme_json`、`chrome_json`、`row_version`、**`schema_version`**、`is_public`、`public_token`、时间戳。

`dashboard_nodes`：`id`、`dashboard_id`、`parent_id`(自引用)、`client_key`、`module_type`、
`x`、`y`、`w`、`h`、`z_index`、`is_visible`、`config_json`、时间戳。
唯一约束 `uq_dashboard_nodes_dashboard_id_client_key`。

`dashboard_bindings`：`id`、`node_id`、`field_key`、`source_kind`、`node_key`、
`static_value_json`、`compute_json`、`detail_json`、`transform_json`、时间戳。
唯一约束 `uq_dashboard_bindings_node_id_field_key`。

### 2.2 六处与参考实现刻意不同

参考实现的这些行为是**已证实会静默出错**的，逐条改掉：

| # | 参考实现 | 本仓 | 不改会怎样 |
|---|---|---|---|
| 1 | 绑定 id 每次保存重新生成 | id 永不改变，替换按 id 三路比对 | 实时推送的 `binding_id` 关联键每次保存断一次；Agent 上一步建的绑定下一步不可寻址 |
| 2 | `client_key` 撞键 `setdefault` 先到先得 | 唯一约束，撞了 `409` | 第二个节点被安静地并进第一个 |
| 3 | 关系无 `order_by` | 节点按 `(parent_id, z_index, id)`、绑定按 `(field_key, id)` | 两次导出不一致，Agent 无法 diff |
| 4 | 无乐观锁，最后写入者获胜 | `expected_version` 不符即 `409` | 人与 Agent 同时编辑，一方的改动被静默抹掉 |
| 5 | `(module_id, field_key)` 无唯一约束 | 有 | 同一个槽被绑两次，取哪个看行序 |
| 6 | 格式版本靠"坐标是不是整数"启发式判断 | 显式 `schema_version` 整数列 | Agent 生成的合法文档被误判成旧格式，每个坐标被乘上栅格宽 |

`row_version`（行版本，乐观锁用）与 `schema_version`（文档格式版本）**是两个字段，不许合并**。

### 2.3 校验：写错就响亮失败

以下一律 `400`，`details[]` 指到具体字段。参考实现全部是静默降级 + `200`：

- `parent_id` 不存在 / 指向自己 / 成环 → `40010`
- `module_type` 未在模块清单里 → `40010`
- `field_key` 不是该模块声明的绑定槽 → `40010`
- `source_kind` 未注册 → `40011`
- 绑定的 `node_key` 查无此点位 → `40011`

成环检查必须做在服务端。参考实现把它写在模型注释里交给前端，那条注释本身就是这个洞的自述。

---

## 3. API 面

错误码领域号 **10**（大屏与绑定）。权限码 `dashboard:view` / `dashboard:edit` / `dashboard:manage`。

```
GET    /api/v1/platform/dashboards?project_id=&q=          分页
POST   /api/v1/platform/dashboards                         Idempotency-Key
GET    /api/v1/platform/dashboards/{id}                    加载（运行时与编辑器共用）
PATCH  /api/v1/platform/dashboards/{id}                    元数据
DELETE /api/v1/platform/dashboards/{id}
POST   /api/v1/platform/dashboards/{id}:replace-layout     整树替换，必带 expected_version
POST   /api/v1/platform/dashboards/{id}:validate           自检，返回全部悬空引用

POST   /api/v1/platform/dashboards/{id}/nodes              新增节点
GET    /api/v1/platform/dashboard-nodes?dashboard_id=
PATCH  /api/v1/platform/dashboard-nodes/{id}
DELETE /api/v1/platform/dashboard-nodes/{id}               连子树

POST   /api/v1/platform/dashboard-nodes/{id}/bindings
GET    /api/v1/platform/dashboard-bindings?node_id=
PATCH  /api/v1/platform/dashboard-bindings/{id}
DELETE /api/v1/platform/dashboard-bindings/{id}

GET    /api/v1/platform/module-types                       模块清单（Agent 的地图）
GET    /api/v1/platform/module-types/{type}
```

嵌套不超过两层，所以节点与绑定在第二层之后升为顶层资源按 query 过滤
（[api-contract](agents/api-contract.md) §1）。

⚠ 顶层资源名带 `dashboard-` 前缀，不叫光秃秃的 `nodes` / `bindings`：
platform 这一个服务里同时有采集点位（`collect-points`）与画布节点，
而 `opcua-server` 那边还有第三种 `nodes`（地址空间节点）。
参考实现里这三样都叫 node，读代码时要靠上下文猜是哪一种——**同一个词指三样东西，
是这套代码里最持久的一个理解成本**。

### 3.1 面向 Agent 的四条口径

用户明确要求后续由 AI Agent 设计大屏、连接点位。这不是"将来再说"——
它决定接口现在长什么样。四条：

1. **可发现。** `GET /module-types` 返回每个模块的 `displayName` / `category` /
   `defaultSize` / `configSchema` / `bindings`。没有它，Agent 要生成一张大屏
   就得先去读前端源码。
   ⚠ 光有字段表还不够，**得让它读得懂**：清单里另有三段与一张图例——
   `config_presets`（一次落一整套观感，逐个字段去凑必漏）、
   `default_config`（出厂就落库的键，与字段的 `default` 不落库兜底不是一回事）、
   `sub_editor`（这一段配置由整页子编辑器接管，形状不在清单里，照猜着写不报错也不渲染），
   以及 `field_types` / `binding_data_types`（每一档 `type` 该写什么形状的值）。
   属性面板按 `type` 选控件，Agent 没有控件可看——`type: "enum"` 那一格该写
   `options[].value` 里的哪一个、`type: "image"` 接不接 CSS 渐变，只有图例说得出来。
   图例的真源在 `@dt/contracts` 的 `CONFIG_FIELD_TYPE_DOCS` / `BINDING_DATA_TYPE_DOCS`，
   与模块表同一份产物、由同一道快照测试锁死。
2. **可寻址且稳定。** 每个节点、每个绑定有永不改变的 id。Agent 的工作方式是
   "做一步、看结果、决定下一步"，这要求每一步都有可以指回去的名字。
3. **可校验。** 写错立刻 `400` 且指到字段。Agent 看不见画布，它只有响应；
   一个返回 `200` 却把节点悄悄挪到顶层的接口，会让它带着错误继续往下走。
4. **可重试。** 所有创建带 `Idempotency-Key`，所有整树替换带 `expected_version`。

⚠ 模块清单有一处**必须承认的重复**：manifest 的单一真源在前端包里（渲染组件与它同处一地才不会漂），
服务端这份是前端在构建期导出的产物，进版本库、由契约测试锁死两侧一致。
漏了这道测试，Agent 会按过期清单生成配置，而配置在前端渲染成空白——
这正是本设计想消灭的那类静默故障，只是换了个位置。

---

## 4. 绑定与取数

### 4.1 来源种类

```
opcua      → 实时点位，node_key 指向 collect_points，走 WS 推送
static     → 常量，static_value_json
computed   → 同模块内其它槽的运算，compute_json {op, inputs, precision}
archive    → 历史序列，detail_json {node_key, range}
```

`source_kind` 是**闭合集合**，未注册的值 `400`。参考实现放开成任意字符串，
于是 `"opuca"` 这种拼写照常入库、永不产数据、无任何告警。

### 4.2 数组绑定

一个 `BindingSpec` 声明 `array: true` + `arrayFields`，落库成 N 行，
`field_key` 形如 `rows[0].value`。服务端校验索引**连续且从 0 起**——
参考实现不校验，`rows[7]` 可以在没有 `rows[0..6]` 的情况下存在。

### 4.3 取不到就说取不到

绑定求值失败一律返回 `state: "error"` 加原因，**绝不推空序列冒充"这段时间没数据"**。

**值有多旧不构成一档状态**：`timestampMs` 照实是采样时刻，界面据它显示「更新于」，
但不许按「比现在旧多久」把值降档——订阅只在值变化时回调，一个一天变一次的点位
按年龄判会每天被误标 23 小时，而它的值一直是对的。真正读不到时快照键会到期，
落进上面的 `error` 一档。

**「可能过期」按连接态判，不按时间戳判**——这是与上一段并行的另一件事，别混：
实时通道一断，屏上一切都是最后已知值，与点位变化快慢无关，此时整块状态降成
`stale` 并在这一格挂一枚角标（§5.6）。这就是
[runtime-resilience](agents/runtime-resilience.md)「返回陈旧数据必须标注为陈旧」
在这条链路上的落地：**读不到**靠快照 TTL 落进 `error`，**通道断了**靠连接态标成陈旧。

### 4.4 `detail_json` 里的时间窗用纪元毫秒——一条显式豁免

历史绑定的时间窗存成 `detail_json.from_ms` / `to_ms`，是**纪元毫秒整数**，
与 [api-contract](agents/api-contract.md) §6「时刻一律 RFC3339、`_ms` 后缀留给时长」
不一致。这是有意的豁免，理由与边界如下：

- `detail_json` 对后端**完全不透明**：platform 不解析它，一期的发布器也不解析
  （归档绑定在浏览器侧由历史 provider 求值）。所以这不是一个对外契约字段，
  而是前端自己的文档格式，恰好搭后端的顺风车存着。
- 窗口在浏览器里要做算术（相对窗 `1h` 换算、左右边界比较、去重合并），
  纪元毫秒是这些运算的自然形态；存 RFC3339 就要在每次求值前后各转一次。

**豁免到此为止的条件——命中任意一条就必须改成 RFC3339**：

1. 后端开始解析这个窗口（例如把归档绑定的求值挪到发布器里做）；
2. 这个字段出现在任何**响应体**里，而不只是躺在 `detail_json` 中;
3. 出现第二种时间格式的存法——两种口径并存比任何一种都糟。

⚠ 改的成本随时间涨：库里一旦有了行，改格式就要连带一次数据迁移。
命中上面任一条时**当期就改**，不要往后拖。

---

## 5. 模块系统 —— 扩展能力

这是本次改造的重点要求。判据只有一条：**第三方新增一个模块，要改几个文件？**

目标是 **1 个目录 + 1 行注册**，且**不碰运行时、不碰编辑器、不碰后端**。

### 5.1 一个模块 = 一个目录

```
packages/modules/src/modules/<type>/
├── manifest.ts      清单：type / displayName / category / defaultSize
│                    / configSchema / bindings / component
└── Component.vue    渲染组件，props 固定三件套
```

```ts
// packages/modules/src/registry.ts
export function registerModule(manifest: ModuleManifest): void
export function getModule(type: string): ModuleManifest | undefined
export function listModules(): readonly ModuleManifest[]
// 纯身份函数，只给清单字面量收窄类型；注册永远是显式的一步，
// 免得「import 了某个文件」变成一种隐式注册
export function defineModule(manifest: ModuleManifest): ModuleManifest
```

注册的那一行是 `registerModule`——它是 §5.3 ① 那条公开 API 的名字，
`defineModule` 只管类型不管注册，两个名字不许混用。

渲染组件的 props **固定三件套，不许扩**：

```ts
interface ModuleComponentProps {
  config: Record<string, unknown>   // 用户配置，对应 configSchema
  values: Record<string, unknown>   // 按 bindings[].key 求值后的值
  meta?: ModuleMeta                 // loading/connected/stale/empty/unbound/error
}
```

固定三件套是扩展性的**前提**而不是限制：运行时只需要认识这三样，
就能渲染任何模块——包括它编译时并不知道的模块。一旦某个模块要求第四个 prop，
运行时就得认识那个模块，49 个模块就会有 49 条分支。

### 5.2 属性面板是 `configSchema` 泛型渲染的

编辑器**没有任何针对具体模块的表单代码**。属性面板读 `configSchema`，
按 `ConfigField.type`（`string`/`number`/`enum`/`color`/`boolean`/`array`/`object`/…）
渲染对应控件。新增模块自动获得完整属性面板。

同理，绑定选点面板读 `bindings: BindingSpec[]`，自动摆出该模块的槽位。

面板的入参只有「槽声明 + 当前绑定」两样，**不认识"大屏节点"**，所以它同时服务
大屏编辑器的右栏与孪生子编辑器的绑定页；将来任何一个自己持有绑定的编辑面都能直接装上。

**数组槽的行有两种来源**，由清单的 `bindingRowCounts` 自述：

- 不声明时行由用户手工增删（默认口径）。
- 声明了就是**行与实体一一对应**（孪生的口径）：行数跟着配置里的实体走，
  面板上不摆增删键。超出实体数的存量绑定仍会摆出来并标成**孤行**——藏起来的话，
  那几条绑定既看不见也删不掉，而它们永远喂不到任何东西。

⚠ 这是模块的性质而不是"哪个编辑面"的性质，所以声明在清单上：漏声明时面板会摆出
「新增一行」，加出来的那一行没有对应实体、永远喂不到任何东西——绑完看着是配好了，
画面上一点反应都没有。

**行的身份是"名字 + id"两样**（`bindingRowLabels` 返回 `{title, id}`）：
`id` 必须与实体清单里显示的那一份逐字相同（孪生的信息牌字段是 `<牌 id>::<字段 key>`）。
只给名字时，两个同名实体在绑点面板上长得一模一样，用户只能靠数行号确认自己绑对了没有。

### 5.2.1 子编辑器里的绑定与实时预览

带 `subEditor` 的模块（`twin-view`）在子编辑器右栏顶层分成**属性 / 绑定**两页：
属性页跟着当前选中的实体，绑定页是整段配置的全部绑定。分页状态归右栏持有——
换选中不该把用户从绑定页踢回属性页，配一屏点位时选中会一直在动。

子编辑器的视口订**同一个推送主题**、走**同一份缝合**（`twinSceneValues`），
所以在这里核对过的对应关系，到大屏上就是那个结果；各缝各的话两边都不报错，
只是编辑器绿灯而大屏接错对象。

⚠ 只有**已落库**的绑定会有推送：推送方按大屏行版本重读绑定计划，内存里的草稿它看不见。
所以刚绑上的点位在保存之前一直是占位符——绑定页上必须摆明，否则表现成「绑完了但没反应」。

### 5.3 五个必须避开的扩展性陷阱

参考实现的模块系统已经相当好，但它有五处**实测存在的扩展性阻塞**。
逐条说明它们是什么、本仓怎么避开——这些不是猜测，是从参考实现的代码里读出来的。

**① 注册只能靠构建期 glob，第三方模块进不来。**
参考实现用 `import.meta.glob('./modules/*/index.ts', { eager: true })` 发现模块。
这意味着模块**必须住在这个包的这个目录下**，没有运行期注册入口、没有清单 URL、没有模块联邦。
第三方要加模块只能 fork 或 vendor 进单仓。

本仓：`registerModule(manifest)` 是**公开 API**，内置模块的 glob 只是它的第一个调用方。
应用壳可以在启动时注册任意来源的清单。glob 是便利，不是机制。

**② 新增模块会让一个"花名册"测试变红。**
参考实现有一份 `interactionSources.test.ts`，要求每个注册的模块类型都必须出现在
四个数组之一里。加一个模块 = 改一个不在你目录里的文件。

本仓：一期不做节点联动，所以没有这份花名册。将来若要加，
**能力声明在 manifest 上**（模块自己说它上不上抛交互），不许再造一份外部名单。

**③ 运行时里散着模块类型的字符串字面量。**
参考实现在 5 处硬编码了具体类型：`'segmented-tabs'`（联动的互斥切换要读它的 config）、
`'page-nav'`（导航上下文的开关）、`'twin-view'|'twin-sim'|'topology-view'`（属性面板的子编辑器按钮）、
`'header'|'footer'`（迁移时的钉位判断）、`'report-view'`。
后果很直接：第三方写的标签页模块**参与不了互斥切换**，第三方模块**没法有子编辑器**。

本仓：**运行时与编辑器里零模块类型字面量**。需要区分能力时在 manifest 上加声明字段
（`region`、`isContainer`、`subEditor`），代码只读声明。这条要有闸门守：
在 `packages/runtime` 与编辑器页面里 grep 具体 type 字符串，命中即失败。

**④ 配置控件类型是闭合联合 + 闭合 switch。**
参考实现的 `ConfigFieldType` 是 14 个成员的闭合联合，`ConfigFieldRenderer` 里是对应的闭合分支。
加一种控件要同时改契约包和编辑器两个包。

本仓：核心控件类型仍是闭合联合（类型安全值得保），但**渲染分发走注册表**
（`Map<ConfigFieldType, Component>`）而不是 switch。加一种控件 = 注册一个组件。

**⑤ 外观键目录是闭合的 39 键，且有一处"选了没反应"。**
参考实现的 `CARD_BORDER_STYLE_OPTIONS` 没登记的样式在面板里选得到、渲染时静默回落成 `solid`——
它的注释自己承认这是"全仓唯一一处『我选了但没反应』的拦截点"。

本仓：一期不做卡片外观的完整目录。真要做时，**面板的选项从目录推导**，
而不是面板一份、渲染一份——两份就一定会漂。

### 5.4 三件不许做的事

| 反模式 | 为什么 |
|---|---|
| 运行时里 `if (type === 'twin-view')` | 见陷阱 ③。有一处就会有第二处，registry 当场失效 |
| 模块之间互相 import | 模块是叶子，共用的东西下沉到 `shared/` |
| 模块直接发 HTTP 请求 | 取数走注入的 provider，否则模块无法在编辑器预览态与测试里运行 |

### 5.5 开放度来自注册表，不来自把类型放开

参考实现有一处值得学：**加一种数据来源只要写一个 provider + 一行 `registerProvider`**，
且模块状态的计算对来源类型无感知（只数"有几个实时绑定"，不认识具体是哪种）。
于是加一种来源不必碰渲染层。这个机制照搬。

但它连**类型**也一起放开了（`BindingSourceKind` 是 `... | (string & {})` 的开放联合），
这一步本仓不跟。理由在 §2.3：`source_kind` 拼错成 `"opuca"` 会照常入库、
被下发计划的 `IN (...)` 过滤掉、永远不产数据、全程零告警。
**开放的是注册表，不是类型。**故 `BindingSourceKind` 是闭合联合，未注册即 `400`（§4.1）。

两者不矛盾：注册表决定"系统认识哪些来源"，闭合类型决定"拼错时当场失败还是三天后才被发现"。
真要新增一种来源，就在联合里加一个成员并注册一个 provider——两行，且改漏一处编译不过。

结论仍是那句：**加一种数据来源本就比加一个模块容易，而这个不对称没有道理。**
本仓把模块侧拉齐到取数侧的开放度，而不是把取数侧的类型安全丢掉。

### 5.6 状态由谁交代：整格浮层，还是模块自己

`ModuleStatusOverlay` 的缺省口径是**整格盖住**并说明原因。这对一格一个点位的
模块是对的：那时「取不到」确实没有别的东西可画，留白等于什么都不说。

但对**一块摆 N 个点位**的模块，它是灾难：十个指标里有一个采集器断了，
`tally.error > 0` 就把整块盖成「取数失败」，另外九个明明有值却一个都看不见。

所以清单上有一条自述，运行时只读声明、不认模块类型：

```ts
ownsStatusDisplay?: boolean   // 逐格状态我自己交代，别盖我
```

开了它的模块必须自己把四档都画出来（**没配来源／还没首帧／取不到／有值**），
逐槽结论由 `ModuleMeta.slots` 下发，键是 `fieldKey`：

```ts
ModuleSlotMeta = { state: 'ok' | 'pending' | 'error', message?, timestampMs? }
```

⚠ 这四档在 `values` 里长得一模一样（键都不存在），不下发这份结论的话模块分不出来。
而三种「没有值」的处置办法完全不同：去配绑定、再等一会儿、去查现场。
⚠ `timestampMs` 逐槽各带各的，不是整块那个 `valueTimeMs`（那是最新的**一个**）——
多点位模块里「哪一格不动了」正是要靠各自的时刻才看得出来。
⚠ `unbound` 那一档仍归浮层：必绑槽一条都没配时模块连布局都摆不出来。

**`stale` 这一档由浮层画，但它不盖格**：通道断了是整条链路的事，不是某一格的事，
自报交代状态的模块自己也说不出来，所以两类模块一视同仁——照常显示最后已知值，
另加一层去活化 + 右上角一枚「数据可能过期」的角标（`--state-warning`）。
角标绝对定位、不参与布局、不吃指针事件，否则它会挡住模块自己的内容与点击。

口径与优先级：

- 连接态由 `ModuleMeta.connectionState` 下发，真源是应用壳那条 WS 通道，**只有
  `open` 算通**；设计态与独立渲染**不下发**这一支，于是编辑器画布上永远不冒角标。
- **只有「有值可显示」才叫 `stale`**：折状态时数的是带采样时刻的槽（`tally.sampled`）。
  一个值都没有时该盖整格说加载／空态，只标一句「可能过期」等于把空格说成有数据；
  纯常量的一格也不会因为通道断了就过期。
- `unbound` / `error` / `loading` 这类**硬问题优先**：它们是这一格自己的毛病，
  说它们比说「可能过期」有用。

### 5.7 一期实现的模块

`header`（页头）与 `twin-view`（数字孪生）。选这两个不是随意的：
一个是纯配置无绑定的最简模块，一个是带 3D 资源与数组绑定的最复杂模块——
两端都跑通，中间的图表类模块就只是填空。

`twin-view` 的 three.js 依赖收在 `@dt/three-core` 并**异步加载**：
不打开孪生模块的大屏不该为它付首屏包体。

其后补的 `metric-card`（实时数值）是第一个数据模块：一块摆 1..N 个点位读数，
行与配置里的指标一一对应，绑点面板因此与孪生同一套口径。它也是 §5.6 那条
自述的第一个使用者，设计见 [MODULE_METRIC_CARD_DESIGN](MODULE_METRIC_CARD_DESIGN.md)。

`action-button`（按钮）是第一个**控件**类模块：它不取任何数，只把点击上抛成
联动事件，显隐 / 弹窗 / 跨屏跳转由规则决定。它也是 `chromeConfigurable: false`
（退出平台卡片外观）的第一个使用者，设计见
[MODULE_ACTION_BUTTON_DESIGN](MODULE_ACTION_BUTTON_DESIGN.md)。

`nav-tabs`（页签栏）是第二个控件类模块：一排互斥的页签，点一格上抛一次带值的
「选项点击」，跨屏切换配「按值跳转大屏」、页内分区配「按值互斥切换」。
⚠ 目标大屏存在**规则**里而不是节点配置里——节点配置逐字透传给公开载荷，
把大屏 id 配进页签既泄露内部标识（ADR-0014）、在公开态也跳不动。设计见
[MODULE_NAV_TABS_DESIGN](MODULE_NAV_TABS_DESIGN.md)。

`twin-2d-view`（2D 孪生）是第二个**文档型**模块，也是 §5.1 那条判据在
「一整张图」上的兑现：一块画布上摆 N 个节点、N 条连线，而**节点与连线长什么样
本身也是文档**——一组可配置的图元描述（几何 / 槽位 / 变体 / 端口）。内置的那批
节点样式因此只是预置数据，渲染组件里没有一处按样式 id 分支；用户能从零画出一个
新形状、新配色、新字段布局，画电路符号走的是同一条路。它是
[ADR-0016](adr/0016-复杂config段由清单声明的整页子编辑器接管.md) 的第二个使用者，
设计见 [MODULE_TWIN_2D_DESIGN](MODULE_TWIN_2D_DESIGN.md)。两条结构性判断各有一份 ADR：
样式从形状枚举下沉成图元文档见
[ADR-0027](adr/0027-2D孪生的节点与连线样式是可配置图元文档.md)，
编辑画布自绘、不引入图编辑框架见
[ADR-0028](adr/0028-2D编辑画布自绘而不引入图编辑框架.md)。

`info-card` / `info-list` / `gauge-card` / `info-feed` 是信息卡片模块族：
把「一格读数」「一行列表」「一只仪表」「一条推送流」四种排布各归一个模块，
观感由一组正交档位拼出来，成套的观感做成一键预设。切成四个而不是一个，是因为
属性面板不折叠——一个模块吃下四种排布会有一半字段在任一档下都配了不生效。
设计见 [MODULE_INFO_CARD_DESIGN](MODULE_INFO_CARD_DESIGN.md)。

---

## 6. 实时链路

```
collector ──写──> Redis 快照 collect:snapshot:{source_id}
                        │
                        │ 读（只取本屏绑定的字段，不 HGETALL）
                        ▼
        platform-server ROLE=publisher（单活，Redis 租约）
                        │ HTTP POST /internal/v1/realtime/publish
                        │ X-Service-Key + traceparent
                        ▼
                   realtime-hub  ── WS ──> 浏览器
```

- **主题** `dashboard:{dashboard_id}`，形状照 api-contract §10 的 `<域>:<标识>`。
  由 publisher 在大屏创建时向 hub **登记**并声明所需权限码 `dashboard:view`，
  删除时注销（[ADR-0007](adr/0007-实时通道薄化与开放主题命名空间.md)）。
- **`seq` 归 hub**，跨重启单调。客户端据它发现丢帧，不许自己推断。
- **节流归推送方**：合并窗口、条目上限、分片都在 publisher 做。
  hub 一旦知道"哪些载荷可以合并"，就又长出业务知识了。
- **合并窗口出厂 2s**（`PLATFORM_PUBLISH_WINDOW_MS`），可在 系统 → 运行参数 里在线改。
  它是全平台实时数据的时间分辨率上限——各数据源只会比它慢，不会比它快。
  调小会按观看者数量成倍放大服务端与 Redis 的压力。
- 推送信封：`{type:"data", topic, ts, seq, payload:{items:[...]}, trace_id, traceparent}`。
  hub 从不解释 `items` 的内容。
- **hub 不可达时降级为"没有实时通道"，绝不降级为"大屏打不开"。**

### 6.1 运行态零 HTTP

大屏运行时的取数**全部走 WS**，包括首帧初值——publisher 发现新观看者时推一次全量。
参考实现让首屏走 HTTP 拉快照、后续走 WS，于是同一份数据有两条口径，
两条口径的字段名、时间戳精度、质量位在演进中各漂各的。

---

## 7. 前端包分层

依赖表已由 [`project-structure-typescript.md`](agents/project-structure-typescript.md) §2 定死，
本次新增四个包，**只能向上依赖**：

| 包 | 依赖 | 装什么 |
|---|---|---|
| `@dt/twin-config` | contracts | 孪生场景的纯数据与数学，无 Vue 无 three |
| `@dt/datasources` | contracts | 取数 provider 的实现（实时/静态/计算/历史） |
| `@dt/three-core` | contracts, tokens, twin-config, ui | three.js 封装，异步加载的重资源 |
| `@dt/modules` | contracts, three-core, tokens, twin-config, ui | 模块清单与渲染组件 |
| `@dt/runtime` | contracts, modules, security, ui | 节点树递归渲染、几何、绑定求值、模块状态 |

⚠ **`@dt/runtime` 不许依赖 `@dt/datasources`**（依赖表里没有这条边）。
provider 由应用壳注入，接口类型定在 `@dt/contracts`（L0）。
这不是绕路——它正是让 runtime 能在测试里跑假 provider、
让"新增一种取数方式"不必碰渲染层的那条缝。

WS 客户端留在应用壳（它要读 auth store），`@dt/datasources` 的 provider
接收一个 `subscribe` 函数作为入参，不自己建连接。

---

## 8. 一期不做

- 图表与表格类模块（读数类已有 `info-card` / `data-card`，见 §5.7）。
- 大屏模板库、素材对象存储、导入导出。
- 节点联动（点击显隐、弹窗）。
- 拓扑图编辑器。
- 公开分享面（表结构里留了 `is_public` / `public_token`，接口不开）。
