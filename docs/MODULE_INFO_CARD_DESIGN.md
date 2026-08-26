# 信息卡片模块族（`info-card` / `info-list` / `info-feed` / `gauge-card`）— 设计

参考仓 `DigitalTwinBK` 有 15 个「能源银行定制」信息展示模块。它们其实是同一件事的 15 次重写：
都走 `ModulePanel` + 阈值表 + 「缺值显 —、真实 0 显 0」，差别只在**外壳形态、行内编排、装饰件**
这三类观感上。这一版把它们收敛成 **4 个通用模块**，观感做成正交的档位维度，15 种既有观感
做成一键预设。

本文是 [DASHBOARD_DESIGN](DASHBOARD_DESIGN.md) §5「新增一个模块 = 1 个目录 + 1 行注册」的
第三到第六次兑现，体例沿用 [MODULE_METRIC_CARD_DESIGN](MODULE_METRIC_CARD_DESIGN.md) 与
[MODULE_ACTION_BUTTON_DESIGN](MODULE_ACTION_BUTTON_DESIGN.md)。

---

## 0. 本设计经过一轮对抗审稿，以下 13 处是审稿后修正的实质结论

| # | 结论 | 为什么它是实质的 |
|---|---|---|
| 1 | 收成 **4 个**模块而不是 2 个 | `layout` 一个枚举同时管两套互斥语义：行列表档下 `columns` / `gridRows` 全是死配置，网格档下滚动 / 分组 / 表头 / 行筛选全是死配置。而 `ConfigField.when` 只判**同级单条件**（`configForm.ts` 的 `isFieldVisible` 就一行 `condition.in.includes(config[condition.key])`），盖不住这种交叉 |
| 2 | `entity-gauge` **本期做**，与 `target-progress` 一起进 `gauge-card` | 它的 arc / linear / tank / thermometer 四档是纯 SVG + CSS，`index.ts` 与 `Component.vue` 零 echarts 依赖（对照 `efficiency-overview/Component.vue` 真的 `import` 了 `shared/chart/echarts`）。「暂不迁 echarts 模块」这条豁免覆盖不到它 |
| 3 | 行结构改成**声明式**：`lead ｜ 最多三段 lines ｜ tail` 外加一条扩展指标行 | 固定纵向段序表达不出四个参考模块的真实排版（`.vsl-meta-row` / `.tl-row2` / `.al-row` / `.src-foot` 全是「同一行左右分列」）。逐个取值见 §2.2 |
| 4 | 每行**两个**徽章位：`badge` + `tag` | `source-list` 的 `.src-meta` 与 `terminal-list-v2` 的 `.tl-row1` 同时挂 `StatusBadge` 与一个分类文字 chip。单选枚举装不下两个，选了 device 就整片丢掉分类标签 |
| 5 | 值驱动的颜色走**模块自带的规则表**（带 `color` 子字段） | `shared/thresholds.ts` 的 `levelColor` 是四色硬映射，`thresholdsConfigField` 的行里只有 `op/value/value2/level/label/blink`，没有颜色。能源类型五色、水温色相梯度、工单三档状态色一条都配不出来。见 §3 |
| 6 | `metric-card` **并存**，不加 `replacedBy` | 三处不等价（`density` 的行/列不同 gap、`showStatusDot` 的 normal 档、`valueColor` 缺省值）正是并存的理由，见 §1.4 |
| 7 | 每模块顶层字段 **上限 35 个**、行内子字段 **≤10 个**（绑定子槽另计，它摊在绑点面板上）；三套阈值输入收成**一张整块规则表** | `PropertyPanel.vue` 只有 `section` + `h3`，**没有折叠**；`ArrayControl.vue` 也不折行——每行一个描边 div，可见子字段全部同时渲染。行内再嵌 9 个阈值子字段，10 项的模块会一次摊出几百个控件 |
| 8 | 每轮 PR 的覆盖目标是 **行 95 / 分支 90** | `web/vitest.config.ts:63` 有一条 per-glob 阈值 `'packages/*/src/**/*.ts': { lines: 95, branches: 90 }`。四个模块的取值逻辑全落在这个 glob 里，先红的是它而不是全局的 80/75 |
| 9 | 定时器的**持有与释放放回 `Component.vue`** | `check_ts_style.py` 的 `check_unmount_cleans_up` 只扫 `_components()`（`.vue`）与 `_composables()`（文件名以 `use` 开头的 `.ts`）。放在 `hold.ts` 里等于同时买下「这条闸对它失效」 |
| 10 | 时刻来源单独一档 `timeSource`（采样 / 告警起始 / 绑定文本） | `alarm-list` 的 `.al-time` 显示的是**告警起始时刻**（组件侧 `sinceMap`，key 来自 `compute.ts` 的 `rowSignature`），不是采样时刻。两个语义占同一档时落地必然二选一，而墙上那个时刻错了看不出来 |
| 11 | `work-order-list` 的四个字符串槽由**绑定**供给 | 它的 `bindings` 里 `dept / status / desc / time` 四个子槽全可绑，`status` 还带 `enumMap { 0:'pending', 1:'running', 2:'done' }`。收成一个文本槽就做不出「后端推送的工单列表」。改法见 §6.2 |
| 12 | 四个模块 = **四轮 PR、四次机械豁免**，一次超限例外都不申请 | [AC_DATA_LANDING](AC_DATA_LANDING.md) 的「记录在案的例外」自陈**不能借用旧条款**（那篇的原文：这是一次新的、需要显式批准的例外）。而 `_is_module_landing()` 对每个 base 上不存在的模块目录各给一次豁免 |
| 13 | 领域公式与计算源浮层都不迁 | 净产能三级回退 / COP 推导 / `V×ΔT×1.163` 水储能是能源银行的领域算法；`kpi-group` 的 ⓘ 计算源浮层三个子字段吃掉行内预算的三成。两者都进 §14 |

---

## 1. 收敛方案：15 → 4

### 1.1 四个模块

| type id | displayName | category | icon | chrome | 默认尺寸 | 顶层字段 | 行内字段 |
|---|---|---|---|---|---|---|---|
| `info-card` | 信息卡片 | 数据 | `layout-grid` | `card`（缺省） | 420×220，min 120×64 | 33 | 10 |
| `info-list` | 信息列表 | 数据 | `table` | `card`（缺省） | 360×420，min 160×96 | 35 | 10 |
| `info-feed` | 信息流 | 数据 | `activity` | `card`（缺省） | 400×260，min 160×96 | 18 | 0（行全来自绑定） |
| `gauge-card` | 仪表卡片 | 数据 | `gauge` | `card`（缺省） | 320×220，min 120×96 | 30 | 8 |

对照已落地的三个：`action-button` 30 个顶层字段、`metric-card` 13 个（行内 11）、
`header` 18 个（含 `SCAN_FIELDS` 展开的 4 个）。**35 是这个仓里的上限，不是舒适区**——
`info-list` 恰好 35、零余量，`info-card` 33 与 `gauge-card` 30 也贴着上限，靠预设让绝大多数
用户一次都不用碰。`info-feed` 只有 18，它是唯一不贴上限的一个：行全部来自绑定，行结构、
行外壳与 hover、分组、副读数、进度件、告警规则这六段它一段都没有（它只有一个
`rowBorderStyle` 管行间分隔线，不是 `info-list` 那整段行外壳）。

⚠ 四个 type id 都在 `app/src`、`packages/runtime/src`、`packages/modules/src`（排除
`src/modules`）与 `server/` 里 grep 过，零命中。两道「零模块类型字面量」闸
（`packages/modules/tests/moduleTypeLiterals.contract.spec.ts` 与
`app/tests/contract/dashboard-module-literals.contract.spec.ts`）按**已注册的 type**
逐个 grep 源码，撞常见词（`card` / `list` / `table` / `feed`）会红在一堆与模块毫不相干的
属性上——`action-button` 当年就是为这个才没叫 `button`。

⚠ **`layout-grid` 与 `gauge` 两个图标名已被 `header` 与 `metric-card` 用着。**
`manifests.contract.spec.ts` 只查「图标名在 DtIcon 注册表里」，**不查唯一性**，所以重复不会红。
但给 DtIcon 加一个新图标要动 `packages/ui/src`，那一个文件就让 `_is_module_landing()`
整体返回 `False`，而错误信息只会说「超 400 行」。所以只能在已注册的名字里挑，重复接受。

### 1.2 为什么是 4 个而不是 2 个

**「单卡 / 多卡网格」与「行列表」不是同一个模块的两档。** 目标仓的 `metric-card` 确实用一个
`layout: auto|grid|list` 枚举供着三者，但它只有 13 个字段、没有滚动 / 分组 / 表头 / 行筛选
/ 进度条。一旦把这些加进来，两档各自的死配置就超过一半，而 `when` 只能挂一个同级条件：
`scrollConfigFields` 返回的 `scrollSpeed` 已经占用了 `when: { key: 'autoScroll', in: [true] }`，
再加不了第二个条件，于是网格档下必然摆出一个不生效的滚动开关。

**表格不需要第五个模块。** `tag-table` 没有 `<thead>`、没有斑马纹——它是「行列表 + 一条表头行
+ 单位独占一列」，落成 `info-list` 的 `rowLayout: 'columns'` 一档。⚠ `check_web_styles.py`
的 `<table>` 禁令只扫 `app/src`（`check_pages_have_no_raw_table` 的 `_sources(APP / "src")`），
模块包不在扫描面内；用 grid 的理由不是闸门，是列宽要跟着配置走（§2.4）。

**`icon-kpi-group` 与 `kpi-group` 的「不可合并」在参考仓成立，在这里不成立。** BK 的 fileoverview
自陈「合并需新增 20+ 字段并让模板分叉两套 DOM」。逐项对照后两者真正的差只有四个正交维度：
外壳（`plain` / `card`）、图标形态（无 / 圆形容器）、图标方位（左 / 上）、数值填充（纯色 / 渐变文字）。
「20+ 字段」是**没有维度化**的后果。

**`feed-list` 必须分家，理由在契约层而不在观感层。** 目标仓的数组绑定槽有两种，差别只在
`isEntityPinned` 这一个**静态清单字段**上：

- 声明 `isEntityPinned: true` + `bindingRowCounts` → 行**钉在配置里的实体上**，行数由 config
  决定，绑点面板不摆增删键，索引允许留空（服务端据此跳过连续性校验）。
- 不声明 → **列表式**，行由用户在绑点面板增删，索引必须连续且从 0 起。

`info-card` / `info-list` / `gauge-card` 的行全部来自 config 数组，必须是前者；`feed-list`
在参考仓里**没有 config 侧的 items 数组**，行数由推送的数组长度决定，必须是后者。清单字段
不可能按实例切换，硬切就是「服务端按一种口径校验、面板按另一种口径摆行」。

**`gauge-card` 独立是因为几何。** arc（270° SVG 弧）、tank（竖向液面）、thermometer（管 + 球）
三档不是卡片语言，它们要 `viewBox` 与 `pathLength`；而 `target-progress` 的 18px 粗轨道
（刻度 + 目标标记 + 内嵌 pill）与它们共享「量程 → 百分比 → 填充」这条链，是同一个模块的第五档。

### 1.3 覆盖表（15 个，一个不漏）

⚠ **表里只写与该预设身份相关的关键取值，簇一律写成缩写。** 落地的 `presets.ts` 里每个预设都要把
清单里的**每一个**簇按该字段 `default` 的键序写全（§5.1 的 A 案），表后给出一个完整样例，
其余预设同理。

| # | 参考模块 | 归属 | 预设 id | 关键字段取值 |
|---|---|---|---|---|
| 1 | `kpi-card` | `info-card` | `kpi-single` | `layout:'single'` `cellShell:'plain'` `padX:12` `padY:4` `align:'center'` `labelPlace:'below'` `labelSize:12` `valueSize:0` `valueGlow:12` `unit:{place:'baseline',size:13}` `icon:{mode:'corner',size:20,opacity:0.85}` `compare:{show:true,mode:'percent'}` `statusDot:'none'` |
| 2 | `kpi-group` | `info-card` | `kpi-grid` | `layout:'grid'` `columns:'auto'` `gapX:10` `gapY:10` `padX:10` `padY:6` `cellShell:'accent'` `cellPadX:12` `cellPadY:8` `labelPlace:'above'` `valueSize:0` `valueGlow:10` `hover:'lift'` |
| 3 | `icon-kpi-group` | `info-card` | `icon-grid` / `icon-column` | `layout:'grid'` `columns:2` `gapX:0` `gapY:0` `padX:0` `padY:0` `cellShell:'plain'` `cellPadX:10` `cellPadY:5` `icon:{mode:'badge',position:'left',size:40,shape:'circle',bgAngle:135,glow:8,gap:10,fontSize:18}` `labelPlace:'above'` `labelSize:13` `labelTone:'title'` `labelOpacity:0.6` `valueSize:26` `unit:{size:12,opacity:0.5}` `textPlainFallback:true`；`icon-column` 档 = `icon.position:'top'` + `align:'center'` |
| 4 | `list` | `info-list` | `row-list` | `rowLayout:'stack'` `rowLines:[{left:'label',right:'value'}]` `rowShape:{lead:'icon'}` `rowShell:'divider'` `dividerStyle:'dotted'` `spacing:{padX:6,padY:4,rowPadX:4,rowPadY:6}` `labelSize:13` `valueSize:16` `valueColor:'var(--accent-secondary)'` `unitPlace:'attached'` `unitSize:11` `thousands:true` `autoScroll:true` `scrollSpeed:3` |
| 5 | `tag-table` | `info-list` | `three-col` | `rowLayout:'columns'` `columnHeader:{show:true,name:'名称',value:'数值',unit:'单位'}` `rowShell:'divider'` `spacing:{padX:8,padY:4,rowPadX:4,rowPadY:6}` `valueSize:13` `valueColor:'var(--accent-secondary)'` `unitPlace:'column'` `hover:'tint'` `thousands:true` |
| 6 | `metric-status-table` | `info-list` | `target-badge-list` | `rowLines:[{left:'label',right:'value'},{left:'sub',right:'badge'}]` `rowShell:'divider'` `spacing:{rowPadY:8}` `labelSize:14` `labelTone:'primary'` `valueSize:22` `valueGlow:10` `unitPlace:'attached'` `unitSize:11` `subSource:'target'` `subLabel:'目标'` `badge:{kind:'rule',style:'outline'}` `alarmOn:'value'` |
| 7 | `source-list` | `info-list` | `source-card` | `rowShape:{lead:'icon',extras:true}` `rowLines:[{left:'label'},{left:'badge',left2:'tag',right:'value'},{left:'sub',right:'meter'}]` `rowShell:'accent'` `spacing:{rowPadX:9,rowPadY:5}` `valueSize:18` `valueGlow:8` `badge:{kind:'device'}` `subSource:'aux'` `subLabel:'能效'` `meter:{kind:'bar',source:'share',label:'占比',height:4,width:128,dot:false,showPercent:true}` `extras:[{label:'功率',unit:'kW'},{label:'温度',unit:'℃'},{label:'流量',unit:'m³/h'}]` `hover:'lift'` `scrollSpeed:5` |
| 8 | `terminal-list-v2` | `info-list` | `terminal-card` | `rowLines:[{left:'label',left2:'tag',right:'badge'},{left:'value',right:'meter'}]` `rowShell:'card'` `grouping:'tabs'` `defaultGroup:''` `spacing:{rowPadX:8,rowPadY:4}` `valueSize:17` `valueGlow:8` `badge:{kind:'device'}` `meter:{kind:'bar',source:'share',label:'占比',height:3,width:50,showPercent:true}` `scrollSpeed:4` |
| 9 | `vessel-list` | `info-list` | `vessel-card` | `rowLines:[{left:'label',right:'value'},{left:'meter',right:'sub'},{left:'meter2'}]` `rowShell:'card'` `grouping:'section'` `spacing:{rowPadX:7,rowPadY:6}` `valueSize:17` `valueGlow:8` `unitPlace:'attached'` `subSource:'aux'` `subLabel:'水温'` `alarmOn:'sub'` `meter:{kind:'bar',source:'range',label:'占比',dot:true,showPercent:true,source2:'aux2',label2:'液位'}` `scrollSpeed:4`（参考仓 4.5，见 §10.4）。三个各自独立的绑定槽：`value`=储能 · `aux`=水温 · `aux2`=液位 |
| 10 | `work-order-list` | `info-list` | `work-order` | `rowLines:[{left:'label',right:'badge'},{left:'desc'},{left:'time'}]` `rowShell:'edge'` `dividerStyle:'dotted'` `spacing:{rowPadX:8,rowPadY:9}` `labelSize:14` `labelTone:'primary'` `badge:{kind:'rule',style:'solid'}` `subSource:'aux'` `alarmOn:'sub'` `timeSource:'bound'` `rowFilter:'all'`；三档状态 = 三条 `eq` 规则（§3.3） |
| 11 | `alarm-list` | `info-list` | `alarm-rows` | `rowShape:{lead:'badge',tail:'value',tail2:'time'}` `rowLines:[{left:'label'},{left:'alarmText'}]` `rowShell:'edge'` `spacing:{rowPadX:6,rowPadY:7}` `badge:{kind:'severity',style:'dot'}` `rowFilter:'alarm'` `rowSort:'severity'` `holdSeconds:0` `calmText:'无活动告警'` `timeSource:'alarmSince'` `valueSize:15` `unitPlace:'attached'` |
| 12 | `feed-list` | `info-feed` | `feed-plain` / `weather-alert` | `showDot:true` `dotSize:8` `dotGlow:6` `showLevel:true` `levelSize:12` `showTime:true` `timeSize:12` `timePlace:'right'` `textSize:13` `rowBorderStyle:'dotted'` `rowPadX:4` `rowPadY:7` `emptyText:'暂无信息'` `levels:[]`（走 11 键内置档）`sortByRank:false` `scrollSpeed:3`；`weather-alert` 档在 `levels` 里补气象五色（含橙，§10.6） |
| 13 | `target-progress` | `gauge-card` | `target-track` | `layout:'single'` `shape:'track'` `geometry:{thickness:18,arcSpan:270,tankWidth:56,tubeWidth:14,bulbSize:26}` `fillStyle:'gradient'` `readout:'value'` `readoutPlace:'beside'` `labelPlace:'left'` `labelSize:15` `labelTone:'title'` `valueSize:0` `valueGlow:12` `unitSize:13` `scale:{showRange:false,ticks:true,tickCount:4,wanFormat:false,wanDigits:2}` `targetMark:true` `targetLabel:'计划'` `showPercent:true` `thousands:true` |
| 14 | `entity-gauge` | `gauge-card` | `arc-gauge` | `shape:'arc'` `geometry:{thickness:0,arcSpan:270,tankWidth:56,tubeWidth:14,bulbSize:26}` `readout:'value'` `readoutPlace:'center'` `scale:{showRange:true,ticks:false,tickCount:4,wanFormat:false,wanDigits:2}` `labelPlace:'below'` |
| 14a | `entity-gauge` | `gauge-card` | `linear-bar` | `shape:'linear'` `geometry:{thickness:0,arcSpan:270,tankWidth:56,tubeWidth:14,bulbSize:26}` `readout:'value'` `readoutPlace:'beside'` `scale:{showRange:true,ticks:false,tickCount:4,wanFormat:false,wanDigits:2}` `labelPlace:'below'` |
| 14b | `entity-gauge` | `gauge-card` | `tank` | `shape:'tank'` `geometry:{thickness:0,arcSpan:270,tankWidth:56,tubeWidth:14,bulbSize:26}` `readout:'value'` `readoutPlace:'center'` `scale:{showRange:false,ticks:false,tickCount:4,wanFormat:false,wanDigits:2}` `labelPlace:'below'` |
| 14c | `entity-gauge` | `gauge-card` | `thermometer` | `shape:'thermometer'` `geometry:{thickness:0,arcSpan:270,tankWidth:56,tubeWidth:14,bulbSize:26}` `readout:'value'` `readoutPlace:'beside'` `scale:{showRange:false,ticks:false,tickCount:4,wanFormat:false,wanDigits:2}` `labelPlace:'below'` |
| 15 | `efficiency-overview` | **不迁** | — | 依赖 echarts：`PieChart` 半环 + `GaugeChart` COP 仪表 + 40 段光谱离散化 + 最大余数法配比修正。见 §14 |

簇写全长什么样（第 3 行 `icon-grid` 的 `icon` 簇，键序与 §5.2 的 `default` 逐字相同）：

```ts
icon: {
  mode: 'badge', position: 'left', size: 40, shape: 'circle',
  bgFrom: '', bgTo: '', bgAngle: 135, borderColor: '',
  glow: 8, gap: 10, fontSize: 18, opacity: 1,
}
```

> 参考仓还有第 16 个目录 `terminal-list`（v1），它在参考仓里已经 `replacedBy: 'terminal-list-v2'`、
> 模块库已隐藏，DOM 与 CSS 与 v2 逐字相同，六处差异全是被 v2 修掉的语义与可达性回归。
> 跨仓迁移没有存量，不列为覆盖行。

### 1.4 与已有 `metric-card` 的分工：并存

`metric-card` **一个字都不动**，不加 `replacedBy`，它的四个文件与 655 行测试继续留仓里跑。

| 场景 | 拖哪个 |
|---|---|
| 一块摆 1..N 个点位读数，四段带阈值，逐格状态点 | `metric-card` |
| 要定制外观（外壳 / 图标容器 / 渐变文字 / 进度条 / 徽章 / 分组 / 表头 / 行筛选） | `info-card` / `info-list` |

三处**不等价**，它们正是并存而不是让位的理由：

1. **`density` 的三档枚举。** `metric-card/Component.vue` 的三档是 `gap: 6px 10px` /
   `12px 16px` / `20px 24px`——**行间距与列间距不同**。`info-card` 用 `gapX` / `gapY` 两个标量
   能逐值复刻，但没有 `density` 这个枚举本身：调一次疏密要动两个滑块。
2. **`showStatusDot` 的 normal 档。** `metric-card/metrics.ts` 在「值 ok 且这一项配过任一边界」
   时把 level 判成 `'normal'`，于是画一个绿点。`info-card` 的 `statusDot: 'auto'` 只在**命中规则**
   时画点——「没有判据就连正常都不该说」这条口径被推得更远，代价是屏上少一个绿点。
3. **`valueColor` 缺省值。** `metric-card` 是 `var(--card-text, var(--text-primary))`（跟随卡片
   文字色），`info-card` 是 `var(--accent-primary)`（跟随它替代的 `icon-kpi-group`）。

⚠ 不需要 ADR：按 [engineering-workflow](agents/engineering-workflow.md) 的四条触发条件，
只加走通用控件的模块不触发。`metric-card` 与 `action-button` 都只写了 `MODULE_*_DESIGN.md`。

---

## 2. `info-list` 的行结构模型（本设计的支点）

八个参考模块的行长得都不一样，但它们的骨架只有一种：
**一个可选的前导列 + 若干「左右分列」的行 + 一个可选的尾列。**

### 2.1 一行 = `lead ｜ 最多三段 lines ｜ tail` + 一条扩展指标行

```
┌─ 行（.il-row，rowShell 决定描边/底纹/色边） ───────────────────────────┐
│ ┌─lead─┐  ┌─ body ─────────────────────────────────┐  ┌─tail─┬─tail2─┐ │
│ │ 图标 │  │ line1  left · left2 ……………… right       │  │ 读数 │ 时刻  │ │
│ │  或  │  │ line2  left · left2 ……………… right       │  │      │       │ │
│ │ 徽章 │  │ line3  left · left2 ……………… right       │  │  垂直居中    │ │
│ └──────┘  │ ── extras（有值才渲染） ───────────────  │  └──────┴───────┘ │
│           │    功率 12 kW · 温度 55 ℃ · 流量 8 m³/h │                    │
│           └────────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────────┘
```

- `lead` / `tail` / `tail2` 是 `rowShape` 这个 `object` 簇的三个子键，垂直居中，跨全部 line。
- `rowLines` 是一个 `array` 字段，**最多 3 行**，每行四个枚举 `left` / `left2` / `right` / `right2`。
  左组左对齐（`left` 拿 `flex: 1`、必要时省略号），右组右对齐；一行内全空则整行不渲染。
- `extras` 是 `rowShape.extras` 开关控制的**扩展指标行**，不占 line 预算：整块的 `extras`
  数组声明 ≤3 个 `{label, unit, precision}`，取值来自绑定的 `extra1..extra3` 子槽，
  **有值才渲染**（`isPresent` 判，真实 0 算有值）。

可放进段位的**件**（一张字面量联合，清单与渲染共用一份 `options.ts`）：

| 件 | 画什么 | 可放位置 |
|---|---|---|
| `label` | 行名。⚠ 独占一整 line 时两行截断（`-webkit-line-clamp: 2`），与别的件同行时单行省略号 | line 左/中 |
| `value` | 主读数 + 单位（按 `unitPlace`） | line 任意 · tail |
| `sub` | 副读数：`subSource` 五档 `aux` · `aux2` · `aux3`（三个独立的副读数槽）/ `target`（行内 `range.target`）/ `text`（绑定文本槽），前面挂 `subLabel` | line 任意 · tail |
| `badge` | 状态徽章，`badge.kind` 四档见 §2.3 | line 任意 · lead · tail |
| `tag` | 分类 chip，文案取行内 `item.tag`，颜色取行当前色 | line 任意 |
| `meter` / `meter2` | 进度件组：`label` 小字 + `xx%` 读数 + 可选 4px 发光圆点 + 条。两条同构，`meter` 簇里各有一套 source/label，各自选源（`range` / `share` / `aux` / `aux2` / `aux3`） | line 任意 |
| `alarmText` | 命中规则的 `label`，用命中色 | line 左/中 |
| `desc` | 长描述，取绑定文本槽或行内 `desc`，`overflow-wrap: anywhere` 折行 | line 左（独占） |
| `time` | 时刻，`timeSource` 三档见 §2.5 | line 任意 · tail |
| `icon` | 行首图标（素材图或 emoji，取不到回退圆点） | lead |

⚠ **三个选源旋钮 `subSource` / `meter.source` / `meter.source2` 各自独立，所以副读数槽是三个
而不是一个。** 一行最多同时要「一个副读数 + 两条各自取值的进度条」，`vessel-card` 就是那条下界：
储能（主读数）+ 水温（副读数）+ 液位（第二条进度条）三个各自独立的绑定值。只给一个 `aux`
时后两个旋钮会抢同一个槽，液位无处取值。逐槽清单见 §6.1。

⚠ **`lead` 只收 `icon` / `badge` / `none`，`tail` / `tail2` 只收 `value` / `sub` / `badge` / `time` / `none`。**
取值表按位置分三张，不是一张通用表——一张通用表会让「把 `desc` 放进 24px 宽的 lead 列」
成为一个配得出来、渲染出来是一坨压扁文字的组合。

### 2.2 八个参考模块的行结构逐个对上

以下八行的 CSS 与 DOM 都是实地打开参考仓核对过的，不是推断：

| 参考模块 | 参考仓的真实几何 | 新模型取值 |
|---|---|---|
| `list` | `.list-row` flex：图标 + label(flex:1) + 16px 读数 + 11px 单位 | `lead:'icon'`，`lines:[{left:'label',right:'value'}]` |
| `tag-table` | `.tt-head, .tt-row` **共用一个选择器列表**，`grid-template-columns: minmax(0,1.6fr) minmax(0,1fr) minmax(0,8em)` | `rowLayout:'columns'`（§2.4） |
| `metric-status-table` | `.mst-line--top` flex（14px 名称 ⟷ 22px 读数 + 11px 单位）+ `.mst-line--sub` flex（12px 目标 ⟷ 自绘徽章，无圆点无动画） | `lines:[{left:'label',right:'value'},{left:'sub',right:'badge'}]`，`badge.style:'outline'` |
| `source-list` | `.src-item` grid `28px minmax(0,1fr)`；`.src-name` 两行截断；`.src-meta` grid `auto auto minmax(82px,1fr)` = StatusBadge ｜ `.src-tag` ｜ 输出+18px 读数（右对齐）；`.src-foot` grid `minmax(0,1fr) minmax(72px,30%)` = 能效+占比% ｜ share 条；`.src-extras` flex（功率/温度/流量，`v-if="row.extras.length"`） | `lead:'icon'`，`lines:[{left:'label'},{left:'badge',left2:'tag',right:'value'},{left:'sub',right:'meter'}]`，`extras:true`。⚠ 「占比 xx%」文字随条走进右列（参考仓在左列），见 §10.5 |
| `terminal-list-v2` | `.tl-row1` flex：`.tl-name`(flex:1) + `.tl-cat-tag` chip + `StatusBadge`；`.tl-row2` flex `space-between`：当日+17px 读数+kWh ⟷ 占比 xx% + 50px×3px 条 | `lines:[{left:'label',left2:'tag',right:'badge'},{left:'value',right:'meter'}]`——逐位对上 |
| `vessel-list` | `.vsl-title-row` grid `minmax(0,1fr) auto`；`.vsl-meta-row` grid `minmax(118px,1fr) auto` = `.vsl-ratio`(grid `auto auto 4px minmax(36px,1fr)` = 占比 label + 12px 读数 + 4px 发光点 + 4px 条) ⟷ 13px 水温；`.vsl-level` 独立第三行（label + 读数 + 条），`v-if` 液位有值 | `lines:[{left:'label',right:'value'},{left:'meter',right:'sub'},{left:'meter2'}]`，`meter.dot:true`，`subSource:'aux'`（水温）+ `meter.source2:'aux2'`（液位）——两个各自独立的槽。第三行的条件渲染由 `aux2` 取不到值时整段不画兜住 |
| `work-order-list` | `.wo-head` flex `space-between`：14px/600 车间 ⟷ 实心徽章（`--text-inverse` 前景 + 辉光）；`.wo-desc` 12px 折行；`.wo-time` 11px「检查时间：xx」 | `lines:[{left:'label',right:'badge'},{left:'desc'},{left:'time'}]`，`badge.style:'solid'`，`timeSource:'bound'` |
| `alarm-list` | `.al-row` grid `auto 1fr auto auto`（`--notime` 档 `auto 1fr auto`）= 严重度(8px 点 + 10px 文字) ｜ `.al-main`(flex column：13px 名称 / 11px 命中文案) ｜ 15px 读数 ｜ 11px 时刻；行左 3px 色边 + `color-mix(色 8%)` 底 | `lead:'badge'` + `badge.kind:'severity'`（严重度词，不是命中文案），`lines:[{left:'label'},{left:'alarmText'}]`，`tail:'value'`，`tail2:'time'`，`rowShell:'edge'`——四列逐列对上，且 tail 的垂直居中就是参考仓 `align-items: center` 的那一档 |

### 2.3 两个徽章位：`badge` 与 `tag`

`badge` 是 `object` 簇 `{ kind, style }`：

| `kind` | 取值来源 | 画什么 |
|---|---|---|
| `none` | — | 不画 |
| `device` | 绑定的 `status` 子槽 → `toDeviceStatus` | 直接渲染 `shared/StatusBadge.vue`（五档配色 + alarm 呼吸自带）。⚠ `style` 对它不作用 |
| `severity` | `alarmOn` 指的那个读数命中的规则的 `level` | 该 level 的中文词（正常 / 提示 / 警告 / 危急）+ 该 level 的语义色（`levelColor`），`style` 三档生效 |
| `rule` | `alarmOn` 指的那个读数命中的规则 | 规则的 `label` + 规则的 `color`（`style` 三档生效） |

⚠ **`severity` 与 `rule` 画的是两个不同的词，不能合成一档。** 参考仓 `alarm-list` 的 `.al-sev`
是「8px 圆点 + `LEVEL_TEXT[a.level]`」（危急 / 警告 / 提示 / 正常）、独占严重度列，`.al-label`
才是 `a.label`（命中文案）、在 `.al-main` 的第二行。只留 `rule` 的话严重度词整个消失，
而行首徽章与第二行的 `alarmText` 会变成同一句话重复两遍。`alarm-rows` 预设用 `severity`。
⚠ 这四个词写在模块自己的 `options.ts` 里，**不复用 `shared/thresholds.ts` 的 `LEVEL_OPTIONS`**：
那是属性面板的下拉项，label 是「危险（红）」这种带括注的写法，画到徽章上就是一个带括注的词。

`style` 三档：`outline`（描边 + `color-mix(色 16%)` 底）/ `solid`（实心 + `--text-inverse` 前景 + 辉光）
/ `dot`（圆点 + 文字，无框无底）。

`tag` 是**第二个**徽章位，与 `badge` 正交：文案来自行内 `item.tag`（自由字符串），
颜色跟随行当前色。⚠ 它不是「另一种状态」——`source-list` 的 `.src-tag` 是能源类型、
`terminal-list-v2` 的 `.tl-cat-tag` 是末端分类，两者都与运行状态无关，**同时挂在行首**。

⚠ **`status` 子槽刻意不声明 `enumMap`，`dataType` 也刻意写 `number`。**
`packages/runtime/src/moduleValues.ts` 的 `applyEnumMap` 会**真的把数值换成 `enumMap` 的值**
再交给模块（`enumMap[String(value)] ?? value`）。参考仓的 map 值是语义 key（`{0:'offline'}`），
而目标仓契约把 `enumMap` 定义成「数值 → 中文文案」（`BindingSpec.enumMap` 的注释里就是
`{ '0': '离线' }`）——照抄后者会让 `toDeviceStatus('离线')` 落到 `unknown`，全屏状态徽章
集体变成灰色虚线的「无数据」，而且不报错。不声明时数值原样到达，走
`shared/status.ts` 的 `NUMERIC_STATUSES` 旁路（`0→offline / 1→running / 2→standby / 3→alarm`），
这才是参考仓的真实语义。

### 2.4 `columns` 档与表头

`rowLayout: 'columns'` 是另一条排版路：整行是一个三列 grid（名称 ｜ 数值 ｜ 单位），
`rowLines` / `rowShape` 在这一档不生效。`columnHeader` 簇 `{ show, name, value, unit }`
在列表顶上画一条表头行。

⚠ **表头行与数据行必须共用同一份 `grid-template-columns`。** 参考仓的 `tag-table` 是
`.tt-head, .tt-row` 一个选择器列表共用一份写死的字符串——那里没有问题。这里的列宽要跟着
`unitSize` 与单位列上界走，所以模板必须来自一个变量：`look.ts` 产 `--il-cols-tpl`，
表头与行都写 `grid-template-columns: var(--il-cols-tpl)`。⚠ 拆成两处字符串就会错列，
而 typecheck 与 lint 都不管，`app/tests/contract/css-variables.contract.spec.ts`
也扫不到（它的 `SCAN_ROOTS` 只有 `app/src` 与 `packages/ui/src`）。

### 2.5 时刻来源：`timeSource` 三档

| 档 | 取哪个 | 谁在用 |
|---|---|---|
| `sample` | `meta.slots[fieldKey].timestampMs` → `fmtClock` | 「现场还动不动」那一列 |
| `alarmSince` | `hold.ts` 算出的告警起始时刻 → `fmtClock` | `alarm-rows` 预设 |
| `bound` | 绑定的 `time` 字符串槽，原样显示 | `work-order` 预设 |

⚠ 这三档必须分开。参考仓的 `.al-time` 是**告警起始时刻**：`Component.vue` 维护一张
`Map<行签名, { since, active }>`，`since` 只在这一行第一次命中时写入。把它和采样时刻
折成一档，墙上那个数字会从「什么时候开始报的」悄悄变成「最后一帧什么时候到的」，
而列表看起来完全正常。

⚠ **行签名必须来自行身份而不是筛选后的下标。** 参考仓 `compute.ts` 的 `rowSignature` 是
`[name, op, value, value2, level].join('␟')`（不含索引与实时值），同签名行按出现序加 `#n`
去重。换成下标后，运行时增删或重排配置行会让新行继承他行的告警起始时间。

⚠ **迟滞的到期用一个 `setTimeout`，而且它的持有与释放都在 `Component.vue` 里。**
`hold.ts` 只出纯函数 `reconcileHold(prev, hits, nowMs, holdMs) → { rows, nextWakeMs }`；
`Component.vue` 按 `nextWakeMs` 设**单个**定时器，`onBeforeUnmount` 必 `clearTimeout`。
理由是闸门：`check_ts_style.py` 的 `check_unmount_cleans_up` 遍历的是
`[*_components(), *_composables()]`，而 `_composables()` 只认文件名以 `use` 开头的 `.ts`——
`hold.ts` 两者都不是，把 `setTimeout` 放进去等于让这条闸对它永久失效。而改名成
`useHold.ts` 又会撞上 `MAX_COMPOSABLE_LINES = 200`。

---

## 3. 值驱动的颜色：模块自带的规则表

### 3.1 为什么不能只用 `shared/thresholds.ts`

`shared/thresholds.ts` 的 `LEVEL_VAR` 是四色硬映射（`normal → --state-success` /
`info → --state-info` / `warning → --state-warning` / `danger → --state-danger`），
`thresholdsConfigField()` 的 `itemSchema` 只有 `op` / `value` / `value2` / `level` / `label` / `blink`，
**没有颜色**。于是：

- `source-list` 的 `KIND_VAR` 五色（`--chart-series-2/3/4` / `--state-warning` / `--chart-cold`）配不出来；
- `vessel-list` 的 `tempColor` 蓝→青→橙→红色相梯度配不出来，25 ℃ 会渲染成 success 绿
  并被 `isAlarmLevel` 判成非告警；
- `work-order-list` 的三档状态色（`--state-info` / `--state-warning` / `--state-success`）
  能凑出颜色，但它们语义上不是「正常/预警/危险」。

⚠ **千万不要给 `shared/thresholds.ts` 加一个 `color` 字段。** 那一个文件就让
`_is_module_landing()` 整体返回 `False`（它的判据是「所有改动文件都落在这个模块自己的目录、
`MODULE_REGISTRY` 六处花名册、或 `docs/MODULE_*.md` 之内」），而报错只会说「超 400 行」。

### 3.2 模块自带的 `rules.ts`

`info-card` / `info-list` / `gauge-card` **各自目录里各带一份 `rules.ts`**（约 90 行），
`info-feed` 不需要（它走 `levels` 表）。每份出三样：

```ts
/** 一条值规则。`color` 空串 = 跟随 level 的语义色。 */
export interface ValueRule {
  op: ThresholdOp        // 复用 shared 的 8 档运算符，不另立一套
  value: number
  value2?: number
  level: ThresholdLevel  // 只管严重度排序（rowSort）与「算不算告警」（rowFilter）
  color: string
  label: string
  blink: boolean
}

export function valueRulesField(key: string, label: string): ConfigField
export function normalizeValueRules(raw: unknown): ValueRule[]
export function evaluateValueRules(value: unknown, rules: readonly ValueRule[]): ValueHit | null
```

`evaluateValueRules` **不重写匹配语义**：它按声明序对每条规则单独调一次
`evaluateThresholds(value, [rule])`，第一个非 null 即命中，然后用该规则自己的 `color`
覆盖 `hit.color`（空串时保留语义色）。这样区间档缺上界判不中、`normal` 档也算命中、
声明序取首个这三条口径全部继承自同一个求值器，不产生第二份真源。规则数 ≤8，
N 次调用的代价可以忽略。

⚠ **`evaluateThresholds` 假定规则已经过规整。** 它的文件头写明「过了 `normalizeRules`
这道门之后的规则一律当作已校验」。`normalizeValueRules` 必须自己承担那道门：`op` 必须
取自 `THRESHOLD_OPS`、`value` 必须有限。漏了会静默错判——`matchRule` 在 `op` 查
`COMPARATORS` 表 miss、且 `value2` 有值、且 `op` 不是 `between` 时，会走到最后那行
三元判断并按 **`outside` 逻辑**算（`value < low || value > high`）；`value2` 缺席时一律
判不中。两种都不报错。

⚠ **`danger` 规则必须排在 `warn` 之前。** 求值器按声明顺序取首个命中，顺序反了会让
「两档都超」判成预警——最严重的那一档被吃掉。预设与文档里的示例一律高危在前。

### 3.3 三种既有配色的落法

| 参考仓的机制 | 新模型 |
|---|---|
| `source-list` 的 `KIND_VAR` 五色（按能源类型） | 逐行 `item.color`：能源类型是**静态元数据**，不是值驱动的 |
| `vessel-list` 的 `tempColor` 四档（按水温） | `alarmOn:'sub'` + 4 条带 `color` 的规则（`lt 35` 蓝 / `between 35 45` 青 / `between 45 55` 橙 / `gte 55` 红），高危在前 |
| `work-order-list` 的三档状态色 | `subSource:'aux'` + `alarmOn:'sub'` + 3 条 `eq` 规则（`eq 0` 待执行 · `--state-warning` / `eq 1` 执行中 · `--state-info` / `eq 2` 已完成 · `--state-success`），三条 `level` 都填 `normal`，配 `rowFilter:'all'` |

⚠ 规则里的 `color` 只许填 `var(--…)` 引用，不填十六进制：算出来的色值会原地钉死在一套
配色上，换肤时不跟着走。`check_ts_style.py` 的 `HARDCODED_COLOR` 只扫样式块，
**配置里的字面量它管不着**，所以这一条要靠 `presets.spec.ts` 的一条断言兜
（预设里所有 `color` 值都以 `var(--` 开头）。

---

## 4. `info-card` / `gauge-card` / `info-feed` 的外观模型

### 4.1 `info-card`：一格四段，段序固定

行列表的排版才需要声明式段位；网格里的一格是纵向堆叠，段序固定就够了：

```
┌─ 格（.ic-cell） ─────────────────────────────┐
│ [图标列 icon.position=left]  ① head 徽章·标签  │
│                              ② value 读数+单位 │
│                              ③ compare 涨跌块  │
│                              ④ foot 标签/命中文案│
└──────────────────────────────────────────────┘
```

⚠ **`labelPlace` 的类名只在标签行真渲染时才挂。** 参考仓 `kpi-card` 的注释写明：无标签时
挂 `label-left` 会多出一列空网格 + 一个列间距，令数值偏移几像素——没人会把它当 bug 报上来。

⚠ **渐变文字有三个前提，缺一即静默降级。** 参考仓 `icon-kpi-group` 的判据是
`valueFill === 'gradient' && !c.override && digit`，其中 `digit = c.numeric || !textPlain`。
逐条照搬：模块开了渐变 **且** 这一格没有覆盖色（逐行 `item.color` 或规则命中）**且**
这个值有资格用数字字体。只判 `valueFill` 的话，命中规则的那一格会被
`background-clip: text` 把告警色洗掉——告警消失且不报错。

⚠ `background-clip: text` 生效时 `text-shadow` 必须置空，否则阴影糊在字面上。

⚠ **`icon-kpi-group` 的 `textFallbackPlain` 要保留成 `textPlainFallback`（缺省开）。**
它管的是「文本值与缺值是否回退正文字体 + 纯色」。折进渐变三前提里写死，等于让
「我要文本也走等宽数字体」这个诉求关不掉。

### 4.2 `gauge-card`：五档几何共用一条链

`值 → normalizePercent(value, min, max) → fillPct → 几何`。五档的几何参数逐条实测自参考仓：

| `shape` | 几何 | 参数 |
|---|---|---|
| `arc` | `viewBox 0 0 100 100`，`cx/cy = 50`，`r = 50 − thickness/2 − 1`；起止角 225°→495°（270°，底部留 90° 缺口）；`pathLength="100"` + `stroke-dashoffset = 100 − pct` 做填充 | `geometry.thickness`（0 = 9）· `geometry.arcSpan`（180…300，缺省 270） |
| `linear` | 横向轨道，`border-radius: var(--radius-pill)`（交给浏览器夹到半高，任意厚度都是正圆端头） | `geometry.thickness`（0 = 12） |
| `track` | 18px 粗轨道 + 轨道内嵌 pill（`left: 10px`，`translateY(-50%)`）+ 4 个等距刻度 + 虚线目标标记 | `geometry.thickness`（0 = 18）· `scale.ticks` · `targetMark` |
| `tank` | 56px 宽（`max-width: 50%`）竖罐，`--radius-md`；填充 `linear-gradient(0deg, 色, color-mix(色 40%))`；3px 液面高光；读数居中 | `geometry.tankWidth` |
| `thermometer` | 14px 管（`border-radius: pill pill 0 0`，顶部半圆帽）+ 26px 球（`margin-top: -2px`） | `geometry.tubeWidth` · `geometry.bulbSize` |

⚠ **参考仓 tank 的居中读数用 `mix-blend-mode: difference`，这一版不沿用。** 它会新建
层叠上下文，与统一卡片外观的半透明底、毛玻璃、辉光叠加后的观感不可预测（而 chrome 那
40 个键是可配的，所以不可预测的组合是必然出现的，不是假设）。改成一个可配前景色 +
`text-shadow` 描边。记在 §10.1。

⚠ **填充比例夹到 [0,100]，读数不夹。** 完成率可以显 >100%（视觉宽度另用已夹的比例）。
⚠ **`fillPct === 0` 时整条 fill 不渲染。** 参考仓 `vessel-list` 的 `.vsl-ratio-fill` 与
`.vsl-level-fill` 都有 `min-width: 2px`，纯靠 `width: 0` 会在真实 0% 的行上留一小截带辉光的
色块，读起来像「有一点点储量」——那两条是靠 `v-show="…PctSafe > 0"` 才没出这个洋相。
（`terminal-list-v2` 的 `.tl-share-bar` 上是 `min-height: 2px`，管的是空轨道自己的可见性；
它的 `> span` 没有任何 `min-width`，所以那一处不是这条的依据。）
⚠ **量程上界 < 10000 时「万」格式整卡回落。** 参考仓 `target-progress` 的 `useWan` 就是
`wanFormat && max >= 10000`：小量程走万会让刻度全塌成「0.0万」、pill 显「0.01万」，信息全失。
⚠ **刻度与 pill 的「万」小数位统一走一个 `scale.wanDigits`。** 参考仓的 `fmtTick` 写死 1 位
而 pill 用 `wanDigits`，同一张卡上两套口径——这一版收成一套，记在 §10.7。
⚠ **首末刻度与目标标签要按位置换对齐基准**（`translateX` 取 `0` / `-50%` / `-100%`），
否则居中的一半溢出卡片被裁掉。参考仓 `ticks` 与 `targetTx` 两处都做了这件事。

### 4.3 `info-feed`：级别档表

内置 11 个级别键 → 4 个 token + rank（逐字取自参考仓）：

| 键 | 颜色 | rank |
|---|---|---|
| `danger` / `red` / `error` | `var(--state-danger)` | 4 |
| `warning` / `warn` / `yellow` | `var(--state-warning)` | 3 |
| `info` / `blue` | `var(--state-info, var(--accent-primary))` | 2 |
| `success` / `normal` / `green` | `var(--state-success)` | 1 |

级别值两侧都 `trim().toLowerCase()`（吃得下 `'WARNING'` / `' Red '`）；同 key 后配置覆盖先配置；
只填 `label` 不填 `color` 的条目仍回落内置色；未知级别 → 不注入颜色变量、不渲染级别文字
（不伪装成一档状态）。

⚠ **橙色（`#ff8000`）刻意没有内置映射。** 中国气象预警五色里的橙在目标仓没有对应语义色，
「顺手映到 `--state-warning`」会让橙与黄两档在屏上同色。要精确橙必须在 `levels` 里配
——`weather-alert` 预设就是这么给的。代码里零颜色字面量。

---

## 5. 配置面

### 5.1 属性面板没有折叠 —— 字段预算从哪来

`app/src/pages/DashboardEditor/components/PropertyPanel.vue` 的正文只有
`<section v-for="group in groups">` + `<h3>` + 平铺字段：**没有 `details`、没有手风琴**，
`configForm.ts` 的 `formGroups` 也只分桶不折叠。`ArrayControl.vue` 同样不折行——每行是一个
描边 div，`visibleCells(row)` 过后的子字段全部同时渲染。

所以字段预算是硬约束，不是审美：

- **顶层上限 35 个**（`action-button` 30 / `header` 16 / `metric-card` 13 是仓里的现有刻度）。
- **行内 ≤10 个**，数的是 `itemSchema`——`ArrayControl` 摊在属性面板上的就是这一份。三套阈值输入
  （四段带 / 规则表 / 两点式）一律**上提到整块级的一张规则表**，行内不留任何阈值字段——参考仓
  `metric-status-table` 的 `autoStatus/statusDir/warnAt/dangerAt` 与 `alarm-list` 的
  `op/value/value2/level/label/blink` 都收进整块 `rules`。⚠ **绑定的 `arrayFields` 不占这份预算**：
  它们摊在绑点面板上，`BindingPanel.vue` 按「行 × 子槽」平铺，`info-list` 的 11 个子槽意味着
  10 个实体铺出 110 条槽位。所以子槽也要按需给，不是白给（下界的算法见 §6.1）。
- 相关的旋钮收成 `type: 'object'` 簇：一个簇在面板上是一个描边小块，且**整块覆盖**。

⚠ **簇的整块 `default` 必须写在字段自己身上。** `shared/config.ts` 的 `configDefaults`
注释写明「只取字段自己的 `default`，不递归进 `fields`」——从子字段拼一份就有了第二个形状。
这一条是可判定的，故由清单断言兜住而不是靠人记：**每个 `type: 'object'` 字段都要有 `default`，
且 `Object.keys(field.default)` 与 `field.fields.map(f => f.key)` 逐字相等（含顺序）**。
它同时给下面那条预设键序闸提供了唯一的基准——没有 `default` 的簇，键序就只能靠人从 §5.2 的
括注反推，而反推出来的顺序不会有任何一处报错。§5.2 的表里没写出缺省值的子键，落地时按
「与参考仓同款观感」定，并以字段自己的 `default` 为准。

⚠ **簇比平铺字段更适合预设。** `useEditorInspector.ts` 的 `applyPreset` 是
`{ ...node.configJson, ...preset.config }`——**浅合并**。平铺时上一个预设留下的
`iconGlow: 20` 会在下一个预设里残留；写 `icon: {…}` 是整块覆盖。

⚠ **簇会让预设按钮的点亮对键序敏感。** `configForm.ts` 的 `activePresetIds` 用
`JSON.stringify(resolved[key]) === JSON.stringify(value)` 逐键比较。`ObjectControl.writeKey`
写的是 `{ ...record, [key]: next }`——改**已存在**的子键不移动位置（JS 对象展开保留既有键的
插入序），但写一个**记录里没有的**子键会把它追加到末尾，此后即使把值改回去，
`JSON.stringify` 也不再相等，预设永远不再点亮。

规避写法定死为 **A 案**：**每个预设都把清单里的每一个簇写全，且子键顺序与该字段 `default`
的顺序逐字相同**，并加一条清单断言——对 `configSchema` 里每个 `type: 'object'` 字段，
`Object.keys(preset.config[cluster])` 与 `Object.keys(field.default)` 逐字相等（含顺序）。
不选「只校验预设里出现的那些簇」，是因为 `applyPreset` 是浅合并：一个预设**不写**某个簇，
上一个预设留在 `configJson` 里的那一整块就原样残留，观感对不上，而 `activePresetIds` 做的是
子集比较、照样点亮，等于既错了又没有任何提示。⚠ 本文 §1.3 的表是缩写，写全的样子见该表后的样例。

### 5.2 四个模块的顶层字段

**`info-card`（33）**

| 分段 | 字段 |
|---|---|
| 内容 3 | `title` · `items`(array) · `emptyText`(`'—'`) |
| 排布 6 | `layout`(auto/single/grid) · `columns`(auto/1…6) · `gapX`(0…40,10) · `gapY`(0…40,10) · `padX`(0…40,10) · `padY`(0…40,6) |
| 外壳 4 | `cellShell`(plain/card/accent) · `cellPadX`(12) · `cellPadY`(8) · `hover`(none/tint/lift) |
| 标签 5 | `align`(left/center) · `labelPlace`(above/below/left/hidden) · `labelSize`(8…48,12) · `labelTone`(secondary/primary/title/muted) · `labelOpacity`(0.2…1,1) |
| 数值 8 | `valueSize`(0…200，**0 = 跟容器自适应**) · `valueColor` · `valueFill`(solid/gradient) · `valueGradient`(array `{color}`) · `gradientAngle`(0…360 step 5) · `valueGlow`(0…24) · `valueFont`(digit/body) · `textPlainFallback` |
| 单位 1 | `unit`(object · 4 子：`place`(baseline/attached/joined) · `size`(8…32,12) · `tone`(secondary/muted/primary/accent) · `opacity`(0.2…1)) |
| 格式 2 | `thousands` · `fixedDecimals` |
| 簇 2 | `icon`(object · 12 子) · `compare`(object · 4 子) |
| 告警 2 | `rules`(带 color 的规则表) · `statusDot`(none/auto) |

`icon` 簇缺省（整块写在字段身上）：
`{ mode:'none', position:'left', size:20, shape:'circle', bgFrom:'', bgTo:'', bgAngle:135,
  borderColor:'', glow:8, gap:10, fontSize:18, opacity:1 }`。
`mode` 四档：`none` / `corner`（右上角标，参考仓 `.kpi-icon` 是 20px、`top:8px right:10px`、`opacity:.85`）
/ `inline`（行首小图标，取不到回退圆点）/ `badge`（圆形/圆角容器）。

`compare` 簇缺省：`{ show:false, mode:'percent', label:'', invertTrend:false }`。
⚠ `percent` 档基数为 0 时**回退显绝对差值**，不留空；`invertTrend` 让下降显绿（能耗/成本类）。

**`info-list`（35）**

| 分段 | 字段 |
|---|---|
| 内容 3 | `title` · `items`(array) · `noRowsText`(`'暂无数据'`) |
| 行结构 3 | `rowLayout`(stack/columns) · `rowLines`(array ≤3 × `{left,left2,right,right2}`) · `rowShape`(object `{lead,tail,tail2,extras}`) |
| 表头 1 | `columnHeader`(object `{show,name,value,unit}`) |
| 间距 1 | `spacing`(object `{padX,padY,rowPadX,rowPadY}`) |
| 外壳 3 | `rowShell`(plain/divider/card/accent/edge) · `dividerStyle`(dotted/dashed/solid/none) · `hover`(none/tint/lift) |
| 滚动 2 | `autoScroll` · `scrollSpeed`（`scrollConfigFields(3)` 原样铺进来） |
| 分组 2 | `grouping`(none/section/tabs) · `defaultGroup` |
| 标签 2 | `labelSize`(13) · `labelTone` |
| 数值 3 | `valueSize`(16) · `valueColor` · `valueGlow` |
| 单位 2 | `unitPlace`(attached/baseline/column) · `unitSize`(11) |
| 副读数 2 | `subSource`(aux/aux2/aux3/target/text) · `subLabel` |
| 徽章 1 | `badge`(object `{kind,style}`) |
| 进度 1 | `meter`(object · 11 子) |
| 扩展 1 | `extras`(array ≤3 × `{label,unit,precision}`) |
| 格式 1 | `thousands` |
| 告警 4 | `rules` · `alarmOn`(value/sub) · `rowFilter`(all/hit/alarm) · `rowSort`(docOrder/severity) |
| 迟滞 2 | `holdSeconds`(0…300) · `calmText` |
| 时刻 1 | `timeSource`(sample/alarmSince/bound) |

`meter` 簇缺省：
`{ kind:'none', source:'range', label:'', height:4, width:0, color:'', glow:6, dot:false, showPercent:true, source2:'none', label2:'' }`。
`source` 五档 `range`（`(值−min)/(max−min)`）/ `share`（本行值 ÷ 全部行正数合计）/
`aux` · `aux2` · `aux3`（把那个副读数槽直接当百分比）；`source2` 在这五档之上多一个 `none`（不画第二条）。
`width: 0` = 铺满（`terminal-card` 给 50、`source-card` 给 128）。

⚠ **行的告警态是叠在 `rowShell` 之上的一层修饰类，不是第六档外壳。** 参考仓 `source-list` 的
`.src-item.is-alarm` 是 `border-color: var(--state-danger)` + `src-alarm` 1.2s 呼吸
（`prefers-reduced-motion` 下换成 `animation: none` + 一圈静态高亮阴影），它压在 `.src-item`
自己那套描边**之上**；做成 `rowShell` 的第六档就得二选一，`source-card` 会当场丢掉 `accent`
的基础外壳。所以它由取值层直接判、**不给顶层字段**（35 已经顶格）：`badge.kind: 'device'`
那一档看 `status === 'alarm'`，其余档看 `alarmOn` 指的读数有没有命中 `level > normal` 的规则。

⚠ `rowFilter` 三档而不是布尔：`all` / `hit`（命中任意规则，含 `normal`）/ `alarm`
（只要 `level > normal`）。参考仓 `alarm-list` 的 `showNormal` 开关就是 `hit` 与 `alarm` 之间的差。

**`info-feed`（18）**：`title` · `showDot` · `dotSize`(4…24,8) · `dotGlow`(0…24,6) ·
`showLevel` · `levelSize`(10…32,12) · `showTime` · `timeSize`(10…32,12) · `timePlace`(right/left) ·
`textSize`(10…32,13) · `rowBorderStyle`(dotted/dashed/solid/none) · `rowPadX`(0…24,4) ·
`rowPadY`(0…24,7) · `emptyText`(`'暂无信息'`) · `levels`(array `{key,label,color,rank}`) ·
`sortByRank` · `autoScroll` · `scrollSpeed`。

**`gauge-card`（30）**：`title` · `items`(array) · `emptyText` ·
`layout`(auto/single/grid) · `columns` · `gap` · `padX` · `padY` ·
`shape`(arc/linear/track/tank/thermometer) · `geometry`(object `{thickness,arcSpan,tankWidth,tubeWidth,bulbSize}`) · `fillStyle`(solid/gradient) ·
`scale`(object `{showRange,ticks,tickCount,wanFormat,wanDigits}`) · `tickSize`(8…20,10) ·
`targetMark` · `targetLabel` · `showPercent` ·
`readout`(value/percent/both/none) · `readoutPlace`(center/beside/below) · `valueSize` · `valueColor` · `valueGlow` ·
`unitSize` · `unitPlace` · `labelPlace`(above/below/left/hidden) · `labelSize` · `labelTone` ·
`fillColor` · `trackColor` · `thousands` · `rules`。

`geometry` 簇缺省：`{ thickness:0, arcSpan:270, tankWidth:56, tubeWidth:14, bulbSize:26 }`
（`thickness: 0` = 随样式：弧 9 / 条 12 / 轨道 18；56 / 14 / 26 逐字取自参考仓 `entity-gauge`
的 `.eg-tank` / `.eg-thermo-tube` / `.eg-thermo-bulb`）。
`scale` 簇缺省：`{ showRange:false, ticks:false, tickCount:4, wanFormat:false, wanDigits:2 }`。

### 5.3 行内字段（每模块 ≤10）

| 模块 | 行内字段 |
|---|---|
| `info-card` | `label` · `unit` · `precision`(0…6) · `valueKind`(number/text/boolean) · `trueText`(`'运行'`) · `falseText`(`'停止'`) · `emoji` · `icon`(image) · `color` · `emitValue` |
| `info-list` | `label` · `unit` · `precision` · `tag` · `group` · `color` · `icon`(image) · `range`(object `{min,max,target}`) · `desc` · `emitValue` |
| `gauge-card` | `label` · `unit` · `precision` · `min` · `max` · `target` · `color` · `emitValue` |
| `info-feed` | 无——行全部来自绑定，这正是它分家的理由 |

⚠ `unit` **不 trim**：`'° C'` 这类带空格是用户显式的排版意图。
⚠ `valueKind` 只对 `number` 评估规则。
⚠ `range.target` 与 `min`/`max` 刻意**无 `default`**：留空 = 不画目标标记、不算完成率。
⚠ 「留空 = 不判」的数值一律用 `readLooseNumber`（返回 `number | null`，数字字符串也收），
不用 `readNumber`。`readNumber` 只认真数字，JSON 导入里的 `'80'` 会被静默丢掉，
于是完成率口径悄悄从「值 ÷ 目标」退化成「量程占比」——数字照样在屏上，只是含义变了。
⚠ `color` 填了就固定纯色并压过渐变（渐变三前提的第二条）。
⚠ `emitValue` 空串 = 这一行/格点了不上抛。

### 5.4 `ConfigField.when` 只判同级单条件

`isFieldVisible` 的正文就一行 `condition.in.includes(config[condition.key])`。
切成四个模块之后，下列死配置**自动消失**，不再需要 `when`：

| 原来的死配置 | 现在归谁 |
|---|---|
| 行列表档下的 `columns` / 行数 / 格间距 | `columns` 只在 `info-card` / `gauge-card`；`gapX` / `gapY` 只在 `info-card`，`gap` 只在 `gauge-card` |
| 网格档下的 `autoScroll` / `scrollSpeed` | 只在 `info-list` / `info-feed` |
| 网格档下的 `grouping` / `columnHeader` / `rowFilter` / `rowSort` / `holdSeconds` / `calmText` | 只在 `info-list` |
| 卡片档下的 `meter` 那 11 个子旋钮 | 只在 `info-list`（`gauge-card` 有自己的 `shape` + `geometry`） |
| 非仪表模块的 `arcSpan` / `tankWidth` / `bulbSize` | 只在 `gauge-card` 的 `geometry` 簇 |

剩下的单条件 `when` 各自成立（同级、单键）：`info-list` 的 `columnHeader` 与 `unitPlace: 'column'`
挂 `rowLayout`；`gauge-card` 的 `geometry` / `scale` 子键在簇内挂 `shape`——⚠ 不行，
**簇内子字段的 `when` 判的是这一簇自己的同级取值**（`ObjectControl` 的
`visibleFields` 传的 `values` 是簇内记录），判不到顶层的 `shape`。所以 `geometry` 的
五个子键一律全摆，靠 `help` 说明「哪一档用哪个」，并在 §10 记为已知死配置。

### 5.5 层级：`MAX_DEPTH = 3` 的算术

`ConfigFieldControl.vue` 的规则是 `depth >= 3 && (itemSchema !== undefined || fields !== undefined)`
→ 强制降级 `JsonControl`；`PropertyPanel` 传 `depth = 0`，`ArrayControl` / `ObjectControl` 各 +1。

```
items(array, depth 0) → 行内字段 depth 1
  └ range(object, depth 1) → min/max/target(depth 2，无子结构 → 正常控件 ✓)
rowLines(array, depth 0) → left/left2/right/right2(depth 1，枚举 ✓)
rules(array, depth 0) → op/value/value2/level/color/label/blink(depth 1 ✓)
meter(object, depth 0) → 11 个子键(depth 1 ✓)
extras(array, depth 0) → label/unit/precision(depth 1 ✓)
```

**层级余量充裕**（最深用到 2）——这是把三套阈值上提到整块级换来的。降级的触发条件是
「自己在 depth ≥ 3 **且**自己还有 `itemSchema` / `fields`」，所以还差两级：给 `range` 再加一个
object 子块，那个块渲染在 depth 2 仍是正常控件，要它的子块的子块（depth 3 且带容器）才降级。
⚠ 真降级时属性面板不会有任何提示，只是那一格突然变成一个 JSON 文本框。清单测试里钉一条：
**没有 depth ≥ 3 的容器字段**（按 `configSchema` 递归算深度，不靠人数）。

### 5.6 模板嵌套：`MAX_TEMPLATE_DEPTH = 6`

`check_ts_style.py` 的 `TRANSPARENT_TAGS` 只放过
`template` / `slot` / `Teleport` / `Transition` / `TransitionGroup` / `KeepAlive`，其余每层都算。
深度按**单个文件**量，所以拆子组件是唯一的解法：

```
info-list/Component.vue :  ModulePanel(1) > body(2) > ScrollList(3) > section 组头(4) > InfoRow(5)   ✓
info-list/InfoRow.vue   :  .il-row(1) > .il-body(2) > .il-line(3) > .il-group(4) > RowMeter(5)       ✓
info-card/InfoCell.vue  :  .ic-cell(1) > .ic-col(2) > .ic-head(3) > CellCompare(4)                   ✓
```

⚠ 对比块（参考仓 `.kpi-compare` 是 arrow + delta + label 三段）与徽章各拆成
`CellCompare.vue` / `RowBadge.vue`，别在格/行组件里内联展开——内联就是 6 层起步。
⚠ `check_ts_style.py` 还有 `MAX_PROPS = 10`（按 `defineProps<{…}>` 里的属性行数数）。
子组件的入参一律收成对象（`{ row, look }`），别把十几个尺寸逐个当 prop 传。

---

## 6. 绑定槽与逐格四档

### 6.1 三种槽

```ts
// info-card / gauge-card：行钉在配置里的第 i 项上
bindings: [{
  key: CARD_SLOT_KEY,               // 'cardValues' / 'gaugeValues'
  label: '卡片读数', dataType: 'number', isArray: true, isEntityPinned: true,
  arrayFields: [
    { key: 'value', label: '主读数', dataType: 'number' },
    { key: 'aux',   label: '对比值 / 目标实际值', dataType: 'number' },
  ],
}]
```

```ts
// info-list：同样钉在实体上，但子槽多
arrayFields: [
  { key: 'value',  label: '主读数',   dataType: 'number' },
  { key: 'aux',    label: '副读数 1 / 判据值', dataType: 'number' },
  { key: 'aux2',   label: '副读数 2', dataType: 'number' },
  { key: 'aux3',   label: '副读数 3', dataType: 'number' },
  { key: 'status', label: '设备状态', dataType: 'number' },   // ⚠ 刻意不给 enumMap（§2.3）
  { key: 'name',   label: '行名',     dataType: 'string' },
  { key: 'text',   label: '描述',     dataType: 'string' },
  { key: 'time',   label: '时刻文本', dataType: 'string' },
  { key: 'extra1', label: '扩展 1',   dataType: 'number' },
  { key: 'extra2', label: '扩展 2',   dataType: 'number' },
  { key: 'extra3', label: '扩展 3',   dataType: 'number' },
]
```

```ts
// info-feed：列表式，刻意不给 isEntityPinned、不给 bindingRowCounts
bindings: [{
  key: FEED_SLOT_KEY, label: '信息流条目', dataType: 'string', isArray: true,
  arrayFields: [
    { key: 'level', label: '级别', dataType: 'string' },
    { key: 'text',  label: '内容', dataType: 'string' },
    { key: 'time',  label: '时间', dataType: 'string' },
  ],
}]
```

**四个数值槽的下界是数出来的。** 逐个数参考仓的 `arrayFields`：`list` / `tag-table` /
`metric-status-table` / `alarm-list` 各 **1** 个（都叫 `value`）；`terminal-list-v2` **4** 个
（`todayKwh` + 两个 label 里自陈「本模块不渲染」的死槽 + `status`）；`source-list` **9** 个
（8 个数值 + `status`）；`vessel-list` **5** 个数值（`temperatureC` / `targetC` / `levelPct` /
`storedKwh` / `designKwh`）；`work-order-list` **4** 个字符串。落到新模型：

- `source-list` 的 8 个数值里，`inputKwh` / `netKwh` 走净产能三级回退（§10.6 不迁）、
  `todayKwh` 只是 `outputKwh` 的顶替、`powerKw` / `temperatureC` / `flowM3h` 落 `extra1..3`，
  真正要通用槽的只剩 `outputKwh`（主读数）与 `cop`（副读数）——**2** 个。
- `vessel-list` 的 5 个里，`targetC` 只进参考仓的行 tooltip（§10.6 不迁）、`designKwh` 是
  `meter.source: 'range'` 的量程上界（走行内 `range.max`），要通用槽的是 `storedKwh`（主读数）
  + `temperatureC`（副读数）+ `levelPct`（第二条进度条）——**3** 个，这是全部 15 个模块里的下界。
- 三个选源旋钮 `subSource` / `meter.source` / `meter.source2` 各自独立，都可能指向副读数槽，
  所以**主读数 1 + 副读数 3 = 4** 个通用数值槽是够用的最小值。`aux3` 在这一批预设里没人用，
  它留给「副读数 + 两条各自取值的进度条」这一种组合，缺了它那种行就配不出来。

- **`isRequired` 一个都不给。** 数组槽的行是可选的（配了 10 项先接 3 个是常态）；
  给了会让整块被判 `unbound` 并被状态浮层盖住，`ownsStatusDisplay` 白开。`metric-card` 同口径。
- **`isEntityPinned: true` 与 `bindingRowCounts` 必须同时给。** 漏 `bindingRowCounts` → 面板把
  它当「行由用户手工增删」，摆出一个加了也永远喂不到东西的「新增一行」；⚠ 一项都没有的槽
  也要给 `0`，别把键漏掉。漏 `isEntityPinned` → 服务端套「索引连续且从 0 起」，
  「配了 10 项只绑第 2 个」直接存不下去，而错误文案说的是索引不连续。
  ⚠ **它数的是「行」不是「子槽」**（`ModuleSpec` 的原文：「数组绑定槽各应有几行，键是槽键」）：
  `{ [LIST_SLOT_KEY]: items.length }` 一个键一个数，`value` / `aux` / `aux2` / `aux3` / `status`
  / `name` / `text` / `time` / `extra1..3` 这 11 个子槽是同一行里的 11 列，加子槽不改这个数——
  只让 `BindingPanel.vue` 那份「行 × 子槽」的平铺变长（§5.1）。
- **`bindingRowLabels` 的键是该行第一个子槽的 `fieldKey`**（`cardValues[0].value`），
  返回 `{ title, id }` 两样：没有 `id` 时两个同名指标在绑点面板上长得一模一样。
- **`isTimeSeries` 一个都不给**：目标仓它对 `archive` / `dataset` 一律返回「序列要异步取数，
  画布上不展开」。见 §14。

### 6.2 「后端推送的工单列表」怎么做出来

参考仓 `work-order-list` 的四个字符串子槽 `dept` / `status` / `desc` / `time` 全可绑，
落到新模型：

| 参考仓子槽 | 新模型 |
|---|---|
| `dept`（车间/对象） | 绑定 `name` 子槽；未绑时回落行内 `item.label` |
| `status`（带 `enumMap 0/1/2`） | 绑定 `aux` 子槽（数值）+ `subSource:'aux'` + `alarmOn:'sub'`，`badge.kind:'rule'` + 三条 `eq` 规则给出文案与颜色（§3.3）。**不声明 `enumMap`**——声明了会让数值先被换成文案，规则再也判不了数 |
| `desc`（描述） | 绑定 `text` 子槽；未绑时回落行内 `item.desc` |
| `time`（检查时间） | 绑定 `time` 子槽 + `timeSource:'bound'` |

「绑定优先、缺值回落配置」这条口径与参考仓的 `pick(bound, fallback)` 一致：
绑定值非 `null` 且非空串时取绑定，否则取配置。

### 6.3 `ownsStatusDisplay: true` 与逐格四档

四个模块都是多点位模块，**必须**开——不开的话，十行里坏掉一行会让整块被「取数失败」盖住，
另外九行明明有值却一个都看不见。开了就必须自己把四档画满：

| 档 | 判据 | 画什么 |
|---|---|---|
| `unbound` | `meta.slots` 里**没有**这一行的 `fieldKey` | 读数位 `emptyText`，脚注位小字「未绑定」 |
| `pending` | `slots[key].state === 'pending'` | 「等待首帧」 |
| `error` | `slots[key].state === 'error'` | 「取不到」，完整原因挂 `title` |
| `ok` | `state === 'ok'` | 正常读数 + 单位 |

⚠ **四档在 `values` 里长得一模一样（键都不存在）**，全靠 `meta.slots` 分开
（`ModuleSlotMeta` 的注释写的就是这件事）。合成一档的代价是现场断了的那一格
与从没配过的那一格在墙上是同一个「—」。
⚠ **单位、徽章、进度条、刻度只在 `ok` 档画**：「— kV」「一条空轨道」看着都像有读数。
⚠ `meta.slots` **只在自报 `ownsStatusDisplay` 时才下发**；采样时刻取 `slots[key].timestampMs`。
⚠ `ModuleStatus` 没有 `stale` 这一档（`MODULE_STATUSES` 五档里没有它），
参考仓 `terminal-list-v2` 判 `meta.status === 'stale'` 那一段在这里是死代码——
值有多旧由 `valueTimeMs` 照实说。

### 6.4 交互

四个模块都 `emitsInteractions: true`（按行/格上抛 `item.emitValue`）+ `hostClickable: true`
（整块由宿主接管）。`interactionEvents` 不声明（缺省 `['click']`）。

⚠ **格内点击必须有条件吞冒泡**：配了 `emitValue` 就 `@click.stop`，没配就放它上去让整块兜底
捕获。两边都吞或都不吞，toggle 类动作会当场自我抵消或整块兜底失效。空值不上抛由
`shared/interaction.ts` 的 `rowClickEmitter` 兜着。

---

## 7. `configPresets`（21 个，把参考仓那 15 种观感做成一键）

预设是一次浅合并落库、一步撤销、未列出的键原样保留。取值见 §1.3 的覆盖表。

| 模块 | id | label | hint |
|---|---|---|---|
| `info-card` | `kpi-single` | 单值大字 | 一块一个读数，居中大字 + 下方标签 + 涨跌对比。 |
| | `kpi-grid` | 指标小卡 | 自适应网格，每格描边渐变小卡 + 左侧发光竖条。 |
| | `icon-grid` | 图标网格 | 圆形图标 + 右侧「标签上/读数下」，气象与环境量的排法。 |
| | `icon-column` | 图标竖排 | 图标在上、标签与读数居中，窄块用。 |
| | `plain-grid` | 裸排网格 | 无边框无底，纯标签与读数，密排大屏用。 |
| `info-list` | `row-list` | 点线行列表 | 一行一个点位，左标签右读数，点线分隔 + 自动滚动。 |
| | `three-col` | 三列表 | 名称 / 数值 / 单位三列对齐，带表头，超长自动滚动。 |
| | `target-badge-list` | 指标维护表 | 双行行卡：名称与读数在上，目标与状态徽章在下。 |
| | `source-card` | 能源源卡片 | 左图标 + 状态徽章 + 分类标签 + 占比条 + 扩展指标行。 |
| | `terminal-card` | 分类末端卡 | 顶部分类 tab，行内「当日读数 + 定宽占比条」。 |
| | `vessel-card` | 容器卡片 | 按类型分段的组头，行内两条同构进度条（占比 / 液位）。 |
| | `work-order` | 工单条目 | 左侧状态色边 + 底纹，实心徽章 + 描述 + 时间。 |
| | `alarm-rows` | 活动告警 | 只显示命中告警的行，按严重度降序，行首严重度点 + 起始时刻。 |
| `info-feed` | `feed-plain` | 消息流 | 圆点 + 级别 + 正文 + 右侧时间，点线分隔。 |
| | `weather-alert` | 气象预警 | 预警五色（含橙）+ 按级别排序。 |
| `gauge-card` | `target-track` | 目标进度 | 顶行标题与读数，下方带刻度与目标标记的粗轨道。 |
| | `arc-gauge` | 弧度盘 | 270° 圆弧 + 居中读数 + 量程端点。 |
| | `linear-bar` | 横向条 | 细长胶囊条 + 右侧读数，窄块用。 |
| | `tank` | 储罐 | 竖向液面 + 液面高光 + 居中读数。 |
| | `thermometer` | 温度计 | 管 + 球 + 右侧读数。 |
| | `gauge-grid` | 仪表阵列 | 一行几个同款仪表，网格等分。 |

⚠ **两条最便宜也最有效的闸**（纯数据、不用挂载）：① 每个 `preset.config` 的键都必须在
`configSchema` 顶层键集合里；② 每个枚举取值都必须在该字段的 `options` 里。预设里写错一个
键或一个档位名，是标准的「配了不生效」——点了按钮什么都没发生，而 typecheck、lint、build 全绿。

⚠ 第三条：**每个预设都写全清单里的每一个簇，且子键顺序与该字段 `default` 逐字相同**
（§5.1 定死的 A 案）。缺掉整个簇 = 上一个预设的那一块原样残留，而按钮照样点亮。
⚠ 第四条：**`rules` 与 `color` 里的颜色一律 `var(--` 开头**（§3.3）。
⚠ `activePresetIds` 做子集比较，多个预设同时点亮是正常的（`plain-grid` 与 `icon-grid` 有交集）。
⚠ `configPresets` 不进 `module_types.json`：`catalog.ts` 的文件头写明只序列化与渲染无关的那部分，
`preview` / `configPresets` / `defaultConfig` 都不进。

---

## 8. `shared/` 复用：逐个交代

| 件 | 用不用 | 怎么用 |
|---|---|---|
| `shared/thresholds.ts` | **只用求值器与常量** | `evaluateThresholds`（逐条调用，§3.2）· `THRESHOLD_OPS` / `THRESHOLD_LEVELS` / `SEVERITY_RANK`（`rowSort: 'severity'` 用它）/ `levelColor`（规则 `color` 空串时的回落）/ `isAlarmLevel`（`rowFilter: 'alarm'` 用它）。⚠ **不用 `thresholdsConfigField`**：它的行里没有颜色（§3.1）。⚠ **一个字都不改这个文件** |
| `shared/format.ts` | **用** | `NO_DATA` / `isPresent` / `toNumOrNull` / `fmtNumber`（千分位）/ `fmtTrim`（去尾零）/ `fmtDecimal`（补零）/ `fmtKwh` / `fmtClock`。⚠ `.vue` 里禁 `new Date(` 与 `toLocaleString(`（`check_ts_style.py` 的 `check_formatting_is_centralised` 只扫 `_components()`），全部走这里 |
| `shared/status.ts` | **用** | `DEVICE_STATUSES` / `toDeviceStatus` / `STATUS_LABEL`，`badge.kind: 'device'` 那一档。⚠ 缺值恒 `unknown`，连 `fallback` 都不给用 |
| `shared/StatusBadge.vue` | **用** | `badge.kind: 'device'` 直接渲染它（props 就 `status` 与可选 `label`），不再自绘。参考仓 `metric-status-table` 自绘的那套无圆点无动画徽章，正是 `badge.kind: 'rule'` + `style: 'outline'` 那一档 |
| `shared/ScrollList.vue` | **用** | `info-list` / `info-feed` 包住行；props `itemCount` / `autoScroll` / `secondsPerItem`。⚠ 它在真滚起来时**渲染两份内容副本**（第二份 `aria-hidden`）做无缝衔接——slot 里**不许出现 `id` / `aria-controls` / `aria-describedby`**，否则运行时出现重复 id。所以分类 tab 条必须摆在 `ScrollList` **外面**。⚠ 「减少动态」偏好退回原生滚动而不是只停动画，别在外面再包一层 `overflow: hidden` |
| `shared/scroll.ts` | **用** | `scrollConfigFields(3)` + `readScrollSettings`。⚠ 参考仓这九个带滚动的列表里每项秒数默认值有四种（`source-list` 5 / `vessel-list` 4.5 /
`terminal-list-v2` 4 / `list`、`tag-table`、`metric-status-table`、`alarm-list`、`work-order-list`、
`feed-list` 六个走 `scrollConfigFields()` 的缺省 3），统一成 3 会让卡片行飞过去——差异落在**预设**里而不是字段默认值里 |
| `shared/ModulePanel.vue` | **用** | 标题 + 主体两段，卡片框由宿主 chrome 提供。四个模块都**不自绘标题行**——参考仓 `target-progress` 自绘 `.tp-head` 导致宿主标题栏永远不出。因此 `unsupportedChromeKeys` **一个都不声明**（吃全套 chrome 键，与 `metric-card` 同） |
| `shared/config.ts` | **用** | `readText` / `readTrimmedText` / `readBoolean` / `readNumber` / `readEnum` / `readLooseNumber` / `readArray` / `readRecord` / `configDefaults`。⚠ `readNumber` 的 `fallback` **必填**；⚠ `readEnum` 只认字符串字面量，不做数字/布尔的字符串化 |
| `shared/interaction.ts` | **用** | `rowClickEmitter(emit)`，空值不上抛；`.stop` 由模板写 |
| `shared/assetImage.ts` | **用** | `resolveImageValue(value)`。⚠ 精确行为：只有 **`asset:` 引用**在解析不出时返回空串（未注入 resolver 时 `resolver(text)` 为空），**普通 URL 与 CSS 值原样透传**。所以「测试环境里 `item.icon` 填 URL 渲染不出来」是错的，它渲染得出来；模板仍要 `v-if` 判空再画 `<img>`，否则素材引用那一档出碎图 |
| `shared/container.ts` / `shared/background.ts` / `shared/tagSource.ts` | **不用** | 不是容器、不画背景图层、取值走注入的绑定求值不自读点位快照 |
| `shared/chart/*` | **不用** | 四个模块一个都不碰。⚠ `packages/modules/src/index.ts` 刻意不导出 `shared/chart/*`——`check_bundle_budget.py` 的 `HEAVY` 名单含 echarts，barrel 一 re-export 就把它焊进首屏静态图 |

---

## 9. 目录树与行数

```
web/packages/modules/src/modules/info-card/          ≈ 2950 行
  manifest.ts     ~180  身份 · 拼 schema · bindings · presets · 派生行数行名 · preview
  schema.ts       ~480  33 个顶层字段（按分段一个函数）
  itemSchema.ts   ~120  行内 10 字段
  presets.ts      ~200  5 个 configPresets
  options.ts      ~160  全部枚举取值表 + valuesOf() 推 readEnum 白名单
  rules.ts        ~90   带 color 的规则字段 + 规整 + 逐条求值（§3.2）
  look.ts         ~280  config → CardLook（夹取 · 修饰类 · --ic-* 变量 · 哨兵 0）
  cells.ts        ~380  config+values+slots → InfoCell[]（四档 · 规则 · 格式化 · 渐变三前提）
  bindingRows.ts  ~70   槽键/项键常量 · fieldKey · rowLabels · rowCounts
  Component.vue   ~200  三排布容器 · 空态 · 上抛
  InfoCell.vue    ~240  一格四段
  CellCompare.vue ~90   涨跌块（arrow + delta + label）
  _grid.scss / _variants.scss / _cell.scss  ~110 / ~200 / ~150

web/packages/modules/src/modules/info-list/           ≈ 3500 行
  manifest.ts ~200 · schema.ts ~500 · itemSchema.ts ~140 · presets.ts ~300（8 个）
  options.ts ~180 · rules.ts ~90 · look.ts ~300
  rows.ts ~200 · rowValue.ts ~180 · rowAlarm.ts ~170   ← 一个文件装不下（见下）
  hold.ts ~80（纯函数，定时器在 Component.vue）· bindingRows.ts ~70
  Component.vue ~280（分组/tab/表头/ScrollList/空态三档）
  InfoRow.vue ~260（lead ｜ 三段 lines ｜ tail ｜ extras）
  RowMeter.vue ~150 · RowBadge.vue ~90
  _list.scss ~140 · _variants.scss ~240 · _row.scss ~180

web/packages/modules/src/modules/gauge-card/          ≈ 2750 行
  manifest.ts ~170 · schema.ts ~420 · itemSchema.ts ~100 · presets.ts ~180（6 个）
  options.ts ~150 · rules.ts ~90 · geometry.ts ~160（describeArc / polarToCartesian / 弧长）
  look.ts ~250 · gauges.ts ~250 · bindingRows.ts ~70 · Component.vue ~180
  GaugeArc.vue ~140 · GaugeLinear.vue ~110 · GaugeTank.vue ~110 · GaugeThermo.vue ~110
  _gauge.scss ~260

web/packages/modules/src/modules/info-feed/           ≈ 1030 行
  manifest.ts ~230 · levels.ts ~130 · rows.ts ~130 · look.ts ~120
  Component.vue ~190 · FeedRow.vue ~120 · _feed.scss ~110
```

四个模块合计约 **10 200 行源码 + 4 000 行测试**。这是一个大程序，不是一次小补丁——
参照物：`metric-card` 用 1 074 行源码 + 655 行测试供了 13 个字段与一套四段带阈值，
`action-button` 用 1 171 行供了 30 个字段与 3 套预设。

拆分理由与闸门：

- **单文件组件 ≤500 行**（`check_ts_style.py` 的 `MAX_SFC_LINES`，按**全文行数不跳空行**，
  比 eslint 的 `max-lines` + `skipBlankLines` 更严）。
- ⚠ 普通 `.ts` **不限行数**（eslint 的 `max-lines` 只对 `**/*.vue` 与 `**/stores/*.ts` 开），
  但**文件名以 `use` 开头的 `.ts` 上限 200 行**。所以逻辑文件叫 `look.ts` / `rows.ts` / `hold.ts`
  而不是 `useLook.ts`。
- ⚠ eslint 另有 `complexity: 10` / `max-depth: 4` / `max-params: 5` /
  `max-lines-per-function: 50`（skipBlankLines + skipComments）。`info-list` 的行取值逻辑
  （四档状态 × 规则求值 × 格式化 × 万换算 × 占比含全表正数合计 × 筛选 × 严重度排序 ×
  boolean/text 分支）在这些约束下必然是十几个小函数——**放一个文件里没人读得动**，
  所以预先切成 `rows.ts` / `rowValue.ts` / `rowAlarm.ts` 三份。
- ⚠ `packages/*` 不许 Tailwind（`check_web_styles.py`），全部 scoped SCSS + `var(--…)`；
  `.vue` 的 `<style>` 与所有 `.scss` 里**不许硬编码色值**（`#hex` / `rgba(` / `hsl(`）。
- ⚠ 所有文件都在**模块目录顶层**：`manifests.contract.spec.ts` 的 `moduleFiles()` 只
  `readdirSync` 一层，把取值搬进 `render/` 子目录会让「绑定槽键两侧逐一对上」这条闸判成
  「声明了没人读」。

### 9.1 CSS 变量命名空间

`--ic-*`（info-card）/ `--il-*`（info-list）/ `--if-*`（info-feed）/ `--gc-*`（gauge-card）。
每个模块 20–30 个。

⚠ **这套变量没有全局闸看着。** `app/tests/contract/css-variables.contract.spec.ts` 的
`SCAN_ROOTS` 只有 `app/src` 与 `packages/ui/src`，**扫不到 `packages/modules/src`**——
`--ic-vlaue-size` 这种拼错不报错、不生效。所以自己加一条：`look.ts` 里把变量名写成一个
字面量联合（`IcVarName` / `IlVarName` / …，`action-button` 的 `ButtonVarName` 是同一个思路），
契约测试断言「联合里的每个名字在本模块的 scss 里至少被 `var(--…)` 引用一次」且反向也成立。

⚠ **闪烁的 `@keyframes` 留在 scoped 块内、用字面量名。** Vue scoped 编译会给块内
`@keyframes` 改名加 hash，同时改写同一块内的 `animation-name` 引用，所以字面量在 scoped
内是自洽的。反过来，从 CSS 变量注入动画名的必须定义在全局——那是 chrome 的事，不是模块的事。

### 9.2 「不做成一堆 if」

四个模块同一套结构，沿用 `action-button/look.ts` + `_variants.scss` 与 `header/_variants.scss`：

```
config ──► look.ts ──► Look { classes: string[], vars: Record<VarName, string>, nums: {…} }
config + values + meta.slots ──► rows.ts / cells.ts ──► RowView[] / CellView[]（纯数据）
```

三条规矩：

1. **数值一律夹回清单声明的 `min` / `max`。** `min` / `max` 只约束属性面板，脏配置里的 `-8`
   会让整条 CSS 声明被浏览器丢掉，`0` 字号会让读数彻底看不见。
2. **枚举取值表清单与渲染共用一份**（`options.ts` + `valuesOf()` 推 `readEnum` 白名单，不手抄）。
3. **「没配 = 不写键 = 不注入变量」**，与 chrome 同一条铁律：注入了空串就落不回
   `_variants.scss` 里 `var(--x, 兜底)` 的档位缺省。

模板里的 `v-if` 全部判「有没有内容」，从不判档位名。

---

## 10. 明确的偏离

以下是**表达不出来或有意收窄**的，逐条记在案。除此之外的 15 个模块观感都在 §1.3 的取值里。

1. **`entity-gauge` tank 的 `mix-blend-mode: difference` 居中读数不沿用**（§4.2）。它新建层叠
   上下文，与可配的半透明 chrome、毛玻璃、辉光叠加后不可预测。改成可配前景色 + 描边阴影。
2. **`vessel-list` 分段组头的图标不迁。** 参考仓是 lucide 组件（`Container` / `Network`）+ 标题
   + 计数 + `drop-shadow` 辉光；新模型的 `grouping: 'section'` 组头是「`item.group` 字符串 + 计数」，
   **没有 per-section 图标位**（分组键是自由字符串，没有地方挂图标）。
3. **`vessel-list` 的 `maxRows` 性能护栏不迁。** 它是「默认 0 = 不限」的截断开关。真要护栏
   应该做成通用件（`ScrollList` 是 CSS 动画不是虚拟列表），而不是四个模块各加一个字段。
4. **`vessel-list` 的每项秒数 4.5 → 4。** `scrollConfigFields` 的 `scrollSpeed` 是
   `step: 1`、`min: 1`、`max: 30` 的整数 range。
5. **`source-list` 的「占比 xx%」文字随条走进右列。** 参考仓 `.src-foot` 是
   grid `minmax(0,1fr) minmax(72px,30%)`，「能效 + 占比%」在左列、share 条在右列；
   新模型的 `meter` 件把 label + 百分比读数 + 条绑在一起，于是变成
   「能效 ⟷ 占比 xx% ▓▓▓」。同一行、同样的信息、列分割点不同。
6. **`source-list` 的行 tooltip 与领域公式不迁。** 净产能三级回退、COP 推导、
   `V × ΔT × 1.163` 水储能都是能源银行的领域算法，不是卡片样式。派生值走绑定的
   `computed` 来源或台账层。代价是 `source-card` / `vessel-card` 两个预设要现场先配几条
   `computed` 绑定才有「能效 / 储能」这两个数。
   ⚠ 顺带记下参考仓那处双真源：`baselineTempC` 在 `vessel-list/index.ts` 的 `itemSchema.default`
   与 `Component.vue` 的 `?? 20` 里各有一份 `20`，注释自陈「必须与组件兜底同值」。
   两份手工维护的真源，漂了会让同一模块里两种行按不同基准算储能，50 m³ 水箱差上千 kWh。
7. **「万」格式的刻度与 pill 统一成一个 `wanDigits`。** 参考仓 `fmtTick` 写死 1 位小数而 pill
   用 `wanDigits`——同一张卡上两套口径，这一版收成一套。
8. **`kpi-card` 的三级文案收成两级。** 参考仓是「告警文案 > 标签文本 > 副标题」；
   新模型是「命中规则的 `label` > `item.label`」，`foot`（第三级）不迁。
9. **`kpi-group` 的行内 `prefix` 与 per-cell `foot` 不迁。** 行内字段预算 10 个用尽
   （§5.3）。`prefix`（值前缀，如 ¥）可以写进 `label`；per-cell 脚注没有替代。
10. **`kpi-group` 的计算源浮层不迁**（`calcSummary` / `calcFormula` / `calcParts` +
    ⓘ Teleport 浮层）。三个行内字段占预算三成，浮层本体约 200 行且要手算定位避开舞台
    `transform: scale`。进 §14。
11. **`terminal-list-v2` 的 `demandKw` / `satisfactionPct` 两个「可绑但不渲染」的死槽不迁。**
    参考仓的 label 里直书「本模块不渲染」，存量大屏上真有点位绑在上面；跨仓迁移没有存量。
12. **`terminal-list-v2` 对非法分类静默归 `heating` 的口径不沿用。** 那是参考仓从 v1 到 v2
    的一处语义回归（脏数据被算进采暖的计数里）。新模型的分组键是自由字符串 `item.group`，
    认不出的行落进「其它」段且不计入任何 tab 计数——回到 v1 的口径。
13. **`gauge-card` 的 `geometry` 五个子键全摆。** 簇内子字段的 `when` 判的是**簇内**同级取值
    （`ObjectControl` 传的是簇记录），判不到顶层的 `shape`。所以「储罐宽度」在弧度盘档下
    照样摆着，只能靠 `help` 说明。这是一处已知的死配置。
14. **`icon-kpi-group` 的 `rows`（网格行数等分）不迁。** 它在参考仓的缺省就是 `'auto'`，
    `info-card` 只保留 `columns`，行数一律由 `grid-auto-rows` 自适应。要等高行只能靠外层高度。
15. **`kpi-card` 的 `valueScale` 不迁。** 参考仓它是叠在自适应字号上的 0.5–2 倍率，
    用来「自动但再大一点」。`info-card` 只有 `valueSize`（`0` = 自适应，非 0 = 钉死一个字号），
    想微调只能放弃自适应。
16. **`metric-card` 的三处不等价不补齐**（§1.4）——它们是并存的理由。
17. **`source-list` 的行级告警态做成叠加修饰类，不是 `rowShell` 的第六档**（§5.2）。描边色
    （`--state-danger`）、`src-alarm` 1.2s 呼吸与 `prefers-reduced-motion` 下的静态回退逐字照搬；
    偏离在**判据**上：参考仓只看设备状态 `row.src.status === 'alarm'`，新模型在 `badge.kind`
    不是 `device` 时改看 `alarmOn` 指的读数有没有命中 `level > normal` 的规则——否则一个不接
    设备状态槽的列表永远亮不起来。
18. **严重度词表在模块自己的 `options.ts` 里，不复用 `LEVEL_OPTIONS`**（§2.3）。四个词逐字取自
    参考仓 `alarm-list` 的 `LEVEL_TEXT`（正常 / 提示 / 警告 / 危急）；`shared/thresholds.ts` 的
    `LEVEL_OPTIONS` 是属性面板的下拉项，label 写成「危险（红）」。于是同一个 `danger` 在下拉里
    叫「危险」、在徽章上叫「危急」——两份词表并存，改任何一份都不该顺手同步另一份。
19. **`vessel-list` 的 `designKwh`（设定储能）从可绑子槽退成行内静态 `range.max`。** 参考仓它是
    `arrayFields` 里的一个绑定子槽，也就是说分母本身可以是一个实时点位；新模型 `meter.source` 的
    五档（`range` / `share` / `aux` / `aux2` / `aux3`）里没有「拿另一个绑定值当分母」这一档，
    所以设计容量只能在属性面板上逐行填死。⚠ 表现是**容量改了而墙上的百分比不跟着变**，两边都不报错。
    真要动态分母，正确的位置是给这一行配一条 `computed` 绑定直接算出百分比，再让 `meter.source`
    指向那个副读数槽——而不是给 `meter` 加第六档选源（那会让「分子分母各自选源」这件事在
    属性面板上多出两个旋钮，而只有这一个模块用得上）。
20. **两条进度条共用一套样式子键。** `meter` 簇里只有 `source` / `label` 各两套，
    `kind` / `height` / `width` / `color` / `glow` / `dot` / `showPercent` 是两条共享的。
    参考仓 `vessel-list` 的两条并不同款：`.vsl-ratio` 有 4px 发光圆点、条色跟 `tempColor` 走，
    `.vsl-level` 没有圆点、用 `--chart-cold` 一个固定色。于是 `vessel-card` 预设里
    `dot: true` 会给液位条也画上一个参考仓没有的点，两条也不可能异色。
    收窄的理由是字段预算：拆成两套要再加 7 个子键，而 `info-list` 的 35 个顶层字段已经零余量。

---

## 11. 照抄参考仓会静默失效的

| 照抄了什么 | 后果 | 正确做法 |
|---|---|---|
| `defaultSize: { w, h, minW, minH }` | 多余键在 TS 上会红（好），但经变量/spread 绕过后初始尺寸变 `undefined` | `{ width, height, minWidth, minHeight }` |
| `required` / `array` / `timeSeries` | `BindingSpec` 上是**多余可选属性**：TS 不报错，绑点面板永远不认为它必绑 | `isRequired` / `isArray` / `isTimeSeries` |
| `type: 'image', assetKind: 'icon'` | 目标仓 `ConfigField` **没有 `assetKind`** | 只写 `type: 'image'` + `help`（`image-block` 的做法） |
| `index.ts` 当模块入口 | `registerBuiltins.ts` 的 glob 只扫 `./modules/*/manifest.ts`，模块从模块库里**消失且不报错** | `manifest.ts` |
| `class="dt-digit"` | 目标仓没有这个全局类（`.dt-digits__*` 是 `DtDigits` 组件内部的），数字静默回落正文字体、丢 `tabular-nums`，大屏上宽度开始抖 | `var(--font-mono)` + `font-variant-numeric: tabular-nums` + `600`（`metric-card` 的既定口径）。也**不用** `DtDigits`：它按 grapheme 逐字包 `<span>`，会打断 `background-clip: text` 的渐变与 `text-shadow`，且一屏几百个读数会多出几千个节点 |
| `var(--card-icon-bg-start / -end / -border / -glow)` | 四个 token 不存在：图标底变透明、描边没了 | `color-mix(in srgb, var(--accent-primary) N%, transparent)` |
| `var(--chart-series-1..5)` / `var(--chart-cold)` / `var(--chart-hot)` | 都不存在：能源类型色与水温色相全丢 | 逐行 `item.color` 或规则的 `color`（§3.3） |
| `var(--chart-value-g1..g4)` | 渐变文字回落成一个非法 `linear-gradient`，整个数值可能不可见 | 缺省色标 `[var(--accent-secondary), var(--accent-primary)]`，且 **<2 个色标整组回落**（`linear-gradient(0deg, x)` 在部分浏览器直接非法） |
| `rgba(var(--state-idle-rgb), .45)` | `--state-idle` **没有** `-rgb` 伴生变量（有伴生的只有 accent-primary / accent-secondary / neutral-fg / state-danger / state-info / state-success / state-warning / text-title），整条声明作废，表现是「那条边框没了」 | `color-mix(in srgb, var(--state-idle) 45%, transparent)` |
| `var(--space-2)` / `var(--space-3)` | 无间距 token，padding 塌成 0 | 写 px |
| `meta.status === 'stale'` | `MODULE_STATUSES` 没有这一档，编译不过；改成可选字段绕过去就是永不显示的死代码 | `meta.valueTimeMs` / `slots[key].timestampMs` 照实说 |
| `cfgNum` / `cfgBool` / `cfgStr` | `readNumber` 不吃数字字符串、`readBoolean` 只认严格 `true`（`showDot: 0` 在参考仓是 false、在这里是 fallback `true`，**开关方向会反**） | 「留空 = 不判」的用 `readLooseNumber`；布尔的默认值按「关掉是安全的那一侧」选 |
| `asRows(config.items)` | `readArray` 丢了 JSON 字符串兼容路径 | 跨仓迁移没有「items 存成 JSON 串」的存量，直接 `readArray` |
| `enumMap: { 0: 'offline' }` | 目标仓契约把 enumMap 定义成「数值 → 中文文案」，且 `applyEnumMap` 真的替换值；照抄会让 `toDeviceStatus` 落到 `unknown`，全屏徽章变灰 | `status` 子槽不声明 `enumMap`，走 `NUMERIC_STATUSES` 旁路 |
| `:key="index"` | `check_ts_style.py` 的 `INDEX_KEY` 直接红 | 行号 + 标签拼键；`alarm-rows` 用行签名（§2.5） |
| 注释里写「原先 / 改造前 / 旧实现 / legacy behavior」 | `check_comments.py` 的 `CHANGE_HISTORY` 整片红——跨仓迁移时这是最自然的写法 | 只写当前功能与原因，见 [comment-style-typescript](agents/comment-style-typescript.md) |

⚠ 还有两条只在闸门里成立的机械约束：

- **取值函数的形参名必须叫 `config` 与 `values`。** `manifests.contract.spec.ts` 的
  `ACCESS` 正则只认字面上的 `config.<key>` / `config['<key>']` / `config[已登记常量]`
  （允许一跳前缀如 `props.config.x`）。叫 `cfg`、或先解构再读，都会让「声明了却没人读的
  死字段」一次报出几十条。
- **用常量做键时要登进 `KEY_CONSTANTS`。** 本次要登 7 个：`CARD_ITEMS_KEY` / `CARD_SLOT_KEY`
  / `LIST_ITEMS_KEY` / `LIST_SLOT_KEY` / `FEED_SLOT_KEY` / `GAUGE_ITEMS_KEY` / `GAUGE_SLOT_KEY`，
  否则报「未登记的键常量 X」。`manifests.contract.spec.ts` 在 `MODULE_REGISTRY` 里，
  改它不破坏落地豁免。
- **`values.<槽键>` 只许在模块自己目录里读**：那条闸比较的是
  `keysOf(moduleFiles(type), 'values')` 与声明的绑定键，**逐一相等**。多读一个、少读一个都红。
  而「死字段」那条查的是**可达集**（沿相对 import 走），所以 `autoScroll` / `scrollSpeed`
  由 `shared/scroll.ts` 消费是算数的。

---

## 12. 测试与闸门

| 层 | 文件 | 守什么 |
|---|---|---|
| 清单 | `tests/modules/<type>/manifest.test.ts` | 身份（type/displayName/category/icon/chrome/`unsupportedChromeKeys === undefined`）；`ownsStatusDisplay` / `emitsInteractions` / `hostClickable` 三个都开、`isRequired` 一个都没有；`isEntityPinned` + `arrayFields` 逐个子槽；**`status` 子槽没有 `enumMap`**；`bindingRowCounts` / `bindingRowLabels` 的返回逐字；每个顶层字段都有 `default`；⚠ **`range.target` / `min` / `max` 那几个刻意没有 default** 的逐个断言；`when` 指的是真存在的同级字段；**行内没有第三层容器字段** |
| 清单 | 同上 | ⭐ 每个 `preset.config` 的键都在 `configSchema` 顶层键集合里；⭐ 每个预设里的枚举取值都在该字段的 `options` 里；⭐ 每个预设都写全清单里的每一个 `type: 'object'` 簇，且子键顺序与该字段 `default` 逐字相同；⭐ 预设里的颜色一律 `var(--` 开头；⭐ `configPresets` 的 id 集合恰等于一份写死的期望清单 |
| 清单 | `tests/modules/info-feed/manifest.test.ts` | ⭐ **槽刻意不是 entity-pinned**：断言 `isEntityPinned === undefined` **且** `bindingRowCounts === undefined`（这是它分家的全部理由，退化成 pinned 会让行数改由 config 决定而界面看不出） |
| 挂载 | `tests/modules/<type>/presets.spec.ts` | ⭐ `it.each(manifest.configPresets)` 逐个挂载（`configDefaults(schema)` 铺缺省 + 预设 + 一组演示 items/values），每条断言三样：关键**修饰类**在 DOM 上、关键 **CSS 变量**在 `attributes('style')` 里、该预设声明要画的**件真的在 DOM 里**（徽章 / 分类 chip / 进度条 / 图标 / 表头 / tab 条 / 扩展指标行 / 时刻）。`it.each` 遍历清单本身 → 新增预设自动进闸 |
| 挂载 | 同上 | ⭐ **枚举档位穷举**：遍历所有 enum 字段 × 每个 option 逐档挂载，断言不抛错且根节点有内容——兜住「某一档模板忘了写」这类静默留白 |
| 单元 | `look.test.ts` | 夹取（`-8` / `NaN` / 字符串数字）；哨兵 `valueSize: 0` 走自适应；**「没配就不注入变量」**（`icon.bgFrom: ''` 时 `vars` 里没有 `--ic-icon-bg`）；变量名联合 ⟷ scss 里 `var(--…)` 引用集合**双向吻合** |
| 单元 | `rules.test.ts` | 规整丢掉脏行（非法 op / 非有限 value）；`color` 空串回落 `levelColor`；**danger 排前**；区间缺上界判不中；`level` 只影响排序与 `isAlarmLevel` 不影响颜色 |
| 单元 | `rows.test.ts` / `cells.test.ts` | 四档状态逐档；`alarmOn` 两档染的是哪个读数；渐变的**三前提缺一即降级**；占比分母 ≤0 → `'—'` 且不画条、`pct === 0` → fill 不渲染；完成率可 >100% 而条宽夹到 100；`wanFormat` 在 `max < 10000` 时整卡回落；`-0` 归一；`readLooseNumber` 收数字字符串；`extras` 只在有值时出行（真实 0 算有值） |
| 单元 | `hold.test.ts` | `reconcileHold` 纯函数：清除后保留 N 秒、持续告警 `since` 不变、同签名行插删重排不串行、`nextWakeMs` 取最早到期；`vi.useFakeTimers` |
| 挂载 | `Component.spec.ts` | 排布容器的 `grid-template-columns` / `flex-direction`；`rowLines` 的段位真落在左/右组里（逐件断言）；`lead` / `tail` / `tail2` 的存在与顺序；`grouping` 三档（组头计数、**tab 计数用全量而非当前 tab 子集**、tab 有 `role=tab` + `aria-selected` + Enter/Space）；`columnHeader` 与数据行**共用同一份 `--il-cols-tpl`**；空态三档（一项都没有 / `rowFilter` 全部平静 / N 个点位无数据）；`ScrollList` 的 `itemCount` 传对；⭐ **真实冒泡观测**：`attachTo: document.body` + body 上装 spy，断言配了 `emitValue` 的行吞冒泡、没配的不吞；⚠ **`ScrollList` 的 slot 里没有 `id`**（happy-dom 量到的高度是 0，副本不渲染，所以这条只能靠源码扫描或结构断言，跑不出重复 id） |
| 单元 | `levels.test.ts`（info-feed） | 11 键内置档逐个；`' Red '` / `'WARNING'` 归一；同 key 后覆盖先；只填 label 不填 color 时颜色仍回落内置档；未知级别不注入颜色也不渲染级别文字；⭐ **`orange` 不映射到任何 token**（有意决策，防「顺手补一档」）；`sortByRank` 用 index 做 tiebreak 保稳定 |
| 单元 | `geometry.test.ts`（gauge-card） | `describeArc` 的 `largeArc` 翻转点（sweep > 180）；270° 起止角；`r = 50 − thickness/2 − 1` 在 thickness 边界上仍为正；`arcSpan` 夹取；`normalizePercent` 在 `min >= max` 时给 null 而不是伪造 0% |

被既有全局闸顺带盖住的（都是「错了不报错」那类）：`manifests.contract.spec.ts` 的 22 条、
`catalog.contract.spec.ts` 的 `module_types.json` 逐字节快照、两份「零模块类型字面量」扫描、
`registerBuiltins.test.ts` 的 `BUILTIN_TYPES`、`chromeKeyCatalog.contract.test.ts`。

### 12.1 覆盖率：先红的是 per-glob 那条

`web/vitest.config.ts` 的 `thresholds`：

| 档 | 值 | 谁吃 |
|---|---|---|
| 全局 `lines` / `statements` | 80 | 整个 web |
| 全局 `branches` | 75 | 整个 web |
| 全局 `functions` | 85 | 整个 web。⚠ v8 把模板里**每个内联事件处理器**都算一个函数，四个模块会新增几百个 |
| per-glob `packages/*/src/**/*.ts` | **lines 95 / branches 90** | 四个模块的全部 `.ts`（约 6 800 行逻辑） |

所以每一轮 PR 的 `.ts` 覆盖目标直接写 **95 行 / 90 分支**，不是 90/80。
`schema.ts` / `presets.ts` / `options.ts` 这类纯数据文件必须被「预设逐个挂载」与
「枚举档位穷举」两条测试真跑到（它们本来就能顺带覆盖）。

棘轮另算：`scripts/gates/check_coverage.py` 的 `CEILING` 是 `{lines: 90, branches: 80}`，
`coverage-baseline.json` 里 `web` 记的是 `99.31 / 95.55`，`floors = min(基线, 封顶)`
→ 整体地板是 **90 行 / 80 分支**。⚠ **每一轮 PR 都要自带交互用例**，不能攒到最后：
`functions` 那一档是靠点击、切筛选、切 tab 的用例抬起来的。

首屏包体无压力：`MAX_JS_GZIP_KB = 300`，四个模块**零新增依赖、零新增 token、零新增图标**，
一个 echarts 都不碰。

---

## 13. 实施轮次

关键约束：`check_pr_policy.py` 的 `_is_module_landing()` 给「新大屏模块首次落地」一次
机械豁免，但

- 只对 base 上**不存在**的模块目录生效（故一个模块只能用一次）；
- `_new_module()` 在见到**两个**新模块目录时返回 `None`，豁免整体失效
  （`len(fresh) != 1`）；
- 全部改动文件必须落在 `src/modules/<type>/`、`tests/modules/<type>/`、
  `MODULE_REGISTRY` 六处花名册、`docs/MODULE_*.md` 之内——**只要有一个文件落在允许集合外
  就整体不豁免**，而错误信息只会说「超 400 行」。

六处花名册（`MODULE_REGISTRY`，逐字）：
`web/packages/modules/tests/manifests.contract.spec.ts`（目录 `toEqual` 数组 + `KEY_CONSTANTS`）·
`web/packages/modules/tests/registerBuiltins.test.ts`（`BUILTIN_TYPES`）·
`server/services/platform-server/src/platform_server/apps/dashboard/module_types.json` ·
`server/services/platform-server/tests/contract/test_dashboard_module_catalog.py` ·
`server/services/platform-server/tests/unit/test_dashboard_module_catalog.py` ·
`server/services/platform-server/tests/integration/test_dashboard_module_types_api.py`。
⚠ contract 与 unit 那两份**同名不同目录**，只改一份的表现是另一份当场红。

| 轮 | 范围 | 产出 | 行数量级 | 过闸命令 | 验收标准 |
|---|---|---|---|---|---|
| **R0** | 本设计文档 + `docs/DASHBOARD_DESIGN.md` §5.7 尾部补一段（四个模块是什么、是哪条机制的使用者、链到本文） | `docs/MODULE_INFO_CARD_DESIGN.md` · `docs/DASHBOARD_DESIGN.md` | ~50（纯文档） | `scripts/ci-local.sh --fast` | 文档评审通过；`check_comments` 不扫 `.md`，但仍按 [comment-style-typescript](agents/comment-style-typescript.md) 写 |
| **R1** | **`info-card` 落地**：三排布 · 外壳三档 · hover · 四段编排 · 图标四档 · 数值八旋钮（含渐变三前提）· 单位四档 · 标签 · 格式 · 带 color 的规则表 · 逐格四档 · 涨跌块 · 空态 · 行点击上抛 · 5 个预设 | `src/modules/info-card/*`（15 个文件）+ `tests/modules/info-card/{manifest,look,cells,rules,presets,Component}.*` + 六处花名册 | ~2 950 src + ~1 100 test | `pnpm vitest run packages/modules/tests/catalog.contract.spec.ts -u` → `scripts/ci-local.sh --fast` → 合并前 `scripts/ci-local.sh --all` | **机械豁免适用**（全部文件在允许集合内）；目录 `toEqual` +1、`KEY_CONSTANTS` +2、`BUILTIN_TYPES` +1、平台三份花名册 +1；5 个预设逐个挂载通过；`.ts` 行 ≥95 / 分支 ≥90 |
| **R2** | **`info-list` 落地**：行结构模型（lead ｜ 三段 lines ｜ tail ｜ extras）· `columns` 档与表头 · 两个徽章位 · 进度件（bar / 双条 / 圆点 / 占比 / 定宽）· 分组三档（组头计数 / tab 条 role=tablist + 键盘）· 滚动 · 行筛选与严重度排序 · 迟滞（定时器在 `Component.vue`）· 三档时刻来源 · 8 个预设 | `src/modules/info-list/*`（19 个文件）+ `tests/modules/info-list/{manifest,look,rules,rows,hold,presets,Component}.*` + 六处花名册 | ~3 500 src + ~1 400 test | 同上 | **机械豁免适用**；⚠ **绝不能与 R1 合并**（两个新目录 → `_new_module()` 返回 `None`）；断言表头与行共用同一份 `--il-cols-tpl`、tab 计数用全量而非当前子集、同签名行插删重排后 `since` 不串行 |
| **R3** | **`gauge-card` 落地**：五档几何（arc 270° + `pathLength` / linear / track 18px + 刻度 + 目标标记 + pill / tank / thermometer）· 量程与万格式（`max < 10000` 整卡回落）· 读数三处（居中 / 并排 / 下方）· 带 color 的规则表 · 网格多仪表 · 6 个预设 | `src/modules/gauge-card/*`（16 个文件）+ `tests/modules/gauge-card/{manifest,geometry,look,gauges,rules,presets,Component}.*` + 六处花名册 | ~2 750 src + ~1 000 test | 同上 | **机械豁免适用**；`geometry.test.ts` 覆盖 `largeArc` 翻转点与 `min >= max` 给 null；tank 档断言 DOM 里**没有** `mix-blend-mode` |
| **R4** | **`info-feed` 落地**：列表式数组槽（刻意不给 `isEntityPinned` 与 `bindingRowCounts`）· 11 键内置级别档 + 用户 `levels` 覆盖（橙色刻意不映射）· 六个尺寸旋钮下发到 CSS 变量 · `rowBorderStyle` 四档 · `sortByRank`（index 做 tiebreak）· 逐行四档 · 空态 · 2 个预设 | `src/modules/info-feed/*`（7 个文件）+ `tests/modules/info-feed/{manifest,levels,rows,presets,Component}.*` + 六处花名册 | ~1 030 src + ~500 test | 同上 | **机械豁免适用**；`manifest.test` 必须有一条断言 `isEntityPinned === undefined` **且** `bindingRowCounts === undefined`；`levels.test` 必须有一条断言 `orange` 不映射到任何 token |
| **R5**（可选） | 三份 `rules.ts` 收进 `shared/valueRules.ts`，三个模块改 import | `shared/valueRules.ts` + `tests/shared/valueRules.test.ts` + 三个模块各一行 import | ~150（净减约 180） | 同上 | 只在四个模块全部落地之后做。**≤400 行、不需要任何豁免**，走标准规模闸。三份重复本来就是为了保住 R1–R4 的豁免才留下的 |

⚠ **不引「记录在案的例外」。** [AC_DATA_LANDING](AC_DATA_LANDING.md) 里那条出路自陈
「§3.1 的『机械化改动』例外**不适用**……这是一次新的、需要显式批准的例外，
**不能借用旧条款**」。四轮各拿一次机械豁免，一次都不用申请。

分支与提交：分支名走 `feat/…`（`feature/x` 不合规）；`base..head` 的**每一条**提交标题都要匹配
`<类型>(<范围>): <一句话>`；PR 正文必须含「动机」「验证」「风险」三个词。

本地过闸：`scripts/ci-local.sh --fast`（含 black + prettier）→ 合并前
`scripts/ci-local.sh --all`（act 跑同一份 `ci.yml`，只有它跑得到覆盖率棘轮、增量覆盖、包体、真库）。
⚠ **GitHub 上分支与 PR 都不触发 `ci.yml`**，推上去等 CI 是白等；`pr-policy.yml` 虽在 PR 上跑
但红了不拦合并。⚠ 跑 act 期间不要动工作树。见 [ci-gates](agents/ci-gates.md)。

---

## 14. 这一版不做

1. **`efficiency-overview`**。`Component.vue` 真的 `import` 了 `shared/chart/echarts`：
   `PieChart` 半环 + `GaugeChart` COP 仪表 + 40 段光谱离散化的渐变弧 + 最大余数法配比修正 +
   `heroSignature` 防重复 `setOption`。真要做的前提是先把图表族的第一个模块落地
   （`shared/chart/*` 与 `ChartShell.vue` 已就位但一个使用者都还没有），并确认它不会被
   `check_bundle_budget.py` 的 `HEAVY` 名单拦在首屏。
2. **`kpi-group` 的计算源浮层**。三个行内字段 + 一个 Teleport 浮层（手算 fixed 定位避开舞台
   `transform: scale` 的裁剪 + hover/focus 双来源生命周期 + esc + scroll/resize 关闭 +
   `role=tooltip` / `aria-describedby`）。前提是行内字段预算腾得出三格，或者它做成一个
   跨模块可复用的 `shared/` 件。
3. **趋势 / 曲线 / 历史序列**。`isTimeSeries` 在目标仓是死字段：`bindingReader.ts` 对
   `archive` / `dataset` 一律返回「序列要异步取数，画布上不展开」。任何需要历史的卡片现在是
   一块永远「取数失败」的卡，而且看起来像配错了点位。前提是先补一条异步取数链路。
4. **`connectionState` 相关的连接态指示**。`ModuleMeta.connectionState` 全仓零处设置。
5. **格内/行内的自由布局（拖拽摆件）**。`rowLines` 的声明式段位已经能表达八个参考模块的行结构；
   真要自由摆位，按 [ADR-0016](adr/0016-复杂config段由清单声明的整页子编辑器接管.md) 的三条判据
   （元组 / 跨集合 id 互引 / 必须靠视口才配得准的几何）该上 `subEditor` 而不是继续加维度。
   卡片类模块目前一条都不命中——`action-button` 30 个旋钮、`header` 18 个都是纯通用控件走完的。
6. **`density` 这类疏密预设档**。`gapX` / `gapY` / `padX` / `padY` 四个数值旋钮已经能表达，
   再加一层三档枚举会与它们语义重叠——重叠的两个旋钮只开其一必然是「配了不生效」。
   真要它就放进 `configPresets`。
7. **属性面板的折叠**。这是编辑器的事而不是模块的事：`PropertyPanel.vue` 加一层
   `<details>` 能让所有模块受益，但它落在四轮落地豁免的允许集合之外，必须单独一个 PR。
   本设计按「面板不会折叠」这个既成事实做字段预算（§5.1）。
