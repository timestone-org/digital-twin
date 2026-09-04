# 构成环图 `pie-chart` —— 架构设计

> 关联：[`DASHBOARD_CHART_MODULES_DESIGN.md`](DASHBOARD_CHART_MODULES_DESIGN.md) §3 / §6 / §8 / §10 / §11 / §12、
> [`DASHBOARD_DESIGN.md`](DASHBOARD_DESIGN.md) §4–§7、[`MODULE_INFO_CARD_DESIGN.md`](MODULE_INFO_CARD_DESIGN.md)（模块落地流程的蓝本）。

把几路实时读数按占比画成饼 / 环 / 玫瑰，回答「这几个量各占多少」。
它同时是本仓**第一块图表模块**：`shared/chart/` 那套基建躺在仓里零消费者，
本模块负责把 `ChartShell` 的用法、图例式逐槽状态、六份花名册这条落地流程走通。

---

## 0. 三句话说清它与现有 14 个模块的关系

| | 已有的画法 | 本模块 |
|---|---|---|
| 几个数各是多少 | `info-card` 摆 6 个 KPI、`data-card` 摆可组合卡 | 不重复做 |
| 各占多少 | 没有：占比要归一化并画成扇形面积 | ✅ 这一块 |
| 离满还有多远 | `gauge-card` 的五档几何 | 不重复做 |
| 逐行比高低 | `info-list` 的进度件（逐行独立，没有共享值轴） | 留给后续的 `bar-chart` |

⚠ **不是从零造轮子**：`shared/chart/`（`chartKit` / `chart-config` / `theme` /
`echarts` / `useEChart` / `ChartShell`）六份文件与它们的测试早已齐备，本模块
一行基建都不改，只出「取值 + option + 清单」三样。

---

## 1. 为什么先落它

`pie-chart` 纯 `opcua` 标量、**不依赖序列取数链路**（那条链路要跨 contracts /
runtime / app 三个包、五轮 PR）。它是验证「ChartShell 用法 + 图例式逐槽状态 +
六份花名册 + catalog 快照 + 规模豁免」整条流程最便宜的试金石——后面四个图表模块
照它抄。

---

## 2. 数据接入：一个数组槽，行钉在配置上

```
bindings: [{ key: 'sliceValues', dataType: 'number',
             isArray: true, isEntityPinned: true,
             arrayFields: [{ key: 'value', dataType: 'number' }] }]
bindingRowCounts:  { sliceValues: config.slices.length }
bindingRowLabels:  { 'sliceValues[i].value': { title: 扇区名, id: 扇区名 } }
```

三条不能少的理由：

1. 扇区名、单位、小数位、固定色**都是配置**，必须有一份 config 侧的数组——这正是
   实体钉行的定义。
2. 「配了 6 片先接 2 片」是常态。实体钉行允许中间留空；列表式在服务端被强制
   「索引连续且从 0 起」，第 2 条绑定直接存不下去。
3. `bindingRowLabels` 让绑点面板显示扇区名，而不是「第 3 行」。

⚠ `isEntityPinned` 与 `bindingRowCounts` 缺一不可：漏前者服务端套索引连续校验，
而错误文案说的是「索引不连续」，跟真正的原因八竿子打不着；漏后者绑点面板会摆出
一个「新增一行」，加出来的行永远喂不到东西。一片都没有时也要给 `0`。

⚠ **一个子槽都不给 `isRequired`**：给了会让整块被判 `unbound` 并盖上状态浮层，
下面那套逐片四档就整片白画。全仓至今零个模块用 `isRequired: true`。

### 2.1 环心读数为什么不是第二个槽

`centerText`（合计 / 最大片 / 片数）是从**当前画得出来的那几片**派生的。
做成第二个绑定槽的代价是：「配了 6 片先接 2 片」的常态会因为那个槽没绑而被判
`unbound`，整块盖上浮层。派生一条路零绑定成本，且永远与扇区自洽。

---

## 3. 四条「进不进扇区」的判据

| 判据 | 画法 |
|---|---|
| 这一行没配来源（`meta.slots` 里没有这个 `fieldKey`） | **整片不进输出**，扇区与图例都没有它 |
| `pending`（配了没首帧） | 图例列出名字 + 后缀「等首帧」，扇形画不出来 |
| `error`（取不到） | 图例列出名字 + 后缀「取不到」，图例文字取 `theme.textMuted` 置灰 |
| `ok` 但不是有限数 | 图例后缀「无读数」；⚠ 绝不伪造 0 |
| `ok` 但是负值 | 图例后缀「负值不计」，**不进分母** |
| `ok` | 正常画 |
| 一片都画不出来 | 交给 `ChartShell` 的 `isEmpty` + `emptyText` |
| 画得出来但读数合计为 0 | 另出一句「读数合计为 0，画不出占比」，见 §4.1 |

⚠ 「画不出扇形」不等于「不进 `series.data`」：上面这几档**都要**以 `value: null`
占着自己在数据里的位置（逐项关掉标签与引线、图元置灰），否则图例上那一条根本
不会被创建，见 §4。

⚠ **负值不取绝对值**：扇形只有面积没有方向，`-30` 与 `30` 会画成同一片，而占比
跟着一起错。取绝对值是「悄悄把数改了」，剔除并在图例上说清楚才是诚实的。

⚠ **占比只按当前 ok 的那几片归一**：取不到的那一片不进分母。否则接了 2 片的环图
会画成两小条加一大块空白，而那块空白并不代表任何一个量。

⚠ 状态按**清单声明的子槽**逐一去问，不按 `slots` 的键遍历：设计态走
`previewBindings` 那条路，`slots` 里会多出模块自己不认识的键。

---

## 4. 逐槽状态只能画在图例上

开 `ownsStatusDisplay: true`，然后：

- **`graphic` 组件没有注册**（`shared/chart/echarts.ts` 的 `use()` 清单里没有它），
  写了静默不渲染、既不报错也没有半张图；
- 模块标题条走 `ModulePanel`，图表内的 `title` 另有用处（§5）。

于是逐片结论只有**图例**这一个承载面。实现上逐条给 `legend.data[i]` 写
`textStyle` 与 `itemStyle`：

```
ok       → 文字 theme.text     图标 该片的颜色
pending  → 文字 theme.text     图标 theme.textMuted
error    → 文字 theme.textMuted 图标 theme.textMuted
```

⚠ **图例条的名字必须在 `series.data` 里找得到，否则那一条图例根本不会被创建。**
echarts 只认两条认领路径：名字等于某个系列的 `name`，或名字在饼的**原始数据**里
（`LegendView` 的 `containName`）。两条都不中时它连图元都不建，只在 dev 构建下
`console.warn` 一句 `xxx series not exists`。因此没读数的那几片也要以 `value: null`
进 `series.data`——`null` 不进分母、不画弧，逐项再把 `label` / `labelLine` 关掉、
图元置灰。**只把画得出来的那几片放进 data 的写法，会让「等首帧 / 取不到 / 无读数 /
负值不计」四句在屏上一句都看不见，而 option 对象上的断言全绿。**

⚠ **图例不许点**（`selectedMode: false`）：echarts 默认可点切换，点掉一片后它会按
剩下的几片**重新归一圆心角**，而标签与提示框里的占比是取值层一次算死的——50/30/20
里关掉 20，两片会按 62.5% / 37.5% 画，标签上却还写着 50% / 30%。关掉之后
`legend.inactiveColor` 这一档也就没有意义，不写它。

⚠ **图例缺省是开着的**（`legendFields({ default: true })`）：`ownsStatusDisplay`
让整格浮层不出，图例又是唯一的承载面，缺省关着等于新拖出来的一块饼「坏了不吭声」。
四套预设里只有 `compact-ring` 关它，代价写在那一套的 `hint` 里。图例关掉时还剩
`ariaSummary` 这一面——它会把没读数的那几片一并报给读屏。

`unbound` 与 `stale` 两档仍归整格浮层（`moduleStatus.ts` 的
`showsStatusOverlay`），这不是本模块能决定的。

### 4.1 读数全是 0：不等分圆，另说一句话

`stillShowZeroSum` 默认 `true`，读数合计为 0 时 echarts 会把圆**等分成 N 份**——
屏上写着「各占 1/N」，而取值层那边算不出占比给的是 `null`，两边当场对不上。
本模块显式写 `stillShowZeroSum: false`，几何上一片都不画，并由 `emptyStateOf()`
出一句专门的「读数合计为 0，画不出占比」。它与「一片都画不出来」那句分开：
0 是真读数，只是没有分母。

---

## 5. 与设计文档的三处偏离

### 5.1 环心读数走 `title`，因此 `partialMerge` 多带一个键

`DASHBOARD_CHART_MODULES_DESIGN.md` §8 写着「图表内的 `title` 一律 `show:false`」，
§6.7 写着「`partialMerge` 一律给 `['series','legend']`」。本模块两处都偏了一格：

- **`title` 用来画环心那个读数。** 已注册的组件里只有它能在画布正中摆一段文本
  （`graphic` 没注册，`series.label` 的 `position:'center'` 会占掉某一片自己的
  标签）。§8 那句话的语境是「逐槽状态不许用 title」——本模块的逐槽状态确实只在
  图例上，那条纪律没有被破坏。
- **`partialMerge` 因此是 `['series','legend','title']`。** 环心读数是从实时值
  派生的；不把 `title` 纳入替换范围，值刷新时它会**停在第一帧上**，而扇区跟着变，
  屏上两个数当场对不上，且零报错。§6.7 给的理由（「一起纳入替换范围，比推断
  echarts 的组件 merge 语义稳」）对 `title` 同样成立。
- `centerText` 为 `none` 时整个 `title` 键不写，`replaceMerge` 会把上一帧的标题
  一并摘掉。

### 5.2 没读数的那几片仍进 `series.data`

§8 的表格写着 `pending` / `error` 两档「series 数据为空数组」。那句话是照折线/柱状
写的：那两族的图例名等于**系列名**，走的是 `getSeriesByName` 那条认领路径，系列在、
数据空，图例照样列得出来。饼图的图例名是**数据项名**，走的是
`legendVisualProvider.containName`——名字不在数据里，图例条根本不建。故本模块反过来：
每一片都占着数据里的位置，用 `value: null` 表达「没读数」。纪律没变（逐片状态仍只
画在图例上），变的是让图例活下来的那个前提。

### 5.3 预设不写 `unit` / `precision`

这两个键由 `unitPrecisionFields()` 产出、落在「样式」分段里，但语义是**这块屏的
数值口径**（kWh 就是 kWh）。若按「每套预设写全全部观感键」的口径把它们写成空串，
用户换一套观感时配好的单位会消失。故四套预设一个都不写，并由
`presets.test.ts` 的两条用例把「写了就红」钉住。

---

## 6. 配置面

分段名只用 `chart-config.ts` 的 `GROUP` 八个，不另造字符串（否则属性面板会摆出
两个近义分段）。

| 分段 | 键 |
|---|---|
| 数据 | `title`（工厂） · `slices`（array，行内 `name` / `color` / `unit` / `precision`） · `emptyText` · `centerText` · `centerUnit` |
| 样式 | `chartStyle`（工厂） · `innerRadius` · `outerRadius` · `palette`（工厂） · `unit` / `precision`（工厂） |
| 图例 / 提示框 / 数据标签 / 动画 | 四个工厂各自产出 |

- **不 spread `cartesianAxisFields()`**：饼图没有坐标轴，摆出「X 轴名称」是纯噪声。
- `centerText` / `centerUnit` / `innerRadius` 三项都挂
  `when: { key: 'chartStyle', in: ['donut', 'rose'] }`——实心饼没有心可写，也没有
  内半径可调。⚠ `when` 只判**同一层**里的键，且判的取值必须在控制字段的 `options`
  名单里，两条都有契约用例守着。
- `contentKeys: ['title', 'slices', 'emptyText', 'centerUnit']`。不声明的话这几个
  内容键会被 `styleKeysOf()` 当成观感键，别人套预设时把用户配好的扇区整片抹掉。
- 逐片 `precision` **刻意没有 `default`**：留空 = 跟随整块那一档。给个 0 会让
  「没填」与「真的要 0 位」再也分不开。
  ⚠ 它因此必须是 `type: 'number'` 而不是 `'range'`：滑杆没有空态
  （`RangeControl.vue` 是 `readNumber(props.value, range.min ?? 0)`），没配时面板上
  **显示 0 而渲染按整块那一档走**，两边对不上；而且拖过一次就再也回不到「跟随整块」。
  顶层那个同样要表达「留空自动」的 `precision` 用的正是 `number`。
- `showLegend` 缺省 `true`，见 §4。

### 6.1 内半径压回去，而不是画成宽度 0

内半径填得不小于外半径时，环带宽度为 0，屏上一片空白且零报错。取值层把它压到
`外半径 − PIE_MIN_RING`——画得窄比画不出来诚实。

---

## 7. 颜色与文案

- 色板只走 `theme.ts` 的 `SERIES_VARS` 六个 token（`--accent-primary` /
  `--state-success` / `--state-warning` / `--state-danger` / `--accent-secondary` /
  `--state-idle`），按序取用、用完循环；用户覆盖走 `paletteOverrideField()`。
  ⚠ BK 那套 `--chart-series-1..5` / `--chart-cold` / `--chart-hot` 在本仓**全部不存在**，
  照抄会让配色整片丢失且不报错。
- 逐片固定色压过色板，且**按文档序取色**：否则前面一片一断线，后面每一片的颜色
  都跟着挪一格，屏上看着像换了一套配色。
- ⚠ 绝不写 `color: ''`：echarts 会把空串当成一种颜色画出**透明**的图元。取不到就
  用 `withColor()` 省掉该键。
- ⚠ `.ts` 里的色值字面量那道闸拦不住（`check_ts_style.py` 只扫 `.vue` 与 `.scss`），
  option 全在 `.ts` 里，「零色值字面量」在这里靠约定 + 单测兜。
- **两处相反的转义口径**：提示框的函数 formatter 返回值被 echarts 原样
  `innerHTML`，拼进去的扇区名与单位全是编辑器里的自由输入，必须逐段
  `escapeHtml()`；反过来 series 的标签走 canvas，不解析 HTML 实体，转义了只会把
  单位里的 `&` 显示成字面量 `&amp;`。两条各有一个用例钉住。

---

## 8. 交互

`hostClickable: true` 与 `emitsInteractions: true` **都开**：饼图没有 `dataZoom`
滑块，也没有拖拽手势，两者不打架。点某一片经 `ChartShell` 的 `itemClick` 上抛
`{ event: 'click', value: 这一片配置里写的名称 }`；冒泡由 `useEChart` 一处吞掉
（zrender 事件裹着原生事件，要两层 `.event`），不吞的话同一次点击会再被「整块可点」
兜底抛一次，toggle 类动作当场自我抵消。

⚠ **重名的扇区按出现序加 `#1` 后缀**：不去重的话 echarts 会把同名的两片并成一条
图例，而两片的值仍各画各的——图例上少一行，且没有任何报错。

⚠ **上抛的是配置里的原名，不是图例名**（`readValue` 按 `dataIndex` 回查
`SliceView.emitValue`）。图例名带去重后缀、没起名的是「第 N 片」：前者没人猜得到，
后者在上面插一片就整体挪位——两种都会让配好的联动规则静默失配。没起名的那几片
因此点了**不上抛**（取值器返回空串，`useEChart` 据此直接 return）。

⚠ 点在图例或空白处仍会触发「整块可点」那一档：canvas 是一个 DOM 元素，只有图元
点击那一次会 `stopPropagation`。这是 `hostClickable` 的定义，不是缺陷；图例既然
不可点，两者就不再打架。

---

## 9. 目录与文件

```
web/packages/modules/src/modules/pie-chart/
├── manifest.ts       唯一 export default；含 description 与 contentKeys
├── Component.vue     套 ChartShell；只做「读 config/values → build 闭包」
├── option.ts         ChartBuild 实现：(theme, resolve) => ECOption
├── slices.ts         取值层：config + values + meta.slots → SliceView[]，含空态口径
├── options.ts        枚举取值表（as const satisfies readonly ConfigOption[]）
└── presets.ts        四套整套观感
```

⚠ 入口文件必须叫 `manifest.ts`：叫 `index.ts` 的模块**从模块库消失且不报错**。
⚠ `manifest.ts` 里绝不静态 import `Component.vue` / `option.ts`：注册用的 glob 是
`eager: true`，静态引一下就把渲染组件并进注册 chunk，并破坏懒加载语义。
⚠ 绑定槽键要在 `Component.vue` 里**字面读一遍**（`props.values[SLICE_SLOT_KEY]`）：
「绑定槽键两侧逐一对上」那条闸只扫模块目录本身、不跟 import 走。而
`config.<键>` 那条查的是**可达集**，所以 `title` 由 `ChartShell` 读、`palette` /
`animation` 由 `chartKit` 读**是算数的**。

---

## 10. 落地要改的六份花名册

| # | 路径 | 改什么 |
|---|---|---|
| 1 | `web/packages/modules/tests/manifests.contract.spec.ts` | 目录数组加 `'pie-chart'`（字典序）；两个键常量登进 `KEY_CONSTANTS` |
| 2 | `web/packages/modules/tests/registerBuiltins.test.ts` | `BUILTIN_TYPES` 加一项 |
| 3 | `server/…/apps/dashboard/module_types.json` | **`-u` 重新生成**，不是手改 |
| 4 | `server/…/tests/contract/test_dashboard_module_catalog.py` | `EXPECTED_TYPES` 加一项 |
| 5 | `server/…/tests/unit/test_dashboard_module_catalog.py` | `known_types()` 断言加一项 |
| 6 | `server/…/tests/integration/test_dashboard_module_types_api.py` | 断言集合加一项 |

⚠ #4 与 #5 同名不同目录，只改一份的表现是另一份当场红。
⚠ `module_types.json` 是**烤进 platform-server 镜像**的，改了要重建镜像。
⚠ 类型 id 叫 `pie-chart` 而不是 `pie`：「零模块类型字面量」那条闸按已注册的 type
逐个 grep 源码，短词会红在一堆与模块毫不相干的属性上。图标用注册表里已有的
`chart-pie`——加新图标要改 `@dt/ui`，那不在新模块 PR 的豁免集合内。

---

## 11. 一期不做的

| 不做 | 理由 |
|---|---|
| 历史序列（按时间段的构成变化） | 要整条序列取数链路（contracts + runtime + app 五轮）。饼图本身也不适合表达时间 |
| 嵌套双环（内外两层构成） | 需要第二个数组槽与一套父子对应关系，属于另一个模块 |
| 扇区点击后下钻 | 联动规则已经能表达「点这一片 → 切另一张屏」，不在模块内另造一套 |
| 「其他」自动归并（小于 x% 的合成一片） | 归并会让点击上抛的值失去所指，且掩盖真实的碎片化。要合并请在配置里少配几片 |
| 图例分页 / 多列 | `legendStyle()` 已是 `type: 'scroll'`，够用；真不够时是壳的事，不是本模块的 |
