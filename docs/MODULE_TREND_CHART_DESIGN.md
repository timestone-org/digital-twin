# 趋势曲线 `trend-chart` —— 架构设计

> 关联：[`DASHBOARD_CHART_MODULES_DESIGN.md`](DASHBOARD_CHART_MODULES_DESIGN.md) §3 / §4 / §5 / §6 / §8 / §10 / §11 / §12、
> [`MODULE_PIE_CHART_DESIGN.md`](MODULE_PIE_CHART_DESIGN.md)（本族第一块模块，写法蓝本）、
> [`DASHBOARD_DESIGN.md`](DASHBOARD_DESIGN.md) §4–§7。

把一条或多条点位归档 / 台账列的**历史序列**画成带真实时间轴的折线或面积图。
这是全屏唯一能回答「这个数过去几小时怎么走的」的模块——在它之前，本仓一条曲线都画不出来。

---

## 0. 三句话说清它与现有模块的关系

| | 已有的画法 | 本模块 |
|---|---|---|
| 当前值是多少 | `info-card` 摆 6 个 KPI、`data-card` 摆可组合卡、`gauge-card` 摆仪表 | 不重复做 |
| 各占多少 | `pie-chart` 的扇形面积 | 不重复做 |
| 逐条比高低 | `info-list` 的进度件（逐行独立，没有共享值轴） | 留给 `bar-chart` |
| **过去几小时怎么走的** | 没有：全仓没有任何模块声明 `isTimeSeries` | ✅ 这一块 |

⚠ **一行基建都不改**：`shared/chart/` 六份文件、序列注入链路（`packages/runtime`
的 `seriesSlots` / `useSeriesSlots`）与批量取数适配器（`web/app` 的 `pointSeries` /
`datasetSeries`）都由前面九轮铺好，本模块只出「取值 + option + 清单」三样。

---

## 1. 数据接入：一个数组槽、行内两个子槽

```
bindings: [{ key: 'seriesValues', dataType: 'number',
             isArray: true, isEntityPinned: true,
             arrayFields: [
               { key: 'series', dataType: 'number', isTimeSeries: true },
               { key: 'latest', dataType: 'number' },
             ] }]
bindingRowCounts:  { seriesValues: config.series.length }
bindingRowLabels:  { 'seriesValues[i].series': { title: 系列名, id: 系列名 } }
```

- `series`（时序）：求值层把 `HistoryPoint[]` 注入**同一行**的伴生键 `seriesPoints`，
  逐点跑过与末值同一份定值变换（配了 `scale: 0.001` 的系列，曲线与末值必须同口径）。
  这一槽同时也拿到序列末点的标量值，逐条状态就看它。
- `latest`（标量，可选）：接 `opcua` 实时点位，只用来把曲线尾巴补到「现在」。

行钉在配置里的系列上，理由与 `pie-chart` §2 逐条相同（名称/单位/小数位/颜色是配置、
「配了 6 条先接 2 条」是常态、绑点面板要显示系列名）。
⚠ `isEntityPinned` 与 `bindingRowCounts` 缺一不可；一条都没有时也要给 `0`。
⚠ **一个子槽都不给 `isRequired`**：给了会让整块被判 `unbound` 并盖上浮层，
下面那套逐条四档就整片白画。

### 1.1 取数窗口不在这份配置里

窗口（`lastWindow` / `fromMs` / `toMs`）与桶宽、聚合档位都住在**每条绑定**的
`detailJson`，由绑点面板写入。模块既读不到也改不了，因此：

- 面板上**没有**「时间范围」这一项；
- 时间轴的跨度只能按**取回来的点**算；
- 同一块图里两条系列的窗口**可以不一样**——这是既有形状，画的时候按各自的点铺时间轴。

### 1.2 实时末值什么时候才接得上去

**仅当** `meta.slots['seriesValues[i].latest'].timestampMs` **严格晚于**序列末点的 `t`
时才追加成末点。时刻缺席一律不追加。

⚠ 理由：末值本身说不出自己是什么时候采的。硬接在曲线尾巴上，等于凭空长出一个
位置不明的点，而那个点会把整条线的右端拉到一个错的时刻上——曲线完全合法，没有报错。
⚠ 一个历史点都没有时，末值自己就是那条线唯一的一个点：那是诚实的（它确实有时刻），
只是要开着「显示数据点」才看得见。

---

## 2. 逐条四档只能画在图例上

`ownsStatusDisplay: true`，整格浮层因此不出（`unbound` 与 `stale` 两档仍归浮层）。
一张折线图**没有格子可画**，而 `graphic` 组件没有注册（写了静默不渲染）、
图内 `title` 让给了 `ModulePanel`——所以图例是逐条状态**唯一**的承载面。

| 档 | 画法 |
|---|---|
| 该行没配来源（`slots` 里没这个键） | 该系列**整条不进 option**，图例也不列它 |
| `pending` | series 照常进 option、`data` 给空数组，图例名后缀「等首帧」 |
| `error` | 同上，后缀「取不到」，图例文字取 `theme.textMuted` 置灰 |
| `ok` 且窗内 0 点 | 同上，后缀「窗内无数据」 |
| `ok` 且 `isTruncated` | 正常画，后缀按 `truncatedSide` 分两种 |
| `ok` | 正常画 |
| 一条都画不出来 | 交给 `ChartShell` 的 `isEmpty` + `emptyText` |

### 2.1 ⚠ 折线族「图例列出它」的写法与饼族相反

echarts 的图例只认两条认领路径：匹配某条 series 的 `name`，或匹配该 series
**原始 data** 里某一项的 `name`。两条都不中的名字，图例项**根本不会被创建**
（dev 下只刷一句 `series not exists` 的 warn，生产构建下连这个都没有）。

- 折线族一个系列 = 一条 series，图例名 = `series.name`：非 `ok` 的槽 **series 照常
  进 option**、`data` 给空数组。名字由 series 自己带着，图例认得出。
- 饼族一个系列 = 一个 data 项：非 `ok` 的项必须**进 `series.data`** 且 `value: null`。

⚠ 这一条**组件单测抓不到**：组件用例把 echarts 整包打桩、断言的是 option 的形状，
而错的是「这份合法的 option 交给真 echarts 之后画不出来」。
故 `tests/modules/trend-chart/option.test.ts` 最后一组拿**真 echarts** 跑 SSR
（`renderer: 'svg'`、`ssr: true`、`renderToSVGString()`），正反各钉一条：
非 ok 的那几个名字**真的出现在 SVG 里**；把它们从 option 里剔掉之后**真的消失**。

### 2.2 触顶必须说清砍的是哪一头

两个历史读侧砍的方向**相反**：点位逐条读是正序取前 N 条、砍掉**晚**的那一头；
台账序列留的是最新那一批、砍掉**早**的那一头。一句通用的「数据被截断」会让人按错的
方向去读那条曲线，而曲线本身完全合法。故图例后缀分成「早段未取全」/「晚段未取全」，
取数侧说不出方向时才退到「点数触顶」。

⚠ 落地时发现方向**丢在了运行时**：`SeriesOutcome.truncatedSide` 存在，但
`slotOfOutcome` 没把它带进 `BindingSlot`，`ModuleSlotMeta` 上也没有这个字段。
本轮补齐了这一段（contracts + runtime 各一处，见 §7）。

---

## 3. 空态分三句，不合成一句

| 判据 | 文案 |
|---|---|
| 每一条时序槽都被**同步**读取器原样退回来 | 「公开屏不提供历史数据」 |
| 有 `ok` 的槽但一个点都没有 | 「所选时间窗内没有历史数据」 |
| 其余（还没绑 / 等首帧） | `config.emptyText`，缺省「暂无数据」 |

⚠ 第一条的判据是「**readSeries 没装**」而不是猜路由：公开屏（匿名令牌页）明令不装
历史 provider，而 `point-histories*` 与 `dataset-tables*` 两个端点都在认证面上，
所以这块图在那里永远画不出曲线。设计态画布与模块库缩略图走的是同一条路。

⚠ 模块看得见的只有「每一条时序槽都是 `error`、且原因是同步读取器那句拒绝」。
那句原文是跨包的一句约定（`app/src/runtime/bindingReader.ts` 的 `SERIES_MESSAGE`），
本包够不到它的定义（`packages/*` 不许依赖 `app/`），只能在 `series.ts` 里留一份常量。
两边真漂了也**不会画错数**，只是退回通用空态——这是刻意选的失效方向。

---

## 4. 配置面

| 分段 | 键 |
|---|---|
| 数据 | `title` · `series`(array) · `emptyText` |
| 样式 | `chartStyle` · `palette` · `areaGradient`/`areaGradientTo`/`areaTopAlpha`/`areaOpacity` · `showSymbol`/`symbolSize` · `unit`/`precision` · `showDataZoom` |
| 坐标轴 | `xAxisName` · `yAxisName` · `yScale` · `boundaryGap` · `dualAxis` · `rightAxisName` |
| 图例 / 提示框 / 数据标签 / 动画 / 参考线 | 五组片段工厂 |

`series` 行内：`name` · `unit` · `precision` · `color` · `axis(left|right)` · `lineType`。

`contentKeys: ['title', 'series', 'emptyText', 'rightAxisName']`。
**顶层没有任何 `type: 'json'` 的数据矩阵字段**——那是「假数据接入」，本设计的红线。

五档画法：`line` / `smooth` / `area` / `stackedArea` / `step`。
⚠ `stackedArea` 把各条系列的值逐点相加，只有**采样时刻对齐**的几条才叠得对；
而两条系列的窗口本来就允许不同，时刻对不上时叠出来的高度没有物理意义。

### 4.1 缺省值上的四处判断

- `showLegend: true`——图例是逐条状态唯一的承载面，关着等于「取不到的那几条一声不吭」。
- `showValueLabel: false`——一条曲线动辄几百个点，逐点挂标签会把整块糊成一片。
- `showSymbol: false`——同上，几百个圈会连成一条粗带。
- `yScale: true`（数值轴不强制含 0）——工艺温度这类高基线上的窄幅波动，含 0 的轴上是一条直线。

---

## 5. 双轴与参考线

- `dualAxis` 开着时 `yAxis` 是两根，逐条按 `axis` 档挂 `yAxisIndex`；右轴不再画一遍
  分隔线（两套横线叠在一起网格会变成双份）。没开双轴时右轴那一档**静默等同左轴**。
- **刻度上不写单位**：双轴时两根轴量纲不同，把整块那一个单位贴到两根轴上就是给右轴
  标了一个错的单位。单位写在轴名与提示框里。
- ⚠ **参考线只挂在一条 series 上**，且它跟着那条 series 的 `yAxisIndex` 走。
  开了双轴还随手挂在第一条上，参考值会按另一根轴的量纲落位——线画出来了，位置是错的，
  且零报错。故挂在**左轴**第一条画得出来的系列上；一条左轴系列都没有时才退到第一条。

---

## 6. 性能与刷新口径

- `partialMerge: ['series', 'legend']`：图例承载逐条状态，series 承载曲线本身，两者都随值走。
  画布正中没有派生读数，故不必像饼族那样把 `title` 一起纳入。
- `valuesDeep: false` + `watchValues: () => signature`：签名只取**行数 + 各行点数 +
  末点 t/v + 状态**这类廉价指纹，不深遍历序列。6 条 × 几百个点逐键深度遍历一遍，
  每个刷新节拍都来一次。
- `connectNulls: false`：缺口就是缺口，连起来会把「这段时间没采到数」画成一条假线。
- 不开 `hostClickable`：缩放条与内置缩放都是拖拽手势，松手也会派发一次 click。

### 6.1 ⚠ `grid.containLabel` 在 echarts 6 上已经作废

`chartKit.cartesianGrid()` 缺省写 `containLabel: true`。echarts 6 起它需要额外
`use(LegacyGridContainLabel)` 才生效，否则每渲染一次刷一句 warn，而左边一列刻度
会被裁在绘图区外。本模块显式传 `containLabel: false`，改用官方给的等价写法
`{ outerBoundsMode: 'same', outerBoundsContain: 'axisLabel' }`。

⚠ 这是 `shared/chart/` 自己的一处欠账，`bar-chart` / `calendar-heat` 会同样撞上。
根治要么在 `echarts.ts` 里注册那个 legacy 特性，要么把 `cartesianGrid()` 改成产出
新的那一对键——两处都不在新模块 PR 的豁免路径里，故本轮只在模块侧绕开，记成欠账。

---

## 7. 与设计文档的三处偏离

### 7.1 补了 `ModuleSlotMeta.truncatedSide`（跨包）

`DASHBOARD_CHART_MODULES_DESIGN.md` §8 要求「`isTruncated` 的文案必须说清砍的是
哪一头」，但落地的链路把方向丢在了 `slotOfOutcome`：`SeriesOutcome.truncatedSide`
有，`BindingSlot` 与 `ModuleSlotMeta` 没有。模块只拿得到「截断了」这一位，
就只写得出一句被明令禁止的通用话。本轮补了三处：

- `packages/contracts/src/module.ts` —— `ModuleSlotMeta` 加 `truncatedSide?: 'early' | 'late'`
- `packages/runtime/src/moduleValues.ts` —— `BindingSlot` 的 ok 档加同名字段，`okSlotMeta` 有才写
- `packages/runtime/src/seriesSlots.ts` —— `slotOfOutcome` 原样带上来

⚠ 这三处**不在新模块 PR 的规模豁免路径里**，落地时应当拆成一轮独立的铺路提交。

### 7.2 没摆「类目标签间隔」

`axisIntervalFields()` 产出三项，其中 `xLabelInterval` 是类目轴的抽稀口径
（`axisLabel.interval` 只对类目轴生效）。时间轴上它是一个配了没反应的旋钮，
故在清单里按键名滤掉，另外两项（`yScale` / `boundaryGap`）照收。

### 7.3 预设不写数值口径、轴名与参考线

`unit` / `precision` / `xAxisName` / `yAxisName` / `refLines` 五个键一套都不写。
前四个是这块屏的数值口径（℃ 就是 ℃，轴名多半也带着单位），最后一个是数据判据
（超过 80 报警）。一套观感把它们抹成空串或空表，等于让用户配好的东西在换个样子时消失。
⚠ 其中只有 `rightAxisName` 在 `contentKeys` 里（那是设计文档钉死的名单），
另外四个靠预设用例这一条闸兜着。

---

## 8. 目录与文件

```
web/packages/modules/src/modules/trend-chart/
├── manifest.ts       唯一 export default defineModule({...})；含 description 与 contentKeys
├── Component.vue     套 ChartShell；只做「读 config/values → build 闭包」
├── option.ts         ChartBuild 实现：(theme, resolve) => ECOption，时间刻度的格式化也在这里
├── series.ts         取值层：config + values + meta.slots → SeriesView[]
├── options.ts        枚举取值表（as const satisfies readonly ConfigOption[]）
└── presets.ts        ConfigPreset[]，每套写全全部观感键
```

⚠ 入口文件名必须是 `manifest.ts`：叫 `index.ts` 的话模块从模块库**静默消失**。
⚠ `manifest.ts` 里绝不静态 import `Component.vue` / `option.ts`：注册用的 glob 是
`eager: true`，静态引一下就破坏懒加载语义。
⚠ 时间的格式化只能写在 `option.ts` 里：`.vue` 里 `new Date(` / `toLocaleString(` 是红灯。

---

## 9. 落地要改的六份花名册

| # | 路径 | 改什么 |
|---|---|---|
| 1 | `web/packages/modules/tests/manifests.contract.spec.ts` | 目录数组加 `trend-chart`；`SERIES_ITEMS_KEY` / `SERIES_SLOT_KEY` 登进 `KEY_CONSTANTS` |
| 2 | `web/packages/modules/tests/registerBuiltins.test.ts` | `BUILTIN_TYPES` 加一项 |
| 3 | `server/.../apps/dashboard/module_types.json` | `pnpm vitest run packages/modules/tests/catalog.contract.spec.ts -u` 重生成 |
| 4 | `server/services/platform-server/tests/contract/test_dashboard_module_catalog.py` | 加一项 |
| 5 | `server/services/platform-server/tests/unit/test_dashboard_module_catalog.py` | 加一项 |
| 6 | `server/services/platform-server/tests/integration/test_dashboard_module_types_api.py` | 加一项 |

⚠ #4 与 #5 同名不同目录，只改一份的表现是另一份当场红。
⚠ `module_types.json` 是**烤进 platform-server 镜像**的，改了要重建镜像。

---

## 10. 一期不做的

| 不做 | 理由 |
|---|---|
| 公开屏上的历史 | 需要 public-dashboards 前缀下的代理端点 + 匿名规则 + 限流，且要重新审「匿名能读多久的历史」。本轮只在空态里照实说明 |
| 归档心跳结转（空桶按 `archive_max_interval_ms` 结转成上一个值） | 心跳来自 `CollectPoint`，大屏绑定里没有；要为它多取一趟点位元数据。空桶目前就是空桶，与趋势页的口径有这一处差异 |
| 逐条各自的参考线 | `markLineFields()` 的行里没有轴别字段，加字段要动 `shared/chart/chart-config.ts`，那不在新模块 PR 的豁免路径里 |
| 曲线上的区域标记（`markArea`） | `MarkAreaComponent` 没有注册，写了静默不渲染 |
| 逐条切「阶梯 / 平滑」 | 画法是整块一档。逐条切要在行里再加一个枚举，值得等到真有人提 |
