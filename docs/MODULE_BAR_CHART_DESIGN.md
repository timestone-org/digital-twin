# 对比柱图 `bar-chart` —— 架构设计

> 关联：[`DASHBOARD_CHART_MODULES_DESIGN.md`](DASHBOARD_CHART_MODULES_DESIGN.md) §3 / §5 / §6 / §8 / §10 / §11 / §12、
> [`MODULE_PIE_CHART_DESIGN.md`](MODULE_PIE_CHART_DESIGN.md)（本族第一块模块，落地流程的蓝本）、
> [`DASHBOARD_DESIGN.md`](DASHBOARD_DESIGN.md) §4–§7。

把几路读数摆成**共享同一条值轴**的柱：实时档比「谁高谁低」，历史档比「按桶怎么走」。
行级可以切成折线并挂到右轴，于是同一块里画得出「产量柱 + 达标率线」这种双轴组合。

---

## 0. 三句话说清它与现有 15 个模块的关系

| | 已有的画法 | 本模块 |
|---|---|---|
| 逐行比高低 | `info-list` 的进度件：**逐行独立**的百分比，两行的条长不可比 | ✅ 共享值轴，两根柱直接可比 |
| 各占多少 | `pie-chart` 的扇形面积 | 不重复做（`percent` 档是「每一列各占多少」，与饼的「几个量各占多少」不同轴） |
| 几个数各是多少 | `info-card` / `data-card` | 不重复做 |
| 离满还有多远 | `gauge-card` | 不重复做 |
| 一条曲线怎么走 | 没有 | `trend-chart`；本模块的历史档画的是**按桶的柱**，不是连续曲线 |

⚠ **一行基建都不改**：`shared/chart/` 六份文件与它们的测试早已齐备，本模块只出
「取值 + 类目轴 + option + 清单 + 预设」五样。

---

## 1. 数据接入：一个数组槽、两个子槽、一档开关

```
bindings: [{ key: 'barValues', dataType: 'number',
             isArray: true, isEntityPinned: true,
             arrayFields: [
               { key: 'value',  dataType: 'number' },                     // 实时档
               { key: 'series', dataType: 'number', isTimeSeries: true }, // 历史档
             ] }]
bindingRowCounts:  { barValues: config.items.length }
bindingRowLabels:  { 'barValues[i].value': {…}, 'barValues[i].series': {…} }
```

读哪一路由 `config.valueSource`（`live` | `history`）决定。三条不能少的理由与
`pie-chart` §2 同款：结构性配置（名称、单位、小数位、颜色、分组、画法、挂轴）都在
config 侧的数组里；「配了 6 组先接 2 组」是常态，实体钉行才允许中间留空；
`bindingRowLabels` 让绑点面板显示组名而不是「第 3 行」。

⚠ `isEntityPinned` 与 `bindingRowCounts` 缺一不可；一组都没有时也要给 `0`。
⚠ **一个子槽都不给 `isRequired`**：给了会让整块被判 `unbound` 并盖上状态浮层，
下面那套逐行四档就整片白画。

### 1.1 两路都绑了怎么办

只读 `valueSource` 指定的那一路，**并在图例后缀上标出被忽略的那一路**
（`历史未用` / `实时未用`）。不标的话，把历史序列绑好之后切回实时档，屏上还是老样子，
而用户看不到任何解释，只会以为自己绑错了点位。

### 1.2 窗口与桶宽不在本模块的配置面上

取数窗口与聚合档位住在**每条绑定**的 `detailJson` 上（`BindingSourceEditor` 写入），
模块既读不到也改不了。因此本模块不摆「时间范围」「桶宽」两个旋钮，
也**必须容忍同一块图里两行的窗口与桶宽不同**——见 §2.2。

---

## 2. 两档的类目轴不是一回事

这是本模块与参考仓 BK 的 `bar` 差别最大的一处：BK 的 `grouped/stacked/percent`
由**手填的静态矩阵**驱动，option 形状与「一行一个系列 × 时间桶做类目」根本不同，
**逐行照抄它的 `option.ts` 只会得到一份画不出东西的合法 option**。

| | 实时档 `live` | 历史档 `history` |
|---|---|---|
| 类目轴 | 各行的**名字** | 各行时刻的**并集**，升序 |
| 一行 = | 一根柱（只在自己那一格上有读数） | 一条按桶铺开的系列 |
| 读的子槽 | `value` | `series`（伴生键 `seriesPoints`） |
| 百分比的分母 | **全部行的合计** | **每一列**跨行的合计 |

两档的 option 形状分开构建，不硬凑成一份：硬凑的代价是实时档凭空多出一根时间轴，
而历史档的行名无处可放。

### 2.1 实时档为什么所有柱共用一个内部堆位

实时档是「N 行 × N 个类目」的稀疏矩阵：第 i 行只在第 i 个类目上有读数。
若各行各占一格，echarts 会在每个类目里摆出 N 个并排槽位，每根柱缩到 1/N 宽、
还偏在自己那一格里——屏上像一排随机错位的细线。
故实时档给全部**柱**系列一个共用的内部 `stack`，于是每个类目上只有一根满宽的柱。

⚠ 因此行级的 `stack`（堆叠分组）**只在历史档生效**。这条写在字段的 `help` 里，
不能用 `when` 挡掉：数组行内的 `when` 判的是**这一行自己**的取值
（`ArrayControl.vue`），够不到顶层的 `valueSource`。

### 2.2 时刻轴取并集，缺格补 `null`

窗口住在绑定上，两行的窗口与桶宽本来就可以不同。拿第一行的时刻当轴，
第二行的点会整片对不上位、**静默**画不出来，而 option 完全合法。
缺格一律补 `null` 而不是 0：柱图上 0 是一个真读数，「这一桶没采到」画成 0
会把停机读成产量归零。

刻度按**相邻类目的最小间隔**选档，不按总跨度：一小时窗里 10 秒一桶时，
按跨度选出的「时:分」会让六个相邻刻度显示成同一个字样。

| 相邻间隔 | 刻度 |
|---|---|
| < 1 分钟 | `HH:mm:ss` |
| < 1 天（跨度 ≤ 1 天） | `HH:mm` |
| < 1 天（跨度 > 1 天） | `MM-DD HH:mm` |
| < 28 天 | `MM-DD` |
| ≥ 28 天 | `YYYY-MM-DD` |

⚠ 刻度写的是**本地时**，与 `format.ts` 的 `fmtClock` 同口径；桶边界是后端按
`timezone` 切好的，这里只负责写字。

---

## 3. 五档几何各自解决什么

| 档 | 做什么 | 不做什么 |
|---|---|---|
| `grouped` 并排 | 缺省档。只有显式写了分组名的那几行才堆 | — |
| `stacked` 堆叠 | 没写分组名的那几行落到同一个默认堆位上 | 实时档退化成并排（一行就是一个类目，堆无可堆） |
| `percent` 百分比堆叠 | **自己**按列归一到 100，值轴钉死 0–100 | 不画参考线（§3.2）；图例不许点（§3.3） |
| `horizontal` 横向条形 | 类目轴转到 Y 并 `inverse`，值轴转到 X | — |
| `diverging` 正负对称 | 值轴按最大绝对值向两侧铺开 | **不按正负改色**（§3.1） |

### 3.1 `diverging` 为什么只动量程、不动配色

负值是**真读数**（回馈电量、温差），一律照实向下（向左）画，绝不取绝对值——
取绝对值会让「-30」与「30」画成同一根柱。

而按正负改色是**不能做的**：一行的颜色是用户配的，同一根柱在回馈与用电之间
来回换色，读者会以为换了一个系列。这一档真正的价值是**对称量程**：
「回馈 20」与「用电 400」画在同一根不对称的轴上，回馈那一段只有一像素高。

⚠ 一格读数都没有时不写量程（`min`/`max` 都不落），免得钉死一个 0 到 0 的轴。

数值标签跟着正负翻边（竖柱 `top`↔`bottom`、横条 `right`↔`left`）。
⚠ `label.position` 只认字符串、不认回调，所以翻边只能**逐个数据项**写在
`series.data` 的对象项上。不翻的话「-30」那个标签压在 0 线上方，
与相邻那根正值柱的标签叠在一起。

### 3.2 `percent` 档不画参考线

阈值写的是原始单位（「产量 500 吨」），而画布上是占比，那条线会落在一个
与任何东西都无关的高度上，**且没有任何报错**。与其画错不如不画。

### 3.3 `percent` 档的图例不许点

占比是取值层一次算死的。点掉一条 echarts 只把那一段抽走，剩下的加起来
不再是 100%，而屏上那些数字一个都没变。其余四档图例照常可点。

### 3.4 分母为 0 的那一列整列留空

一整列全缺、或合计 ≤ 0 时，那一列的占比全给 `null`——画成一排 0%
会让「这一桶没采到」看着像「这一桶产量为零」。占比对负值与零和没有几何意义。

---

## 4. 逐行状态只能画在图例上

`graphic` 组件没有注册（写了静默不渲染），模块标题条走 `ModulePanel`，
所以图例是逐行四档**唯一**的承载面。

| 档 | 画法 |
|---|---|
| 没配来源（`slots` 里没这个键） | 整行不进 option，图例也不列它 |
| `pending` | series 照常进 option、`data` 给空数组，图例名后缀「等首帧」 |
| `error` | 同上，后缀「取不到」，图例文字取 `theme.textMuted` 置灰 |
| `ok` 但窗内 0 点 | 后缀「窗内无数据」——与「取不到」是两码事 |
| `ok` + `isTruncated` | 后缀「窗内还有更多点」 |
| `ok` + `isStale` | 后缀「陈旧」，可与上一条并存 |
| `ok` | 正常画 |
| 一格都画不出来 | 交给 `ChartShell` 的 `isEmpty` + `emptyText` |

⚠ 状态按**清单声明的子槽**逐一去问，不按 `slots` 的键遍历：设计态走
`previewBindings` 那条路，`slots` 里会多出模块自己不认识的 `…Points` 键。

### 4.1 ⚠ 柱族走 `series.name` 那条认领路径

echarts 的图例只认两条路径来认领一个名字：**名字等于某条 `series.name`**，
或**名字在该系列的原始 data 里**。两条都不中的图例项 `_createItem` 根本不会被调用：
图例项**不存在**，dev 构建下每渲染一次刷一句 `series not exists` 的 warn，
生产构建下连这个都没有。

柱 / 折线 / 雷达族走前一条，饼 / 漏斗族走后一条。故本模块非 ok 的行
**series 照常进 option、`data` 给空数组**，名字由 series 自己带着。

⚠ **这一条单测抓不到**：组件用例把 echarts 整包打桩、断言的是 option 对象的形状，
而这里错的是「这份完全合法的 option 交给真 echarts 之后画不出来」。
故 `tests/modules/bar-chart/legendSsr.spec.ts` 拿**真 echarts** 跑 SSR
（`renderer: 'svg'`、`ssr: true`、`renderToSVGString()`），断言那几个名字
真的出现在 SVG 里；末尾另有一条反证（名字对不上的图例项不出现），
不跑反证的话本文件在实现退化成「图例照单全收」时会继续全绿。

### 4.2 `isTruncated` 说不出砍的是哪一头

`DASHBOARD_CHART_MODULES_DESIGN.md` §4.5 要求「文案必须说清砍的是哪一头」，
因为两个历史端点砍的方向相反（点位逐条读砍晚的、台账 `:series` 砍早的）。
但 `ModuleSlotMeta`（`contracts/src/module.ts:482-500`）只带得回一个布尔
`isTruncated`，**没有 `truncatedSide`**——`SeriesOutcome` 上那一格在
`moduleValues.ts` 的转换处没有对应字段。

说不出方向就不许猜，故后缀写的是中性的「窗内还有更多点」。
把 `truncatedSide` 补进 `ModuleSlotMeta` 是一轮独立的铺路改动（碰 contracts + runtime），
不在本模块的 PR 范围内。

---

## 5. 双轴与折线行

- 行级 `axis`：`left` / `right`。**只要有一行挂了右轴**就多出第二条值轴，
  第二条不再画分隔线（两套刻度的横线交错在一起，图上像蒙了一层网格）。
- 行级 `plot`：`bar` / `line`。折线行**永远不参与 `stack`**——把达标率加到产量上去，
  画出来的那条线不对应任何一个真实的量。
- 参考线**只挂在一条系列上**，优先挑左轴里第一条画得出来的：挂在每一条上会让
  同一条阈值线被画 N 遍、标签叠成一团黑；挂到右轴的系列上，参考值会按右轴的量程摆位置。
  一条都画得不出来时谁也不挂。
- ⚠ 两条轴的量程互不相干，别拿两边的柱高直接比。这句写在 `axis` 字段的 `help` 里。

---

## 6. 配置面

| 分段 | 键 |
|---|---|
| 数据 | `title` · `items`（数组，7 个子字段） · `valueSource` · `emptyText` |
| 样式 | `chartStyle` · `barWidth` · `barRadius` · `palette` · `barGradient` / `barGradientTo` / `barTopAlpha` / `barOpacity` · `unit` · `precision` |
| 坐标轴 | `xAxisName` · `yAxisName` · `xLabelInterval` · `yScale` · `boundaryGap` · `axisLabelFontSize` · `axisNameFontSize` |
| 图例 / 提示框 / 数据标签 | `showLegend`（缺省**开**） · `showTooltip` · `showValueLabel`（缺省关） · 三个字号 · `labelColor` |
| 参考线 / 动画 | `refLines` · `animation` · `animationDuration` |

行内 7 个子字段：`name` · `unit` · `precision` · `color` · `stack` · `plot` · `axis`。

⚠ **`showLegend` 缺省开**（片段工厂的缺省是关）：图例是逐行四档唯一的承载面，
关着的话「取不到」与「等首帧」在屏上一个字都没有。
⚠ **`showValueLabel` 缺省关**（片段工厂的缺省是开）：柱多时每根柱顶写一个数会糊成一片，
而柱高本身已经表达了大小——与饼不同，饼的扇区面积读不出具体数值。
⚠ `barWidth` 与行内 `precision` **刻意没有 `default`**：给了 0 就再也分不出
「没填」与「真的填了 0」。
⚠ 柱体渐变的 `barOpacity` 缺省覆写成 `1`：片段工厂那一档 `0.18` 是给折线面积的口径，
摊在柱上几乎看不见。

---

## 7. 与设计文档 / 参考仓的四处偏离

### 7.1 `partialMerge` 不带 `title`

`pie-chart` 带 `title` 是因为环心那个读数走 `title` 组件、随实时值变。
本族的标题条走 `ModulePanel`，图内没有派生读数，带上它只会让每次值刷新
多替换一个恒等的键。故本模块是 `['series', 'legend']`。

### 7.2 不开 `hostClickable`

本族摆得出缩放条（`showDataZoom`），而设计文档 §8 明写「开了 dataZoom 滑块
或内置缩放的图表不要开 `hostClickable`」——整块可点会把拖动滑块吞成一次点击。
只开 `emitsInteractions`，点击由 `useEChart` 的图元点击上抛。

### 7.3 不开 `grid.containLabel`

`cartesianGrid()` 的缺省是 `containLabel: true`，而 **echarts 6 已经把它废掉**：
不额外注册 `LegacyGridContainLabel` 时这个键无效，且每渲染一帧刷一句
`Specified grid.containLabel but no use(LegacyGridContainLabel)`。
echarts 6 的缺省行为（按外框收缩，连轴名一起算）比它更精确，故本模块显式传 `false`。

> 这是 `shared/chart/chartKit.ts` 的一处待清理：那个缺省对**全族**都在刷 warn。
> 改它要碰 `shared/chart/`，那会让新模块 PR 的规模豁免整体失效，故另开一轮。

### 7.4 渐变解析不出透明度时退回纯色

主色若是 `withAlpha` 解析不了的写法（`hsl()` / 命名色 / 主题里取回的非色串），
两端同色的「渐变」画出来就是一块实心，白白多一层 echarts 的渐变对象。
`chartKit.areaFade` 那边给折线面积的兜底是「退回主色 → 透明」，
但那一套放到柱上是**柱顶被削掉一截**，故本模块退回纯色。

---

## 8. 颜色与文案

- 色板只走 `SERIES_VARS` 六个 token，按**文档序**取用：按「第几行画得出来」取色的话，
  前面一行一断线，后面每一行的颜色都跟着挪一格，屏上看着像换了一套配色。
- 逐行固定色压过色板，只填 `var(--…)` 引用才跟着换肤走。
- **绝不写 `color: ''`**：echarts 会把空串当成一种颜色画出透明的柱；取不到就省掉那个键（`withColor()`）。
- ⚠ BK 的 `--chart-series-1..5` / `--chart-cold` / `--chart-hot` 在本仓**全部不存在**。
- 提示框的函数 formatter 返回值被 echarts 原样 `innerHTML`，逐段过 `escapeHtml()`；
  反过来柱面标签走 canvas，不解析 HTML 实体，转义了只会把 `&` 显示成 `&amp;`。
  两处口径相反，各钉一条用例。
- 数值文案：**逐行的单位与小数位优先**，缺了才用整块那一份——一块图里「产量 t」
  与「达标率 %」并排时，拿整块那一份口径去写标签会给百分比也加上吨。
  值轴刻度反过来**只用整块那一份**，不带任何一行自己的单位。

---

## 9. 空态那两句

| 情形 | 文案 |
|---|---|
| 用户填了 `emptyText` | 用户那一句 |
| 一格都画不出来（实时档，或历史档只是窗内没数） | `暂无数据` |
| 历史档**每一行都是 error** | `取不到历史序列（公开大屏不提供历史数据）` |

第三条是刻意分开的：公开大屏（匿名令牌页）**明令不装历史取数 provider**
（`PublicDashboard/index.vue`），`point-histories*` 与 `dataset-tables*`
都在认证面上。那不是现场没数据，一句通用的「暂无数据」会让人去查现场设备。

---

## 10. 目录与文件

```
web/packages/modules/src/modules/bar-chart/
├── manifest.ts     唯一 export default defineModule；⚠ 不叫 index.ts（叫了就从模块库静默消失）
├── Component.vue   薄壳：读配置与注入袋 → 交给 option.ts；只做接线
├── bars.ts         取值层：槽键、行归一化、逐行四档、两档类目轴、占比、空态、读屏摘要
├── buckets.ts      历史档的时刻并集、逐行对齐与刻度文案
├── option.ts       ChartBuild：类目轴 / 值轴 / 系列 / 图例 / 提示框 / 参考线 / 缩放条
├── options.ts      枚举取值表与可配区间（面板与渲染共用一份）
└── presets.ts      五套外观预设
```

⚠ `manifest.ts` 里**绝不静态 import** `Component.vue` / `option.ts`：注册用的 glob 是
`eager: true`，静态引一下就把渲染组件并进注册 chunk，并破坏懒加载语义。

测试在 `web/packages/modules/tests/modules/bar-chart/`：
`bars` / `buckets` / `option` / `manifest` / `presets` / `Component` / `legendSsr` 七份。

---

## 11. 落地要改的六份花名册

| # | 路径 | 改什么 |
|---|---|---|
| 1 | `web/packages/modules/tests/manifests.contract.spec.ts` | 目录数组加 `bar-chart`；`BAR_ITEMS_KEY` / `BAR_SLOT_KEY` 登进 `KEY_CONSTANTS` |
| 2 | `web/packages/modules/tests/registerBuiltins.test.ts` | `BUILTIN_TYPES` 加一项 |
| 3 | `server/…/apps/dashboard/module_types.json` | **`-u` 重新生成**，不是手改 |
| 4 | `server/services/platform-server/tests/contract/test_dashboard_module_catalog.py` | `EXPECTED_TYPES` 加一项 |
| 5 | `server/services/platform-server/tests/unit/test_dashboard_module_catalog.py` | `known_types()` 加一项 |
| 6 | `server/services/platform-server/tests/integration/test_dashboard_module_types_api.py` | 断言集合加一项 |

⚠ #4 与 #5 同名不同目录，只改一份的表现是另一份当场红。
⚠ `module_types.json` 是**烤进 platform-server 镜像**的，改了要重建镜像。

---

## 12. 一期不做的

- **`truncatedSide`**：见 §4.2，要先给 `ModuleSlotMeta` 补字段。
- **归档心跳结转**（`holdBucketValues`）：需要逐点位的 `archive_max_interval_ms`，
  大屏绑定里没有。一期空桶就是空桶，这与趋势页的口径不同。
- **`grid.containLabel` 的清理**：见 §7.3，改 `shared/chart/` 要另开一轮。
- **公开大屏的历史读**：见 `DASHBOARD_CHART_MODULES_DESIGN.md` §15 Q2，本轮不做。
- **实时档的堆叠语义**：一行就是一个类目，`stack` 只在历史档生效（§2.1）。
  真要在实时档堆，得让「几行合成一个类目」，那是另一种数据形状。
