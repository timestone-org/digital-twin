# 卡片样式库 —— 设计

一条**卡片样式**是用户自己存下来的一整套观感取值，分两段：**外壳**（`__cardStyle`，
40 个键，任何模块都吃）与**内芯**（某一个卡片模块自己的观感配置键）。样式存在
platform-server 的新表里、全站共享；在独立的「卡片样式库」页里边配边看；在大屏
编辑器里一键套用；AI 助手有一组工具能读、能建、能改、能套。

本设计不新造观感机制——外壳的词汇表（`@dt/contracts` 的 `CHROME_KEYS`）、内芯的
字段表（各模块 `configSchema`）、套用的落库路径（`applyPreset` 的浅合并）三样都已存在，
本设计做的是**把「一套取值」变成一等资源**：能命名、能存、能改、能被助手引用。

---

## 0. 为什么要有它：现状的三个堵点

| 堵点 | 现在 | 后果 |
|---|---|---|
| 外壳存不下来 | `cardStyleVariants.ts` 里写死两档：「平台默认」「极简描边」。第三档「自定义」置灰不可选，只用于回填显示 | 40 个旋钮调出来的样子换一张屏就得从头调；调完了也没有名字可以指 |
| 内芯要发版 | 各模块 `presets.ts` 里的 21 套预设是源码常量 | 现场想加一套观感，得改代码、过 CI、发版 |
| 助手只能一个键一个键写 | `dashboard.set_config` 一次写一条路径 | 一套外壳 40 个键 = 40 次工具调用；且助手没有「有哪些现成样式」这个概念，只能从零凑 |

⚠ 三个堵点是**同一个缺口**的三面：仓里没有「一套观感」这个可寻址的东西。所以本设计
先立这个名词，三面自然都通。

---

## 1. 名词与边界

### 1.1 一条样式的形状

```
CardStyle
├─ name          命名，人给的
├─ description   一句话，选样式时看这个
├─ moduleType    绑哪个模块类型；**可空**
├─ chromeJson    外壳：CardChrome，键出自 CHROME_KEYS
├─ configJson    内芯：该模块的观感键；moduleType 为空时必须为空
└─ thumbnail     缩略图，存样式时从预览区截一张
```

`moduleType` 可空是本设计的第一个支点：

- **空** = 通用外壳样式。只有 `chromeJson`，套到任何模块上都只写外壳。「极简描边」
  「暗金报表风」这类整屏基调属于这一档。
- **非空** = 某个卡片模块的整套观感。外壳 + 内芯一起走，只能套回同类型的节点。

⚠ 不做成「必须绑模块类型」：那样一套外壳基调得按模块数复制 13 份，改一次改 13 处。
⚠ 也不做成「永远不绑」：内芯键是逐模块的，`info-card` 的 `cellShell` 写到
`gauge-card` 上既不报错也不生效——正是本仓最想消灭的那类静默失效。

### 1.2 外壳与内芯的分界线

**外壳**就是 `CHROME_KEYS` 那 40 个键，一个不多一个不少，词汇表在
`web/packages/contracts/src/chrome.ts`。铁律照旧：**键不存在 = 未设置 = 渲染侧不注入
变量**，所以样式里「不写这一条」和「写了个空串」是两回事，存的时候就得分清。

**内芯**是该模块 `configSchema` 顶层键里的**观感键**，定义为「全部顶层键 − 内容键」。

内容键**必须由清单显式声明**，新增 `ModuleManifest.contentKeys`：

| 模块 | 顶层配置键 | contentKeys | 观感键 |
|---|---:|---|---:|
| `info-card` | 32 | `title` · `items` · `emptyText` · `rules` | 28 |
| `metric-card` | 13 | `title` · `items` · `emptyText` | 10 |
| `gauge-card` | 29 | `title` · `items` · `emptyText` · `rules` | 25 |
| `info-list` | 32 | `title` · `items` · `noRowsText` · `rules` | 28 |

⚠ 三个模块的缺值占位键名各不相同（`emptyText` / `emptyText` / `noRowsText`），
所以名单只能逐模块写，不能按键名通配。⚠ `metric-card` 现在**没有 `configPresets`**，
也没有 `rules`（它的状态点走 `showStatusDot`）——四个里只有它是从零开始有样式可选。

⚠ **不靠 `group` 名判**：group 是给人看的中文串（'内容' / '排布' / '数值'…），
改一个字就会把内容键当观感键存进样式，套用时把用户配好的格整片抹掉——而两侧都不报错。

⚠ 这份名单现在**已经存在，但住在测试里**：`tests/modules/info-card/presets.test.ts`
里手写着 `const CONTENT_KEYS = ['title', CARD_ITEMS_KEY, 'emptyText']`，每个模块一份。
本设计把它提到清单上作唯一真源，测试改读清单——服务端校验、样式库页面、助手三处
要的是同一份名单，再抄一份必漂。

### 1.3 已拍板：`rules` 算内容，样式不碰它

现在四个模块的内置预设都写 `rules: []`，也就是**点一下预设，用户配好的阈值规则被静默清空**。
上表把 `rules` 归进内容键，即样式不碰阈值。

- 支持：阈值是数据判据（这个点位超过 80 报警），跟点位走，不跟观感走。清空它是缺陷。
- 代价：内置预设得删掉 `rules: []` 这一行，套预设的行为变了——从「清空阈值」变成「保留阈值」。
  存量大屏的**存量配置一个字不改**，变的只有下一次点预设时的结果。

**已拍板：改。** 这是往正确方向的行为变更，且是本设计顺手能修的一个既有缺陷。

---

## 2. 套用语义：三条铁律

### 2.1 外壳整袋替换，不是逐键合并

套一条样式到节点上，`__cardStyle` **整袋换掉**（`{...configJson, __cardStyle: style.chromeJson}`），
不是逐键浅合并。

⚠ 逐键合并会留残留：上一套样式设了 `titleRule: 'hatch'`、新样式没提这个键，
合并后斜纹带还在——用户看到的是「换了样式但没换干净」，且面板上的「外观风格」下拉
会因为取值不等于任一样式而回填成「自定义」。整袋替换让「样式 → 屏上的样子」是个函数。

### 2.2 内芯浅合并，且必须写全观感键

内芯沿用 `applyPreset` 现有的顶层浅合并——内容键（标题、格、绑定）原样保留。
但**样式存下来的时候必须把观感键写全**，缺一个键就是上一套的取值原样残留。

⚠ 这正是 `presets.ts` 文件头已经写明的那个坑（「少写一个键，上一套留在 configJson 里的
那个值就原样残留，而点亮判定做的是子集比较、照样把按钮点亮——既错了又没有任何提示」）。
用户存样式时不可能记得写全 30 个键，所以**存的那一刻由前端补全**：以该模块
`configSchema` 的 `default` 兜底，把每一个观感键都落进 `configJson`。

### 2.3 套到大屏级只写外壳那一半

样式还能套成整屏缺省（`chrome_json.card`）。这一档**只写 `chromeJson`**，内芯整段忽略——
大屏级没有「哪个模块」这个上下文。带内芯的样式在大屏级选择器里标注「只会套用外壳部分」。

---

## 3. 「卡片样式库」页

### 3.1 版面

```
┌──────────────────────────────────────────────────────────────────────┐
│ 卡片样式库                                    [新建样式 ▾]  [保存]    │
├──────────┬────────────────────────────────────┬──────────────────────┤
│ 样式列表  │            预览区                  │   配置栏              │
│          │                                    │                      │
│ 通用外壳  │   ┌──────────────────────────┐    │  ┌ 外壳 ─────────┐   │
│ ● 极简描边│   │  ▎光伏发电总览           │    │  │ 外观风格 [▾]  │   │
│ ○ 暗金    │   │  ┌────┐ ┌────┐ ┌────┐   │    │  │ 圆角  ▭ 4     │   │
│ ○ 蓝调    │   │  │23.4│ │ 61 │ │1013│   │    │  │ 边框样式 [呼吸]│   │
│          │   │  │ ℃  │ │ %  │ │hPa │   │    │  │ 四角辉光 ○    │   │
│ info-card │   │  └────┘ └────┘ └────┘   │    │  │ ▸ 边框        │   │
│ ○ 气象四宫│   │                          │    │  │ ▸ 四角        │   │
│ ○ 能耗对比│   └──────────────────────────┘    │  │ ▸ 标题条      │   │
│          │                                    │  │ ▸ 文字        │   │
│ metric-…  │   模块 [信息卡片 ▾]                │  └───────────────┘   │
│ ○ 大字读数│   底色 [大屏底 ▾]  尺寸 [420×220]  │  ┌ 内芯 ─────────┐   │
│          │                                    │  │ 排布 [自适应] │   │
│ ＋ 新建   │                                    │  │ 列数 [自动]   │   │
│          │                                    │  │ 标签位置 [下] │   │
│          │                                    │  │ …             │   │
└──────────┴────────────────────────────────────┴──────────────────────┘
```

三栏，左窄右窄中间大——与大屏编辑器同构，用户不用重新学。

⚠ **覆盖哪些模块由清单推导，不写名单**：判据是「清单里声明了 `contentKeys`」——
没声明的模块说不出哪些键是观感，给它存样式只会把标题与行列表一起存进去。
一处模块类型字面量就意味着第三方模块永远进不来，`moduleTypeLiterals.contract.spec.ts`
连注释里的类型名都拦。**副作用：消息流模块也声明了 `contentKeys`，于是它也在覆盖范围内**
——它本就与本族同源（MODULE_INFO_CARD_DESIGN §1.1 的四个模块），多它一个不违和。

### 3.2 左栏：样式列表

- 按 `moduleType` 分组：「通用外壳」在最上，然后每个卡片模块一组。
- 每条一行：名字 + 一句话；有缩略图的画 40×24 的小图。
- 组内内置样式（来自 manifest 的 `configPresets` 与 `CARD_STYLE_VARIANTS`）与用户样式
  **并排列出，内置的标一枚锁形角标**：内置的能「复制一份改」，不能改也不能删。
  ⚠ 不把内置的藏起来：用户要的第一个动作八成是「照极简描边改一点」，藏了他就得从零调 40 个旋钮。
- 底部「＋ 新建」：新建时先选「通用外壳 / 哪个模块」，这一步定了 `moduleType`，之后不可改
  （改了内芯键就整段作废，不如复制一份）。

### 3.3 中栏：预览区

用现成的 `ModuleRenderer`（`@dt/runtime`，props `moduleType` / `config` / `bindings` /
`cardChrome` / `getManifest`，最后一个必填），值走 manifest 的 `preview.values` 假件——
样式库页面**不连实时数据**：一个正在调观感的人不需要真值，而真值会让预览随点位跳动、
看不清刚改的那一项。

⚠ **要新写一件**：取数源是注入下来的（`provideRuntimeData`），不装就是「诚实空源」——
每条绑定都返回 `state: 'error'`，卡片上画的是缺值占位而不是演示数字。仓里现在**没有**
按 `manifest.preview.values` 供值的路子（`preview` 至今只有 `CanvasNode.vue` 用了它的
`config` 那一半）。补的这一件是 `previewBindings(specs, preview)`：把演示值摊成一组
`static` 绑定，走**与画布同一条求值链**，模块看到的 `values` 与 `meta.slots` 因此与真
跑起来时逐字同形。另开一条「直接塞 values」的后门，预览会在状态四档上与运行态分叉，
而那正是预览要验的东西。

⚠ 它住在 `web/app/src/features/dashboard/`，**不在 `@dt/runtime`**：运行时对来源种类
无感知是硬规矩（DASHBOARD_DESIGN §5.5，由 `sourceLiterals.contract.spec.ts` 守着），
而这件事非写 `sourceKind: 'static'` 不可。

三个旋钮摆在预览区下沿：
- **模块**：`moduleType` 为空的通用样式可以换模块看，看外壳套在不同模块上的样子。
- **底色**：`大屏底 / 深色 / 浅色`——外壳的色都是 `var(--)` 引用，换肤时跟着走，
  所以得能在两种底下都看一眼。
- **尺寸**：默认取该模块 `defaultSize`，可拖。⚠ 卡片的观感在窄块上塌得最快
  （读数字号 `valueSize: 0` 是跟着格宽自适应的），不能只在一个尺寸下验收。

### 3.4 右栏：配置栏

**外壳段**直接复用 `CardStyleFields.vue`——它已经是「外观风格下拉 + 常显九项 + 四个可折叠
高级分组」的成品，`modelValue` 收 `CardChrome`、不传 `context` 就是全量摆出。

**内芯段**复用 `configForm.ts` 的 `formGroups` + `controls/`，但**只喂观感字段**：
按 §1.2 的 `contentKeys` 把内容字段滤掉。滤掉而不是禁用——一个存不进样式的输入框
摆在那儿只会让人以为它坏了。

⚠ 内芯段只在 `moduleType` 非空时出现，通用外壳样式的右栏只有外壳段。

### 3.5 顶栏动作

| 动作 | 语义 |
|---|---|
| 新建样式 ▾ | 下拉：从空白 / 从某条内置样式复制 / 从某张大屏的某个节点抓 |
| 保存 | 存当前编辑中的样式。新建态则弹命名框 |
| 另存为 | 以当前取值建一条新的 |
| 改名 · 删除 | 行内菜单，删除走确认框 |

⚠ 「从某个节点抓」这一条是最省事的入口：用户在大屏上调好了一个卡片，来这里把它
存成样式——省掉在两个页面之间抄 40 个旋钮。

### 3.6 落在哪个路由

`/dashboard/card-styles`，进大屏那一组菜单，不进 `/system`：它是**内容资产**（和整屏模板、
素材库同类），不是系统设置。权限沿用 `dashboard:view` 看、`dashboard:manage` 改——与
整屏模板同级，理由也同：往全站共享的资产库里加一条，与改自己那张屏不是同一类操作。

---

## 4. 编辑器里怎么用

### 4.1 节点右栏「通用」页签

`CardStyleFields.vue` 顶上那个「外观风格」下拉，选项从两档扩成三段：

```
外观风格
  平台默认
  极简描边
  ──── 我的样式 ────
  蓝调科技卡
  暗金报表风
  ──────────────
  自定义（置灰，仅回填）
  ＋ 存为新样式…
```

⚠ 下拉里只列 `moduleType` 为空的通用样式与该模块类型的样式——列了套不上的，
点下去只写外壳、内芯静默不生效，正是本仓最不能忍的那类。

### 4.2 节点右栏「专属」页签

现有的预设按钮墙下面加一排用户样式按钮，同一套 `activePresetIds` 点亮逻辑。

### 4.3 页面级设置面

`ChromePanel.vue` 的「全屏卡片外观缺省」同样接上样式下拉，按 §2.3 只写外壳。

---

## 5. 服务端

照 `dashboard_templates` 那条链原样再走一遍——它是仓里最接近的资源：有名字、有一袋
JSON、全局共享、跨项目复用、读写两档权限。

### 5.1 表

`card_styles`（`models/card_style.py`）：

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | UUID pk | `UuidPrimaryKeyMixin`，UUIDv7 |
| `name` | text not null | `CheckConstraint(length(name) > 0)` |
| `description` | text null | |
| `module_type` | text null | 空 = 通用外壳样式 |
| `chrome_json` | jsonb not null default `{}` | 外壳 |
| `config_json` | jsonb not null default `{}` | 内芯；`module_type` 为空时必须为空 |
| `thumbnail` | text null | data URL，存样式时从预览区截 |
| `created_at` / `updated_at` | timestamptz | `TimestampMixin` |

约束与索引：
- `CheckConstraint("module_type IS NULL OR length(module_type) > 0")`
- `CheckConstraint("module_type IS NOT NULL OR config_json = '{}'::jsonb")` —— 通用样式
  不许带内芯。⚠ 这一条在库里守，不只在服务层：库里躺着一条带内芯的通用样式，
  套用时内芯静默不生效，是查起来最费劲的那种。
- `Index("ix_card_styles_module_type", "module_type")`
- 唯一键 `(module_type, name)`？**不建**。同名两条样式是用户自己的事，
  唯一键会让「另存为」在重名时抛 409，而那一刻用户想要的是「再存一条」。

⚠ `module_type` **不建外键也不建原生 ENUM**：模块表的真源是前端构建期产物
（`module_types.json`），库里没有可指的表；`禁原生 ENUM` 是数据库规范的硬条。
未注册的 `module_type` 由服务层按目录校验，页面上把认不出类型的样式标灰而不是藏掉。

迁移：一份纯扩展迁移（建表），无回填。开头设 `lock_timeout`，照 `versions/` 下最近
一份的命名 `YYYY_MM_DD_HHMM-<rev>_add_card_styles.py`。

### 5.2 端点

```
GET    /api/v1/platform/card-styles              列表，query: module_type
POST   /api/v1/platform/card-styles              新建（Idempotency-Key）
GET    /api/v1/platform/card-styles/{id}         详情
PATCH  /api/v1/platform/card-styles/{id}         改
DELETE /api/v1/platform/card-styles/{id}         删
```

- 读走 `dashboard:view`，写走 `dashboard:manage`——与整屏模板同级，理由也同：
  往全站共享的资产库里加一条，与改自己那张屏不是同一类操作。**不新增权限码。**
- 列表返回全字段（含两袋 JSON）：一条样式撑死几 KB，分两次拉只换来一次多余往返。
  仍走分页（`Page` / `PageParams`），默认按 `updated_at` 降序。
- 错误码：`41021` 样式不存在（404）、`41022` 取值与模块清单对不上（400）。
  ⚠ 后者**逐条指到字段**回：外壳与内芯加起来六七十个键，只回一句「样式不合法」的话，
  存不下去的人得靠二分法找出是哪一个键写错了。⚠ 类型都没认出来时不查内芯——
  观感键取自那个模块，认不出就是空集，一个键会连着报两条错，而真正要改的只有类型那一条。

⚠ **改的入参不收 `module_type`**：换了类型整段内芯当场作废，而库里那袋值不会跟着消失，
它会一直躺着、套用时静默不生效。要换归属就复制一条。入参是 `extra="forbid"`，
前端 PATCH 多带这一个键会让整条请求 400——线形映射因此建与改各写一份。

### 5.5 边缘那一道也要开口子

⚠ 闸 1 按 `dashboard*` 前缀的那两条规则**一条都盖不到 `card-styles`**——这个资源
刻意不带 `dashboard-` 前缀（它与素材库同类，是跨大屏的资产）。没有专门的规则，
它会掉进方法兜底，表现是「页面打得开、一存就 403」，而两侧代码单看都对。
auth-server 的 `rules_dashboard.py` 里补两条：`card-styles*` 的 `*` 归 manage（910）、
`GET` 归 view（912，必须压过写兜底）。⚠ **部署时必须重跑 auth 种子**，否则照旧 403。

### 5.3 服务层校验

`services/card_style_service.py` 落三条，全部**指到字段**地 400：

1. `module_type` 非空时必须在模块目录里（`services/module_catalog.py` 已有目录）。
2. `chrome_json` 的键必须都在 `CHROME_KEYS` 里 —— 目录得先把这份词汇表**导出到服务端**。
   ⚠ 现在 `CHROME_KEYS` 只活在前端 `@dt/contracts`，服务端没有副本；助手那条
   `dashboard.chrome_keys` 是**客户端**工具，读的是前端的表。要在服务端校验，
   就得让 `catalog.ts` 把它一起序列化进 `module_types.json`（新增顶层段 `chrome_keys`），
   与 `field_types` / `binding_data_types` 同一份产物、同一道快照测试锁死。
   这也顺手让助手的服务端侧能读到外壳词汇表，不必非得开着编辑器那一页。
3. `config_json` 的键必须都在该模块的**观感键**里（顶层键 − `contentKeys`）。
   ⚠ 所以 `contentKeys` 也要进目录。

### 5.4 契约测试

`tests/contract/test_dashboard_card_styles.py`，照
`test_dashboard_module_catalog.py` 的起库方式。至少这几条：
建 → 列 → 改 → 删的回路；`module_type` 认不出时 400 且指到字段；通用样式带内芯时 400；
外壳键写错时 400 且报出是哪个键；`Idempotency-Key` 重放只建一条。

---

## 6. AI 助手

分两侧。**服务端工具**管样式库本身（有哪些、长什么样、存一条），**客户端工具**管
把样式套到画布上。

### 6.1 服务端工具（`tool_specs.py` 的 `SERVER_SPECS` + `server_tools.py`）

| 工具 | 参数 | 干什么 |
|---|---|---|
| `styles.list` | `module_type?` | 列样式：id / 名字 / 一句话 / 绑的模块类型。不带两袋 JSON |
| `styles.get` | `style_id` | 展开一条：外壳与内芯的完整取值 |
| `styles.save` | `name` `description?` `module_type?` `chrome` `config?` `style_id?` | 建或改。给 `style_id` 就是改 |
| `styles.delete` | `style_id` | 删 |

⚠ 名字用 `styles.*` 不用 `card_styles.*`：工具名进模型的函数名空间，越短越不容易被
写错，而 `styles` 在这套工具表里不撞任何东西。（点号本身没问题——`modules.catalog`
等十几个工具都带点号。）

上游走 `PlatformClient`（`upstream/platform.py`）加四个方法 + 一条 `_CARD_STYLES` 常量。
⚠ 它**代表用户**说话（带边缘签名身份头），所以写样式一样要求用户自己有
`dashboard:manage`——助手不是绕权限的通道。⚠ 这一层不重试、失败一律抛：
把「取不到样式库」读成「样式库是空的」，助手会转头从零凑一套观感。
⚠ 现有 `_get` / `_post` 之外要补 `_patch` / `_delete`。

### 6.2 客户端工具（`client_tool_specs.py` + `aiSurface*.ts`）

一件：

| 工具 | 参数 | 干什么 |
|---|---|---|
| `dashboard.apply_style` | `node_id` `chrome` `config?` | 把一整套观感一次写到节点上：`__cardStyle` **整袋替换**、内芯浅合并。一次调用一步撤销 |

它另担一件事：**把两类静默失效翻成一句能读的错**。外壳键不在词汇表里、内芯键不是
这个模块的观感键（包括内容键混进来），都当场拒绝并报出是哪个键——模型看不见画布，
它只有响应，而「写进去了但不生效」与「写成功了」在响应上一模一样。

⚠ 这一件是**必需**的，不是锦上添花：现有 `dashboard.set_config` 一次写一条路径，
一套外壳 40 个键就是 40 次工具调用——中途被上下文截断的话，画面停在半套样式上。

实现落在 `aiSurfaceConfig.ts`，名字同时登记进 `aiSurface.ts` 的 `EDITOR_TOOLS`。
⚠ 两处名字必须逐字相同：声明了而这一页没实现，模型会调一个永远失败的工具。

### 6.3 技能

改 `skills/dashboard_compose/skill.md`，加一段「要改观感，先看样式库」：

1. 用户说到「换个样子 / 好看点 / 跟那张屏一样」→ 先 `styles.list`，有现成的就 `styles.get`
   + `dashboard.apply_style`，别逐个字段凑。
2. 库里没有合适的 → 用 `modules.catalog` 的 `config_presets` 起个底，改完可以
   `styles.save` 存下来供下次用。
3. ⚠ `styles.save` 存的是**观感**：内容键（标题、格、绑定）一个都不写，写了就会在
   别人套用时抹掉他配好的格。

### 6.4 测试

服务端工具照 `tests/unit/test_server_tools*.py` 的组织补一份
`test_server_tools_styles.py`：上游给什么、工具吐什么、上游挂了怎么说话。
客户端工具补 `web/app/tests/pages/DashboardEditor/scripts/aiSurfaceConfig.spec.ts` 的用例：
整袋替换而非合并、一次一步撤销、节点类型对不上时拒绝。

---

## 7. 分期与 PR 切分

PR 政策是「≤400 行且只碰一个服务」，本设计横跨三处，故切五个 PR，**顺序不可换**：

| # | 范围 | 内容 | 依赖 |
|---|---|---|---|
| 1 | `web/packages` | `ModuleManifest.contentKeys` 落到四个模块 + 测试改读清单 + `catalog.ts` 序列化 `content_keys` 与 `chrome_keys` + 快照 | 无 |
| 2 | `platform-server` | 表 + 迁移 + 五个端点 + 服务层三条校验 + 契约测试 + `openapi.json` | 1（要目录里的两段） |
| 3 | `web/app` | `api/cardStyles.ts` + 线形 + 「卡片样式库」页 + 路由与菜单 | 2 |
| 4 | `web/app` | 编辑器接上：外观风格下拉三段、专属页签样式墙、页面级设置面 | 3 |
| 5 | `ai-assistant` + `web/app` | 四个服务端工具 + 一个客户端工具 + 技能 + 测试 | 2、4 |
| 6 | `auth-server` | 边缘路由规则两条 + 规则按域拆分 | 2 |

⚠ PR 5 破了「只碰一个服务」——客户端工具的实现必须与它的声明同一个 PR 落地，
分开就会有一个窗口期里模型调得到一个没实现的工具。按既往先例走规模闸门例外。

### 7.1 已落地与未做

**已落地**（分支 `feat/card-style-library`，12 个提交）：契约地基、样式库页、
服务端资源与迁移、边缘规则、助手四件服务端工具 + 一件客户端工具 + 技能、编辑器两处接入。
验证：前端 847 个文件 14265 条测试、platform-server 3000 条（含真库集成 15 条、真迁移）、
ai-assistant 456 条、auth-server 298 条、pyright strict 零错、前后端各道闸门全绿、
`openapi.json --check` 一致。

**刻意没做**，各有理由：

1. **缩略图**。表里留了 `thumbnail` 列、线形也带着，但没有人写它——要截图得把预览区
   渲染成位图，那是另一件事。列先留着，免得将来加它要改一次迁移。
2. **「从某个节点抓成样式」**（设计 §3.5 说它是最省事的入口）。它要在编辑器右栏加一个
   命名弹窗 + 一次写请求，而编辑器那一页已经贴着行数上限。**这是目前最值得补的一件。**
3. **样式库页的「从某张大屏的某个节点抓」**入口，同上。
4. **改归属**。建的时候定死，之后只能复制一条——服务端也不收这个字段（§5.2）。

⚠ 前置那批改动（模块清单给模型读的那一半：`config_presets` / `default_config` /
`sub_editor` / `field_types` / `binding_data_types`）已提交在 `feat/module-catalog-for-llm`
上，六个提交。本分支 `feat/card-style-library` 从它上面开出来叠着写——两者改同一批
文件（`catalog.ts` 与 `module_types.json`），并行必冲突。

---

## 8. 明确的偏离与待拍板

1. **`rules` 归内容键**（§1.3）：内置预设要删掉 `rules: []`。存量配置不变，
   变的是下一次点预设时不再清空阈值。**已拍板：改。**
2. **不建 `(module_type, name)` 唯一键**（§5.1）：重名允许，因为「另存为」撞名时
   用户要的是再存一条，不是报错。
3. **`chrome_keys` 与 `content_keys` 进服务端目录**（§5.3）：为了服务端能校验，
   多出一段要跨仓同步的产物。用同一道快照测试锁死，与 `field_types` 同理。
4. **样式库页面不连实时数据**（§3.3）：预览用 `manifest.preview.values` 假件。
5. **`metric-card` 从零开始**：它现在没有 `configPresets`，四个模块里只有它一套现成
   观感都没有。本设计不为它补内置预设——用户自己存的第一条就是它的第一套。
