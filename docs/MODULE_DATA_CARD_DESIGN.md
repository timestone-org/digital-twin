# 可组合卡片 `data-card` —— 架构设计

一块卡片的内容不再是**写死的段序 + 一堆档位开关**，而是一张**部件列表**：
读数、进度条、徽章、涨跌块、迷你折线、分隔线……用户在这一格里加什么、按什么顺序摆，
由他自己定。加一种新部件 = 新建一个目录，卡片本体一行不改。

配置入口也跟着换：不再是全站共用的一个样式页，而是**右键画布上的那张卡片 →
进它自己的整页编辑器**。

---

## 0. 三句话说清它与现状的关系

| | 现在 | 之后 |
|---|---|---|
| 卡片内容 | 一格纵向四段，段序固定，靠 `labelPlace` / `valueFill` 这类档位微调 | 一格一张部件列表，可增删、可拖排序 |
| 小部件 | `CellMeter.vue` / `CellBadge.vue` 焊死在 `info-list` 私有目录里，别的卡片用不了 | 提到公共注册表，任何卡片都能摆 |
| 配置入口 | 右栏两列表单 + 一个全站共用的样式库页 | 右键那张卡片 → 它自己的整页编辑器 |

⚠ **不是从零造轮子**：仓里已经有两样半成品，本设计做的是把它们接起来——
① `ModuleSubEditor` 机制（`configKey` + `routeName`，按 `dashboardId`+`nodeId` 路由，
两个孪生模块在用）；② `CellMeter` / `CellBadge` 两个真能画的小件。

---

## 1. 三层模型

```
data-card（模块）
 └─ 格 cell（1..N，二维网格排布）
      └─ 部件 part（1..N，纵向流；可标 inline 与上一个同行）
```

**为什么格里是纵向流而不是自由坐标**：纵向流 + 一个 `inline` 标记，已经能表达参考仓那
十几种卡片的全部排法；自由坐标要引入拖拽画布、吸附、层序——那是孪生编辑器那一整套，
为一张 200×120 的卡片付这个代价不值。⚠ 真需要自由摆的那天，它是**另一个模块**，
不是把这个改成两用。

---

## 2. 一条不可绕的约束，与它决定的槽位设计

### 2.1 约束

`ModuleManifest.bindings` 是**静态数组**（`contracts/src/module.ts:337`）。而部件是用户
动态加的。所以**槽位不能由部件生成**——槽键要落库成 `field_key`、要被服务端按目录校验，
`bindings` 静态是这条链的地基（DASHBOARD_DESIGN §3.1「可校验」）。

### 2.2 决定

`data-card` 声明**一个数组槽**，行钉在格上，子槽固定四个：

| 子槽 | 收什么 | 谁读它 |
|---|---|---|
| `value` | 主读数 | 读数、进度条、涨跌块、迷你折线、仪表 |
| `aux` | 对比值 / 目标 / 次读数 | 涨跌块、进度条的目标标记、副读数 |
| `ratio` | 占比（0–100） | 进度条；不接时由 `value` 与量程算 |
| `state` | 状态码 | 徽章、状态点 |

部件从这四个里**挑**，不新增。⚠ 四个都不给 `isRequired`：配了五个部件先接一个槽是常态，
给了会让整块被判 `unbound` 并盖上状态浮层（info-card 踩过的同一条）。

⚠ **为什么不给每个部件一个槽**：那样槽键随配置变，服务端得跟着动态校验，
而「服务端能按静态目录校验 field_key」正是 ADR-0012 五的立足点。

---

## 3. 部件怎么定义 —— 与 `defineModule` 同构

```ts
export interface CardPartDefinition {
  /** 部件档名。⚠ 不许用常见单词——「零模块类型字面量」那道闸按已注册名逐个 grep
   *  源码，`text` 这种词会红在一堆毫不相干的属性上（action-button 的教训）。 */
  kind: string
  label: string
  /** 部件面板上的图标，须在 DtIcon 注册表里；写错不报错也不渲染。 */
  icon: string
  /** 一句话：什么时候用它、什么时候该用旁边那个。给人也给模型看。 */
  hint: string
  /** 这一档自己的配置字段。键与 when 由 `defineCardPart` 统一前缀化。 */
  fields: ConfigField[]
  /** 它读哪几个子槽。绑点面板据此提示这一格该接什么。 */
  slots: readonly CardSlotKey[]
  component: () => Promise<{ default: Component }>
}
```

注册表 `registerCardPart` / `getCardPart` / `listCardParts` / `missingCardParts`，
逐字照 `configControls.ts` 那张分发表写：**加一种部件 = 登记一个组件，不写 switch**。

### 3.1 异构字段：靠现有的 `when`，不新造机制

部件们的字段各不相同，但它们要并进**同一张** `itemSchema`（部件列表是 `type: 'array'`，
而 `itemSchema` 是同构的）。做法是把所有部件的字段并起来，各自带一条
`when: { key: 'kind', in: [自己那一档] }`。

这**完全落在现有机制内**：属性面板、批量配置、助手的 `modules.catalog` 全都自动支持，
一行适配代码都不用写。

⚠ **两个部件都有 `color` 字段就会撞**，所以 `defineCardPart` 自动把字段键前缀化成
`<kind>-<key>`（用 `-` 不用 `.`：避开任何按点号切路径的地方）。作者只写 `color`。
自动加而不是让作者写，是因为**漏写不会报错**——两个部件的 `color` 会共用一个取值，
改这个部件的颜色，另一个跟着变。

### 3.2 部件内部还有条件字段怎么办

`ConfigFieldCondition` 只判**一个**键，而这里要同时满足「是这一档部件」与「开了那个开关」。

不需要新机制：**沿 `when` 链上溯**已经支持（本轮刚补）。
`meter-targetValue.when = { key: 'meter-showTarget' }`，
而 `meter-showTarget.when = { key: 'kind', in: ['meter'] }` ——
链式判定让「目标值」在别的档下自动消失。

`defineCardPart` 因此只给**没有自己 `when`** 的字段加 kind 条件，并把作者写的 `when.key`
一起前缀化。⚠ 不前缀化 `when.key` 的后果最阴：它会指向一个不存在的键，条件恒不满足，
那个字段**永远不出现**，而 typecheck 与 lint 双双放行。

---

## 4. 渲染 —— 与 `ModuleRenderer` 同构

`CardPartRenderer.vue`：固定三件套 props，是**部件的唯一装配点**。

```ts
defineProps<{
  /** 这一条部件的配置，键已去前缀、按 kind 收窄。 */
  part: Record<string, unknown>
  /** 这一格的取值与格级口径（单位、小数位、缺值占位）。 */
  cell: CardCellView
  /** 这一格逐槽的取数结论，部件据它画四档。 */
  meta: CardPartMeta
}>()
```

⚠ 查不到那一档时**画占位、不留白**：静默留白就是「我加了部件但没反应」，
那是这套系统里最难查的一类故障（DASHBOARD_DESIGN §5.3 陷阱 ⑤ 的同款）。

⚠ 部件不吃 `ModuleMeta`：那是模块级的四档，而部件要的是**这一格**的。收窄成
`CardPartMeta` 传下去，免得部件里长出「整块都没绑就别画」这种越权判断。

---

## 5. 目录 —— 机制在顶层，内置在模块里

与 `registry.ts`（机制，顶层）／ `modules/*`（内置，各自一个目录）逐字同构：

```
packages/modules/src/
  cardParts/                  ← 机制
    types.ts                  CardPartDefinition / CardSlotKey / CardPartMeta
    define.ts                 defineCardPart（前缀化 + 自动 kind 条件）
    registry.ts               register / get / list / missing
    CardPartRenderer.vue      固定三件套装配点
  modules/data-card/
    manifest.ts
    Component.vue             只做「格的网格排布」
    Cell.vue                  只做「部件的纵向流 + 格外壳」
    cells.ts                  格与部件列表的归一化
    parts/                    ← 内置部件，一个目录一个
      registerBuiltins.ts     import.meta.glob，与模块那份同构
      value/{index.ts, Value.vue}
      meter/{index.ts, Meter.vue}
      badge/{index.ts, Badge.vue}
      delta/{index.ts, Delta.vue}
      spark/{index.ts, Spark.vue}
      rule/{index.ts, Rule.vue}          分隔线
      note/{index.ts, Note.vue}          静态文字
      glyph/{index.ts, Glyph.vue}        图标 / emoji
```

### 5.1 `CellMeter` / `CellBadge` 怎么搬

它们现在依赖 `info-list` 私有的 `rowAlarm.ts`（把取值算成 `MeterView`）。搬的时候
**切一刀**：「取值 → 视图」留在取值层，「视图 → 画」进部件。切完两边都变小，
而 `info-list` 继续用同一份画法——**不复制第二份**。

⚠ 这一刀是整个「可复用」的支点：不切就只能整段抄过来，抄完两份 CSS 会各自漂。

---

## 6. 自定义卡片页

### 6.1 入口：右键，且不写模块类型字面量

右键菜单新增一条 `customize`，**出现条件是「这个节点的清单声明了 `subEditor`」**——
读声明不读类型名（零模块类型字面量那道闸）。两个孪生模块因此白拿这条右键入口，
它们现在只能从属性面板那个小按钮进。

```
右键画布上的一张卡片
 └─ 自定义卡片…            ⌘E
      ↓
/dashboards/:dashboardId/edit/card/:nodeId      （权限 dashboard:edit）
```

### 6.2 版面

```
┌──────────────┬──────────────────────────┬──────────────────┐
│ 结构树        │        实时预览           │  选中项的字段     │
│              │                          │                  │
│ ▾ 格 1 温度   │   ┌──────────────────┐   │  部件：进度条     │
│    徽章·标签  │   │  ▎冷冻水系统      │   │  形态 [细条 ▾]   │
│    大字读数 ●│   │  ┌────┐  ┌────┐  │   │  量程 0 – 100    │
│    进度条    │   │  │23.4│  │ 61 │  │   │  目标线 ○        │
│    分隔线    │   │  │▓▓▓░│  │▓▓▓▓│  │   │  显示占比 ●      │
│ ▸ 格 2 湿度   │   │  └────┘  └────┘  │   │  颜色 var(--…)   │
│ ▸ 格 3 气压   │   └──────────────────┘   │  ▸ 接哪个子槽     │
│              │                          │                  │
│ [+ 格][+ 部件]│   底色[大屏底▾] 尺寸[420×220]│                  │
└──────────────┴──────────────────────────┴──────────────────┘
```

- **左栏**是唯一的结构真源：格与部件都在这里增删、拖排序。
- **右栏**字段仍由 `formGroups` + `ConfigFieldControl` 泛型渲染——**不另写一份表单**。
  选中部件时只摆它那一档的字段（`when` 已经把别档滤掉了，这里白拿）。
- **中栏**用 `ModuleRenderer` + `previewBindings` 的假值，与画布同一条求值链。
- 顶栏 `[完成]` 回画布。⚠ **没有「存为样式」**——理由见 §8。

### 6.3 它改的是这一个节点

与孪生编辑器同构：进去改的就是右键的那一个节点的 `configJson`，回画布立刻看得见，
一次 Ctrl+Z 退回。**不是**「改这个模块类型的样式」——那会让「我右键了这张卡、
改完却没变」。

---

## 7. 守什么 —— 四道闸

本仓的规矩是「规范不是靠记的，是靠红灯守的」。这套东西的静默失效面在这四处：

| 闸 | 拦什么 | 不拦的表现 |
|---|---|---|
| 部件登记完备 | `missingCardParts()` 为空；每个 `kind` 有 label/icon/hint/component | 摆上去一片空白 |
| 图标名真存在 | `isIconName(part.icon)` | 部件面板上那一格没图标，且不报错 |
| 字段键无碰撞 | 全部部件字段前缀化后并集无重名；`when.key` 都指向并集里存在的键 | 两个部件共用一个取值 / 那个字段永不出现 |
| 子槽声明真实 | `slots` 里的键都在 `arrayFields` 里 | 绑点面板提示接 A，部件其实读 B |

⚠ 前两道照 `configControls` 与 `icon-names.contract.spec.ts` 的现成写法；后两道是新的，
但都是纯数据断言，不用挂载。

---

## 8. 明确的偏离与取舍

1. **样式库整个撤掉**（用户拍板）。撤掉之后跨大屏复用靠什么？——**右键复制 / 粘贴**。
   剪贴板已经支持同浏览器内**跨大屏、跨标签页**粘节点，且带走的是整份
   `configJson` + 绑定 + 选中集内闭合的联动规则（`editorClipboard.ts` 文件头）。
   把一张调好的卡片粘到另一张屏上，就是最朴素也最不容易出错的复用：所见即所得，
   不必解释「样式与节点谁赢」。
   ⚠ 代价是**改一处不会同步到别处**——但那本来也不是样式库承诺过的（套用是把取值
   抄进节点，不是引用）。所以撤掉它真正损失的只有「给一套观感起个名字」。
2. **`contentKeys` / `styleKeysOf` / 目录里的 `chrome_keys` 与 `content_keys` 全部保留**。
   ⚠ 它们不属于样式库，是「观感键 vs 内容键」的分界——新卡片模块要用它分出
   「哪些键能被批量改」，助手要用它知道「改样子时别碰什么」。撤样式库时**别一起撤掉**。
3. **`dashboard.apply_style` 保留**（改名 `dashboard.apply_card`）：它是「一次落一整套配置」
   的批量写，与样式库无关。撤了它，助手改观感又退回逐键调用。
4. **`gauge-card` 的弧 / 罐 / 温度计不在第一批部件里**。它们能做成部件，但那会让
   `gauge-card` 也进退役名单——先把机制立住，第二批再谈。
5. **旧的卡片模块不删**（`info-card` / `info-list` / `info-feed` / `gauge-card`）：
   存量大屏一字不动，模块库里把 `data-card` 排在前面并给它写清楚的 `description`，
   新建自然走向它。⚠ 与下面 §9 的「多余模块」不是一回事——那一节讲的是**今天就已经
   多余**的，与本设计无关。

---

## 9. 功能多余的模块

结论先行：**13 个模块里只有一个在能力上真多余（`metric-card`），而它恰恰是最不该直接删的
那一个。** 另外两个看着重叠的候选（`info-feed`、`header`/`footer`）都被**契约层的硬理由**
证伪——不是观感像不像的问题，是清单字段静态、一个模块不可能两者兼有。

### 9.1 证伪的两个候选

**`info-feed` 不多余**（`MODULE_INFO_CARD_DESIGN.md` §1.2）。数组绑定槽有两种，差别只在
`isEntityPinned` 这一个**静态清单字段**上：

- 声明它 → 行钉在 config 的实体数组上，行数由配置决定，绑点面板不摆增删键，索引允许留空。
- 不声明 → 行由用户在绑点面板增删，索引必须连续且从 0 起。

`info-card` / `info-list` / `gauge-card`（以及本设计的 `data-card`）的行全部来自 config 数组，
必须是前者；`info-feed` **没有 config 侧的 items 数组**，行数由推送的数组长度决定，必须是
后者。⚠ 清单字段不可能按实例切换，硬合就是「服务端按一种口径校验、面板按另一种口径摆行」。

**`header` / `footer` 不多余**，同一条理由的另一个例子：`region` 也是静态清单字段
（`contracts/src/module.ts:407`），两者各声明一个，「每张大屏最多一个」按 region 判。
合成一个「横幅」模块再用配置切 region，做不到。

其余：`container`（可嵌子节点的通用容器）、`text-block` / `image-block`（装饰，正交）、
`action-button`（唯一的控件）、`twin-view` / `twin-2d-view`（3D / 2D，正交）、
`gauge-card`（弧 / 罐 / 温度计要 `viewBox` 与 `pathLength`，不是卡片语言，§1.2）、
`info-list`（唯一的多字段行列表）——**都不重叠**。

### 9.2 `metric-card`：能力上多余，但删它是另一回事

契约形状与 `info-card` **完全同构**，且是它的真子集：

| | `metric-card` | `info-card` |
|---|---|---|
| 绑定槽 | `isEntityPinned: true`，子槽 1 个（`value`） | `isEntityPinned: true`，子槽 2 个（`value` / `aux`） |
| 状态 | `ownsStatusDisplay: true` | 同 |
| 顶层配置键 | 13 | 32 |
| 内置预设 | **一套都没有** | 5 套 |

设计文档 §1.4 当年列的三处「不等价」，今天逐条复核：

| # | 当年的理由 | 今天 |
|---|---|---|
| 1 | `density` 三档枚举，行/列间距不同 | **不成立**。`info-card` 的 `gapX`/`gapY` 逐值可复刻，差的只是「一个滑块 vs 两个」的手感 |
| 2 | `showStatusDot` 的 `normal` 档：值 ok 且配过任一边界时画绿点 | **成立**。`info-card` 的 `statusDot: 'auto'` 只在命中规则时画点，表达不出「配了判据且当前正常」 |
| 3 | `valueColor` 缺省不同 | **不成立**。缺省值之差，改一个字 |

三条只剩一条，且那一条在 `data-card` 里由一个吃 `state` 子槽的状态点部件正好表达。
**结论：`metric-card` 在能力上确实多余。**

⚠ **但它是最常用的模块**——它自己的描述就写着「墙上『看一眼现场此刻是多少』的首选」。
直接删的后果是**存量大屏上每一个 metric-card 节点变成「未知模块类型」占位块，不可恢复**。
「能力上多余」与「删了没代价」是两件事，本仓的规矩是「代码可回滚、数据不回滚」
（engineering-workflow）。

### 9.3 建议的处置顺序

1. **先查它到底有没有被用**：`select module_type, count(*) from platform.dashboard_nodes
   group by 1 order by 2 desc;` 一条 SQL 就知道。
2. **没人用** → 直接删（代码 + 测试 + 覆盖表 + 目录快照），零代价。
3. **有人用** → 先写一次性迁移把节点转成 `info-card`，迁完再删。迁移写得出来，因为
   `info-card` 是真子集：`items[].{label,unit,precision,trueText,falseText}` 原样过、
   `grouping` → `thousands`、`items[].key` → `items[].emitValue`、四段阈值 → `rules` 四条。
   ⚠ 唯一转不过去的是 §9.2 表里第 2 条那个绿点，得跟用户说一声。
   ⚠ 迁移**不在 alembic 里做**（迁移里禁回填数据，database-standard），走 worker 批处理
   或一次性脚本。

**我的建议：先跑第 1 步。** 在拿到那张计数表之前删掉一个核心模块，是拿存量大屏赌它没人用。

---

## 10. 分期

| # | 范围 | 内容 | 依赖 |
|---|---|---|---|
| 1 | `web/packages` | 部件机制（types/define/registry/renderer）+ 四道闸 | 无 |
| 2 | `web/packages` | `CellMeter`/`CellBadge` 切「取值 ⇄ 画」两半，`info-list` 改用新的画法 | 1 |
| 3 | `web/packages` | `data-card` 模块 + 八个内置部件 | 1、2 |
| 4 | `web/app` | 自定义卡片页 + 右键入口（按 `subEditor` 声明出现） | 3 |
| 5 | 四个服务 | 撤样式库（含删表迁移＝扩展—收缩的收缩步） | 无，可并行 |
| 6 | `web/packages` | 移除已证实多余的模块 | 9 的结论 |
