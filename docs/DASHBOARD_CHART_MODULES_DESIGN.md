# 大屏图表模块扩展 —— ECharts 族与序列取数链路

> 关联：[`DASHBOARD_DESIGN.md`](DASHBOARD_DESIGN.md) §4–§7、[`DATASET_DESIGN.md`](DATASET_DESIGN.md) §2.2/§6.2/§16、
> [`COLLECT_DESIGN.md`](COLLECT_DESIGN.md) §6、[`MODULE_INFO_CARD_DESIGN.md`](MODULE_INFO_CARD_DESIGN.md)（模块落地流程的蓝本）。

---

## 1. 这份设计要解决的问题

本仓大屏今天有 14 个模块（`packages/modules/src/modules/` 实测），能画**当前值**的一切形态（KPI 网格 `info-card`、可组合卡 `data-card`、五档几何仪表 `gauge-card`、行清单 `info-list`、事件流 `info-feed`、3D/2D 孪生），但：

- **一条曲线都画不出来。** 全仓没有任何模块声明 `isTimeSeries`（`module_types.json` 里 `is_time_series` 出现 **0** 次），求值内核是同步的，`app/src/runtime/bindingReader.ts:66-68` 对 `archive` / `dataset` 一律返回 `{state:'error', message:'序列要异步取数，画布上不展开'}`。
- **画不出「谁比谁高」的共享值轴。** `info-list` 的进度件能表达单行占比，但没有共享值轴、没有类目轴、没有分组/堆叠、没有负值。
- **画不出占比构成、多维评价、长周期分布。**

同时，一套完整的图表基建**已经躺在仓里且零消费者**：`web/packages/modules/src/shared/chart/`（`chart-config.ts` 588 行 / `chartKit.ts` 531 行 / `theme.ts` 184 行 / `echarts.ts` 158 行 / `useEChart.ts` 140 行 / `ChartShell.vue` 103 行，六份测试齐备），`echarts: "^6.1.0"` 已在 `@dt/modules` 的 dependencies 里。**本设计不新建基建，只接上它、补那一段断掉的取数、并补两处基建自己的缺口（分辨率、无障碍）。**

### 1.1 一条贯穿全文的红线

> **禁止「靠 config 里手填静态 JSON 矩阵撑场面」。**

参考仓 BK 有 6 个图表模块（`heatmap` / `sankey` / `graph` / `boxplot` / `candlestick` / `hierarchy`）是 `bindings: []`、`buildOption` 的 `values` 形参写成 `_values`——运行期一行值都不读，全靠 `config.data` 手填。另有 4 个（`bar` / `line` / `pie` / `radar`）切一下样式下拉就从实时点位变成手填 JSON，界面上没有任何提示。这一档一个都不搬。本设计里 5 个模块的每一个数都来自绑定槽；结构性配置（系列名、单位、量程、颜色）留在 config，那与 `gauge-card` 的量程、`twin-2d-view` 的节点边是同一个口径。

---

## 2. 选了哪五个

| # | type | 名称 | 解决哪张屏上的哪个问题 | 为什么已有 14 个凑不出来 | 优先级 |
|---|---|---|---|---|---|
| 1 | `trend-chart` | 趋势曲线 | 工艺温度/压力/流量/功率过去 N 小时怎么走的；两条工艺线叠在一起看 | 没有任何模块有时间轴 | **P0** |
| 2 | `bar-chart` | 对比柱图 | 12 台逆变器当前出力谁高谁低；按小时/按班次的能耗柱；产量柱 + 达标率折线（双轴） | `info-list` 的进度件是逐行独立的百分比，没有共享值轴 → 两行的条长不可比；也没有分组/堆叠/负值/双轴 | **P1** |
| 3 | `pie-chart` | 构成环图 | 能源结构占比、各工段用量构成 | `info-card` 能摆 6 个数字，但占比要归一化并画成扇形面积 | **P1** |
| 4 | `radar-chart` | 多维雷达 | 绿色工厂评价、设备健康度、多维达标情况 | 多轴各自量程归一后叠成一个封闭形状，本仓没有这个几何 | P2 |
| 5 | `calendar-heat` | 日历热力 | 每日能耗/每日达标率的长周期分布，一眼找异常日 | 一年 365 格的密度，`info-list` 的行结构摆不下；也没有色阶映射 | P2 |

### 2.1 明确不做的

| 不做 | 理由 |
|---|---|
| ECharts 仪表盘族（BK `gauge-chart`，1354 行） | `gauge-card` 已有五档几何、量程链、目标标记、`bindingRowCounts` 实体钉行。多指针与等级盘若真有需求，扩 `gauge-card` 而不是新建 |
| BK 的 `kpi-card` / `kpi-group` / `metric-status-table` / `progress-gauge` / `target-progress` | 被 `info-card` / `info-list` / `gauge-card` / `data-card` 完全覆盖，且本仓那几个做得更好 |
| BK 的 `compare-chart`（同环比） | **不另建模块**，用 `bar-chart` 的行级 `plot(bar\|line)` + `axis(left\|right)` 覆盖。`BarChart` 与 `LineChart` 都已注册 |
| 桑基 / 关系网络 / 层级树 | 结构是拓扑、值是绑定——这正是 `twin-2d-view` 在做的事 |
| 区域地图（BK `geo-map`） | 1 MB 底图 + 懒注册红线。工厂大屏要地理分布，用素材库放厂区底图 + `twin-2d-view` 打点更贴切 |
| 散点/气泡 | **不是做不了**（`:aggregate` 一次收 50 个点位、按 `bucket_start` 天然对齐，就是配对取数），是这一轮优先级不够 |
| K 线 / 箱线 / 风向罗盘 / `efficiency-overview` / `generic-chart` | 分别是：金融图硬套、需要原始样本而本仓只存归档读数、气象专用、领域硬编码 1421 行、BK 自己都说它是历史遗留 |
| 表格模块 `data-table` | 它不是 ECharts 模块，但它是真缺口（§15 Q4） |

### 2.2 五个模块零新增 echarts 注册项

`shared/chart/echarts.ts:98-128` 已 `use()` 了 17 种 series + 10 个组件 + CanvasRenderer。逐个核对：`LineChart` / `BarChart` / `PieChart` / `RadarChart` / `HeatmapChart` / `CalendarComponent` / `VisualMapComponent` / `DataZoomComponent` / `MarkLineComponent` / `RadarComponent` / `GridComponent` / `LegendComponent` / `TooltipComponent` **全部已在清单里**。`echarts.ts` 与 `tests/shared/chart/echarts.test.ts:67-96` 那份逐项全等的 `REGISTERED` 数组一行都不用改。

> ⚠ **未注册的东西是静默失效**：`GraphicComponent` / `MarkAreaComponent` / `MarkPointComponent` / `DatasetComponent` / `TransformComponent` / `ToolboxComponent` / `AriaComponent` 都不在清单里，写了 `series.markArea`、`graphic`、`dataset`、`toolbox` 会被**静默丢弃、既不报错也没有半张图**。本设计的所有画法都绕开了它们（这也是 §8 逐槽状态只能画在图例上的原因）。

---

## 3. 数据接入总表

| 模块 | 实时 | 历史 | 绑定形状 | 静态 JSON 矩阵 |
|---|---|---|---|---|
| `trend-chart` | `opcua`（可选末值追加） | **`archive` / `dataset`** | 数组槽 `seriesValues`，行内 `series`(时序) + `latest`(标量) | ❌ 无 |
| `bar-chart` | `opcua` / `computed` / `static` | `archive` / `dataset` | 数组槽 `barValues`，行内 `value`(标量) + `series`(时序) | ❌ 无 |
| `pie-chart` | `opcua` / `computed` / `static` | — | 数组槽 `sliceValues`，行内 `value` | ❌ 无 |
| `radar-chart` | `opcua` / `computed` / `static` | — | 数组槽 `axisValues`，行内 `value` + `compare` | ❌ 无 |
| `calendar-heat` | — | **`dataset` / `archive`** | 数组槽 `dayValues`，行内 `series`(时序) | ❌ 无 |

五个模块**全部**用「行钉实体的数组槽」（`isArray` + `isEntityPinned` + `bindingRowCounts` + `bindingRowLabels`），因为：

1. 系列/扇区/轴的名称、单位、小数位、颜色、量程**都是配置**，必须有一份 config 侧的数组；这正是实体钉行的定义。
2. 「配了 6 个系列先接 2 个」是常态。实体钉行允许中间留空；列表式在服务端被强制「索引连续且从 0 起」（`binding_rules.py` 文件头写明这条），第 2 个绑定直接存不下去。
3. `bindingRowLabels` 能让绑点面板显示系列名，而不是「第 3 行」。

> ⚠ `isEntityPinned` 与 `bindingRowCounts` 是同一档口径的两半，**缺一不可**：漏 `bindingRowCounts` → 绑点面板摆出一个「新增一行」，加出来的行永远喂不到东西；漏 `isEntityPinned` → 服务端套索引连续校验，而错误文案说的是「索引不连续」，跟真正的原因八竿子打不着。一项都没有的槽也要给 `0`，别把键漏掉。

### 3.1 一条容易被忽略的架构事实：**窗口住在绑定上，不在模块 config 上**

取数窗口（`lastWindow` / `fromMs` / `toMs`）是**每条绑定**的 `detailJson.range`，由绑点面板 `BindingSourceEditor.vue:65/101/123` 写入，模块既读不到也改不了。因此：

- `trend-chart` 不摆「时间范围」配置项，它只能按取回的点算实际跨度；
- `calendar-heat` 不摆 `rangeMonths`，一年的日历靠绑定上写 `365d`（相对窗正则 `^\d{1,4}(s|m|h|d)$` 允许四位数）；
- 同一块图里两条系列的窗口可以不同——这是既有形状，模块必须容忍，画的时候按各自的点铺时间轴。

---

## 4. 铺路一：序列注入链路

### 4.1 今天断在哪

| 段 | 现状 |
|---|---|
| 配置面（选 archive/dataset、挑点位/台账列、填相对窗） | ✅ 完整 |
| 落库线形 `detail_json` ↔ `detailJson` | ✅ 完整（`app/src/api/dashboardWire.ts:209-236` 逐字段显式映射） |
| 服务端存储 | ❌ **`dataset` 存进去会 500**（§4.2） |
| provider 实现 | ✅ `createHistoryProvider` / `createDatasetProvider` 都写好且有测试 |
| provider 注册 | ⚠ `fetchHistory` **两处**装配点注了；`fetchDatasetSeries` 全仓零注入，dataset provider 从未被 register 过 |
| 「读一条绑定 → 槽结果」 | ❌ `bindingReader.ts:66-68` 一律 error |
| 求值内核 | ❌ `BindingSlot`（`moduleValues.ts:19-29`）只有单标量的 ok/pending/error，`BindingValueReader`（:36-39）是同步签名 |
| 异步驱动器 | ❌ 完全不存在 |
| `isTimeSeries` 消费点 | ❌ 死字段，只有 `catalog.ts:110` 序列化它 |

### 4.2 修 `dataset` 存不进去（真缺陷）

```python
# server/services/platform-server/src/platform_server/apps/dashboard/services/binding_rules.py:34-40
_REQUIRED_PAYLOAD = { "opcua": …, "static": …, "computed": …, "archive": … }   # 缺 dataset
#                                                                        :211
name, message = _REQUIRED_PAYLOAD[binding.source_kind]                          # KeyError('dataset')
```

`apps/dashboard/source_kinds.py:9` 的 `SourceKind` 与 DB CHECK 都已含 `dataset`，于是它先过了 `:203` 那道「来源已注册」，再撞 `:211` 的下标。`BindingSlotEditor.vue:41` 对每个槽都摆出全部 5 种来源，用户随手一选就撞得上。`tests/unit/test_dashboard_binding_rules.py` 里 `source_kind='dataset'` 零覆盖。

**修法**：补 `"dataset": ("detail_json", "台账绑定必须给出取数说明")`，并补两条用例（修复前 `KeyError` 必红 / `detail_json` 缺失应 400 而不是 500）。

### 4.3 序列槽的契约与求值注入

**D1 · `BindingSlot` 加的是 ok 档上的可选伴生字段，不是第四个 state；`ModuleSlotMeta` 同步扩。**

```ts
// packages/runtime/src/moduleValues.ts
export type BindingSlot =
  | { state: 'ok'
      value: unknown
      /** 采样时刻，UTC 毫秒。⚠ 序列槽一律不写它，见下方警告。 */
      timestampMs?: number
      /** 时序槽才有：按时刻升序。⚠ 缺席 ≠ 空序列。 */
      points?: readonly HistoryPoint[]
      /** 窗内还有更多点，只取回了上限条。 */
      isTruncated?: boolean
      /** 值来自降级路径。陈旧必须标注为陈旧。 */
      isStale?: boolean }
  | { state: 'pending' }
  | { state: 'error'; message: string }

// packages/contracts/src/module.ts —— 模块唯一能读到的那一份
export interface ModuleSlotMeta {
  state: 'ok' | 'pending' | 'error'
  message?: string
  timestampMs?: number
  /** 序列触顶：窗内还有更多点。文案必须说清砍的是哪一头。 */
  isTruncated?: boolean
  /** 值来自降级路径。 */
  isStale?: boolean
}
```

为什么不加第四档：`computeModuleStatus` 与 `ModuleValuesTally` 的六个计数是一台按 state 分档的状态机；加一档要连 `moduleStatus.ts`、`ModuleSlotMeta` 的「三档缺一不可」注释、`ModuleStatusOverlay.vue` 一起动，且会破坏多条契约测试。

> ⚠ **序列槽的 ok 档绝不写 `timestampMs`。** `moduleValues.ts:260` 拿它记 `tally.sampled`，`moduleStatus.ts:76` 据此在通道断开时判 `stale`，`:96` 对 `stale` 一律放行角标——而 archive/dataset 是 HTTP 拉的，跟 WS 没关系。写了的表现是：WS 一抖，一屏的图表全挂「可能过期」角标，而它们的数据一秒都没旧。时刻信息本来就在 `points` 里。
> ⚠ **`ModuleSlotMeta` 不扩的话，`isTruncated` 写了、编译过，模块里永远读到 `undefined`**——`moduleValues.ts:244-251` 的转换处只搬 state/message/timestampMs。必须补一条「这两个字段真的到了 `meta.slots`」的契约用例。

**D2 · `points` 只注入到数组行内，键是同级的 `<sub>Points`，且逐点跑同一份 `applyTransform`。**

`seriesValues[0].series` → 求值层额外写 `values.seriesValues[0].seriesPoints`。

为什么不做顶层标量时序槽：`manifests.contract.spec.ts:367-374` 那条「绑定槽键两侧逐一对上」只扫模块目录本身（`keysOf(moduleFiles(...), 'values')`，不跟 import 走）并要求与声明的槽键**逐一相等**。顶层时序槽 `foo` 注入的 `values.fooPoints` 会被判成暗键、当场红。数组槽没有这个问题——模块只读 `props.values[SLOT_KEY]`，`.seriesPoints` 在行对象里，不被扫描。

> ⚠ **变换必须跟着走**：`moduleValues.ts:252-256` 的 `applyTransform` 只作用于标量 `slot.value`。配了 `scale: 0.001`（Pa→kPa）的系列，若 `points` 原样注入，末值/tooltip/markLine 阈值是 kPa 而曲线本体和 Y 轴还是 Pa——差三个数量级、零报错，而同一个点位在 `info-card` 上显示的是转换后的值，两块并排摆着数对不上。`applyEnumMap` 对数值序列无意义，跳过。必须补一条「带 transform 的时序槽，points 与 value 同口径」的必红用例。

**D3 · `points` 缺席时绝不写 `[]`。**

BK 的 `moduleValues.ts:215` 是 `let pts: HistoryPoint[] = []` 然后无条件注入。照抄这一行，会让「表被删 / 绑定悬空 / 端点 500」全部渲染成一张看不出问题的空图。取不到的信息留在 `slots[fieldKey].state === 'error'` 上，模块自己画。

**D4 · 「取到了但窗内 0 点」的口径必须显式。**

`moduleValues.ts:257` `if (value === null || value === undefined) state.tally.empty += 1`，`moduleStatus.ts:77` `tally.bound > 0 && tally.ok === 0 → 'empty'`。规定：取数成功但 `points.length === 0` 时，`state: 'ok'`、`points: []`（这是**取到了确实没数据**，与 D3 的「取不到」是两码事）、`value: null`。于是整块折成 `empty` 并盖空态浮层，与「没绑」（`bound === 0` → `connected`）分得开。补一条用例钉住这两种情况的不同表现。

**D5 · 驱动器只认 `spec.isTimeSeries` 这条声明，不认来源种类；但对来源做穷举拒绝。**

`packages/runtime/tests/sourceLiterals.contract.spec.ts` 扫 `packages/runtime/src` 全部 `.ts`/`.vue` 且**不剥注释**——新文件里出现 `'archive'` / `'dataset'`（含注释里的）就红。这与「派生槽由 `computeJson` 这条声明认出来」是同一条纪律。

做法：驱动器只判 `spec.isTimeSeries === true` 与 `binding.detailJson !== null`。**`detailJson` 为 null 的时序槽一律产出 `{state:'error', message:'这一档来源给不出历史序列'}`**——`detailJson` 只有 archive/dataset 两支有（`contracts/src/dashboard.ts:133-139`），于是「时序槽绑了实时点位/常量/派生」这条最容易踩的路被堵死，且 runtime 一个来源字面量都没出现。

**D6 · 序列槽由 `ModuleRenderer` 包在注入的 `read` 外面，`bindingReader.ts` 一行不改。**

```ts
// ModuleRenderer.vue:162 现在是 read: () => runtimeData.readBinding()
read: () => {
  const base = runtimeData.readBinding()
  return (binding, siblings) =>
    seriesSlots.value.get(binding.fieldKey) ?? base(binding, siblings)
}
```

收益：① 非时序槽绑了 archive/dataset 仍返回原来那句 error（**本来就画不出，这是对的**）；② `app/tests/runtime/bindingReader.test.ts` 不用改；③ runtime 仍然不认识来源种类。

**D7 · 竞态防护两层，且第一层要真的接得上。**

- 层一：`AbortController`。⚠ 现有 `DataSourceProvider.readHistory(query)`（`contracts/src/datasource.ts:101`）**不收 signal**，`fetchPointHistory` 也不收——只有 `fetchPointAggregate`（`pointHistories.ts:137`）收。本稿的批量取数适配器直接调 `fetchPointAggregate` 与 `getDatasetSeries`（`dataset.ts:584` 收 signal），**两条真链路都能 abort**，所以这一层是真的。
- 层二：`slotKey(binding, epoch)` = `fieldKey` + `detailJson` 的稳定序列化（键排序、不含时钟不含随机）+ epoch。键一变 = 换了一次取数，旧的 `abort`，且**结果到了也不许写**（`AbortController` 只让请求早点返回，拦不住已经拿到结果的那一次）。
- `watch` 的依赖**只能是 bindings/specs 派生的签名，绝不能依赖槽表本身**。写槽 → values 重算 → 再驱动 = 无限循环。

> ⚠ `slotKey` 里只能放 `detailJson` 的**原文**（`lastWindow: '1h'`），不能放算好的 `fromMs`/`toMs`——每次刷新窗口都往前滑，放进去去重就废了。
> ⚠ `check_ts_style.py:235-263` 的「竞态防护只许用 `useRacedFetch`」**只扫 `app/`**（注释明写「`packages/*` 不许依赖 `app/`，包里够不到它」）。所以 runtime 里手搓世代号是允许的；但 **`web/app/` 下任何新文件里一旦出现 `const mineX = ++seq` 这种形状就会被强制改用 `useRacedFetch`**（`app/src/composables/useRacedFetch.ts`）。

**D8 · 刷新节拍在应用壳，一屏一个。**

`RuntimeDataSource` 加 `seriesEpoch?: () => number`，由应用壳给一个 60s +1 的 ref，`document.hidden` 时停拍、可见时补一拍。编辑器**不装**节拍（编辑期不自动刷新）。见 §15 Q1。

**D9 · 文件切分与行数上限。**

- `packages/runtime/src/seriesSlots.ts` —— 纯逻辑（`pointsKeyOf` / `slotKeyOf` / 请求分组），**不以 `use` 开头**，因此不受 200 行上限。
- `packages/runtime/src/useSeriesSlots.ts` —— 只留生命周期接线（watch、abort、`onScopeDispose`）。⚠ `check_ts_style.py:90-95` + `:27`：`src` 下所有 `use` 开头的 `.ts` 一律 ≤200 行，量的是整个文件行数。这是 `use` 前缀的**代价**，不是安全网——`LONG_LIVED`（:43-47）不认 `watch` 与 `AbortController`，卸载清理闸对这个文件本来就不响。

### 4.4 对既有模块与契约测试的影响

| 面 | 判断 |
|---|---|
| 14 个既有模块 | ✅ 无一声明 `isTimeSeries`，新分支对它们是死路径，行为零变化 |
| `BindingValueReader` 签名（`grep -rn` 实测 **28** 处引用，含两个 Twin 编辑器与 CardEditor） | ✅ **不改** |
| `app/tests/runtime/bindingReader.test.ts` | ✅ 因 D6 而**不用改** |
| `sourceLiterals.contract.spec.ts` | ⚠ 最容易踩，见 D5 |
| `providers.contract.spec.ts` | ✅ 不加第六种来源、不改 `DataSourceProvider` 接口就不动 |
| `contracts/src/module.ts:206-208` 的 `isTimeSeries` 注释 | ⚠ 现在写着「只有 `opcua` / `archive` 有真实历史」，没有 `dataset`。它经 `catalog.ts:110` 下发给 AI 助手，不改的话助手会拒绝给时序槽配台账。**必须一起改并重跑 catalog 快照** |
| `app/src/features/dashboard/previewBindings.ts` | ⚠ 它按行对象的**每个键**摊成一条 static 绑定，于是模块库缩略图里 `seriesValues[0].seriesPoints` 会走正常求值链、在 `slots` 里多出一个模块自己不认识的 fieldKey，`tally.bound` 也多一条。**设计态与运行态在这一格不同形**，逐槽状态画法必须容忍多余键；模块的 `preview` 里只放少量演示点 |

### 4.5 与现有历史读侧口径的三条落差

| # | 事实 | 处理 |
|---|---|---|
| 1 | `lastWindow` 是**纯前端换算**：`pointHistories.ts:46-48` 的 `/^(\d{1,4})(s\|m\|h\|d)$/` 不匹配就 `return DEFAULT_WINDOW_MS`。`'1w'`、`'30min'`、`'1H'` 全部静默变成 1 小时，配置面是个自由文本框、无校验 | 取数适配器里把认不出的写法变成 `invalid-query` 而不是静默回落。✅ 安全：`fetchPointHistory` 今天的调用方只有两处 provider 注入（`DashboardView:69`、`useEditorDataSources:31`），而 `bindingReader` 在它之前就 error 了，实际零生产流量 |
| 2 | `limit` 的语义与契约注释**相反**：注释（`binding.ts:81`）说「取最新的那批」，`fetchPointHistory` 实现拿到的是窗口里**最早**的 N 个（后端游标 `ts ASC` 正向，`:91-114`） | 模块的 configSchema 不摆 `limit`；改走分桶聚合后这一格不再暴露给用户 |
| 3 | 两个端点触顶砍的是**相反的两头**：点位逐条读砍晚的（正序取前 N，`pointHistories.ts:114`）；台账 `:series` 砍早的（`dataset_series.py:65` 的 docstring 与 `record.py:27` 都写「留下的是**最新**那批」） | `isTruncated` 的文案必须说清砍的是哪一头，不能写一句通用的「数据被截断」。由适配器把方向一起带上来（见 §5.2 的 `SeriesOutcome`） |

---

## 5. 铺路二：取数走分桶聚合 + 批量合并

### 5.1 为什么不能走逐条原值

`pointHistories.ts` 文件头 :8-10 自己写着：「逐条是**原值**，绑定与导出要它；分桶是**降采样**，一屏画几个小时的曲线要它。1 秒采样的点位一天有八万多条读数，**逐条读只够读到窗口开头那一小截**」。而 `DEFAULT_MAX_POINTS = 1000`（:28）、`PAGE_LIMIT = 200`（:25），触顶砍**晚**的一头（:114）。后果：

- 10s 点位配 `24h` 窗 = 8640 点 → 只画到最早的 1000 点（前 ~2.8 小时），x 轴仍横跨 24 小时，用户读成「后 21 小时设备停了」；
- 1s 点位配 `1h` 窗 = 3600 点 → 只画前 17 分钟；
- 每条系列 5 次串行往返，6 条系列 = 30 次。

而 `POST /point-histories:aggregate` 已实现且已授权（`rules_platform.py:183-190` 按 `collect:view` 放行，注释写「动作端点必须排在 930 的前缀兜底之前，否则只读用户看不了曲线」），一次收 50 个点位、带 `timezone`、带 `AbortSignal`。**因此 archive 序列默认走聚合，逐条原值降级成显式的短窗选项。**

仓内已有可直接复用的两块：`app/src/features/trend/trendBucket.ts` 的 `resolveTrendBucket(windowMs, interval)`（档位梯子 + `TREND_BUCKET_CAP = 200` / `TREND_BUCKET_TARGET = 190` 的选档口径）与 `holdBucketValues`（按归档心跳结转空格）。`app/src/pages/Trend/scripts/pointTrendData.ts:66-105` 是一份可照抄的参考实现。

> ⚠ 桶数上限是 `MAX_PAGE_SIZE(200) × 点位数`（`history_service.py:268-275`）。单点位一年 365 个日桶会触顶——`calendar-heat` 的长窗必须切成 ≤190 天的多段再拼。
> ⚠ `holdBucketValues` 需要逐点位的归档心跳 `holdMs`，那来自 `CollectPoint.archive_max_interval_ms`，大屏绑定里没有。**未确认**大屏侧要不要为此多取一趟点位元数据；一期先不做心跳结转，空桶就是空桶，并在模块文档里写明这与趋势页的口径差异。

### 5.2 取数口收成批量

```ts
// packages/contracts/src/datasource.ts（新增，不改 DataSourceProvider）
export interface SeriesRequest {
  /** 槽键，回填时按它对号入座。 */
  fieldKey: string
  /** 取数说明原文；runtime 不判别它是哪一支。 */
  detail: BindingDetail
}
export type SeriesOutcome =
  | { state: 'ok'
      points: readonly HistoryPoint[]
      isTruncated: boolean
      /** 触顶砍掉的是哪一头；文案据此写。 */
      truncatedSide?: 'early' | 'late'
      isStale: boolean }
  | { state: 'error'; message: string }
/** 一次读一批序列。⚠ 收一批不是收一条：同表同窗的多列必须并成一次请求。 */
export type SeriesReader = (
  requests: readonly SeriesRequest[],
  signal: AbortSignal,
) => Promise<ReadonlyMap<string, SeriesOutcome>>
```

为什么必须是批量：一块绑了同一张台账 6 列的模块，逐条会发 6 次完全一样表、完全一样窗口的请求，而 `:series` 端点本来一次收 50 列；点位侧 `:aggregate` 一次收 50 个点位。配合 60s 节拍，一屏三块 6 系列的图逐条取数是每分钟 90 次串行往返。**接口形状定错了，之后再改就是跨 3 个包的破坏性变更。**

分组规则（在 app 层做，runtime 不认来源）：
- archive：按 `(interval, aggregate, timezone, fromMs, toMs)` 分组，每组最多 50 个 `nodeKey` 一次 `fetchPointAggregate`；
- dataset：按 `(table_id, since, until)` 分组，每组最多 50 个列 key 一次 `getDatasetSeries`。

### 5.3 台账适配器要做的四件转换 + 一条硬限制

`getDatasetSeries(tableId, keys, range, signal)` 与 `HistoryPoint` 之间不是同一套线形，必须显式转换：

| 从 | 到 |
|---|---|
| `DatasetSeriesPoint.ts`（RFC3339 字符串） | `HistoryPoint.t`（UTC 毫秒，`Date.parse`） |
| `DatasetSeriesPoint.value` | `HistoryPoint.v` |
| `fromMs` / `toMs` | `range.since` / `range.until`（ISO 字符串） |
| `DatasetSeries.is_truncated` | `SeriesOutcome.isTruncated` + `truncatedSide: 'early'` |

> ⚠ `contracts/src/dataset.ts:316` 那句「字段名与点位历史读侧的 `HistoryPoint` 对齐」是**仓内一条错注释**，顺手改掉。
> ⚠ `HistoryTimeRange.limit` 在台账侧**无处可放**（端点没有 limit 参数），必须显式丢弃并在适配器注释里说明；台账一次最多回 `MAX_SERIES_ROWS = 20000` 行、留的是最新那批。
> ⚠ `ds:{code}:{列key}` 里的 `code` → `table_id` 没有 by-code 端点。现存办法是 `listDatasetTables({size: 200})` 拉一页本地匹配（与 `DatasetRefField.vue:25,62` 同款），**映射要缓存住**，且 **`has_more` 为真时必须报错**（「台账超过一页，解不出这张表」）而不是当「没有这张表」——`DatasetTableQuery`（`app/src/api/dataset.ts:49-52`）今天只有 `page`/`size`，`q` 只在后端有。把「前端补 `q` 或后端补 by-code 端点」记成已知欠账。

### 5.4 应用壳接线的边界

1. `app/src/runtime/seriesReader.ts`：`BindingDetail` 判别 → archive / dataset 两条批量路径。**app 层认来源，runtime 层不认**，这条缝就在这里。
2. `app/src/bootstrap/dashboard.ts`：补 `fetchDatasetSeries` 的真实注入（这个口子 `:54` 定义了但全仓零注入）、`readSeries` 与 `seriesEpoch`。
3. 装配点**只碰两处**：`DashboardView/index.vue`、`DashboardEditor/scripts/useEditorDataSources.ts`。
   - **不碰 `PublicDashboard/index.vue`**：:74-76 明令不装历史 provider，auth 侧 `_PUBLIC_RULES` 只放行 `public-dashboards/*`（注释写它是整个 platform 唯一的匿名可达前缀），`point-histories*` 与 `dataset-tables*` 都在认证面上。见 §15 Q2。
   - **不碰两个孪生编辑器**（`useTwinLiveValues.ts:60` / `useTwin2dLiveValues.ts:103`）：那两页不摆图表模块。

---

## 6. 模块的写法骨架（五个模块共用）

```
web/packages/modules/src/modules/<type>/
├── manifest.ts       唯一 export default defineModule({...})；含 description 与 contentKeys
├── Component.vue     套 ChartShell；只做「读 config/values → build 闭包」
├── option.ts         ChartBuild 实现：(theme, resolve, full) => ECOption
├── <domain>.ts       取值层：config + values + meta.slots → View[]（槽键常量、fieldKey()、rowLabels/rowCounts 一律与派生同住这里）
├── options.ts        枚举取值表（as const satisfies readonly ConfigOption[]）
└── presets.ts        ConfigPreset[]，每套写全全部观感键
```

```vue
<script setup lang="ts">
// ⚠ props 必须**恰好**是 config / meta / values 三件套（manifests.contract.spec.ts:416-427）
const props = defineProps<{
  config: Record<string, unknown>
  meta?: ModuleMeta
  values: Record<string, unknown>
}>()

const views = computed(() => buildSeriesViews({
  config: props.config, rows: props.values[SERIES_SLOT_KEY], slots: props.meta?.slots,
}))
const signature = computed(() => signatureOf(views.value))
const build: ChartBuild = (theme, resolve, full) =>
  buildOption(props.config, views.value, theme, resolve, full)
</script>

<template>
  <ChartShell
    :config="config" :values="values" :build="build"
    :is-empty="views.length === 0" :empty-text="readTrimmedText(config.emptyText)"
    :partial-merge="['series', 'legend']"
    :values-deep="false"
    :watch-values="() => signature" />
</template>
```

**必须记住的七条**：

1. **槽键要在 `Component.vue` 里字面读一遍**——「绑定槽键两侧逐一对上」那条闸（`manifests.contract.spec.ts:367-374`）只扫模块目录本身。而 `config.<键>` 那条（:347）查的是**可达集**（沿相对 import 递归），所以 `title` 由 `ChartShell` 读、`unit`/`palette` 由 `chartKit` 读**是算数的**——:136-137 的注释就是为图表族写的。
2. **取值函数的形参必须叫 `config` 和 `values`，不许先解构再读**（扫描器认的是 `config.x` / `props.config.x` 这种形状）；形参别叫 `values` 又对它 `.map`，会被认成读了一个叫 `map` 的槽。
3. **`options.ts` 的表是 `as const` 只读数组，清单里必须 `options: [...TABLE]` 摊一次**。直接赋值红在 TS4104，**且只有 `vue-tsc` 看得见**——vitest 的 esbuild 不做类型检查，整包测试会在它红着的时候全绿。
4. **`chart-config.ts:12-21` 的 `GROUP` 八个分段名不许另造字符串**，否则属性面板摆出两个近义分段。
5. **`manifest.ts` 里绝不静态 import `Component.vue` / `option.ts`**：`registerBuiltins.ts:19-21` 的 glob 是 `eager: true`，静态引一下就把渲染组件并进注册 chunk，并破坏 `component: () => import('./Component.vue')` 的懒加载语义。（⚠ **不是**「会把 echarts 拖进首屏」——`chartKit.ts:9` 对 echarts 是 `import type`，`echarts.ts:92-97` 全走动态 import，`startup-graph.contract.spec.ts` 只守 `three`。所以 `<domain>.ts` 里静态引 `chartKit` 没有风险，不必为此做多余的拆分。）
6. **`ChartShell` 的 `watchValues` 收的是函数**（`ChartShell.vue:26` `watchValues?: () => unknown`）；配 `:values-deep="false"`（`useEChart.ts:133` 缺省 `true`，6 系列 × 数百点会被逐点深度遍历）。
7. **`partialMerge` 一律给 `['series','legend']`**：图例是本设计里逐槽状态的唯一承载面，把它一起纳入替换范围，比推断 echarts 的组件 merge 语义稳；并配一条「系列从 pending 变 ok 后图例后缀跟着变」的组件用例。

---

## 7. 每个模块清单必须写全的字段

| 字段 | 闸门 | 漏了会怎样 |
|---|---|---|
| `description`（3–6 句、≥60 字、不含「用于展示/用来展示/一个模块/本模块用于」） | `description.contract.spec.ts:29-59` | 当场红。类型上可选，typecheck 放行 |
| `contentKeys`（`title` / 系列数组 / `emptyText` 这类**内容**键） | `catalog.contract.spec.ts` 校验声明的 key 真在顶层键里 | 不声明的话内容键被 `styleKeysOf`（`contracts/src/module.ts:432-440`）当成观感键，别人套预设时把用户配好的系列整片抹掉 |
| `arrayFields`（`isArray: true` 的槽） | `manifests.contract.spec.ts:277-287` | 当场红 |
| `bindingRowCounts` + `bindingRowLabels` | 无红灯 | 见 §3 的两条警告 |
| `type` 与目录名逐字相等 | `manifests.contract.spec.ts:242-248` | 当场红 |
| `icon` 在 `DtIcon` 注册表里 | `manifests.contract.spec.ts:289` | 唯一防线；写错名字**不报错也不渲染** |
| `defaultSize` 用本仓形状 | 无红灯 | BK 的 `{w,h,minW,minH}` 是多余可选属性，初始尺寸变 `undefined`，TS 不报错 |

---

## 8. 逐槽状态：`ownsStatusDisplay` 在图表上的新口径

先纠正一处：`contracts/src/module.ts:370-382` 的「多点位模块**必须**开」是**注释约定，不是红灯**（`manifests.contract.spec.ts` 里 `ownsStatusDisplay` 零命中，25 条契约用例没有一条守它）。现有 6 个使用者（`info-card` / `info-list` / `info-feed` / `gauge-card` / `data-card` / `twin-2d-view`）全是格/行/条目式模块，一张折线图**没有格子可画**。本设计定义如下口径，这是全仓第一份图表族的状态画法：

| 档 | 画法 |
|---|---|
| 该行没配来源（`slots` 里没这个键） | 该系列**整条不进 option**，图例也不列它 |
| `pending`（配了没首帧） | 图例列出系列名 + 后缀「等首帧」，series 数据为空数组、不画线 |
| `error`（取不到 / 这一档来源给不出序列） | 图例列出系列名 + 后缀「取不到」，图例文字取 `theme.textMuted` 置灰，series 数据为空数组 |
| `ok` 且 `isTruncated` | 正常画 + 图例后缀「只到 …」，并按 `truncatedSide` 说清砍的是哪一头 |
| `ok` | 正常画 |
| 全部系列都不是 `ok` | 交给 `ChartShell` 的 `isEmpty` + `emptyText`，画一层居中文案 |
| 公开屏上的时序模块 | 空态文案专门写「公开屏不提供历史数据」，不用通用的「暂无数据」 |

> ⚠ **不能用 `graphic` 组件画角标**——它不在 `echarts.ts` 的注册清单里，写了静默不渲染。`TitleComponent` 虽已注册，但 `ChartShell` 的标题走 `ModulePanel`，图表内的 `title` 一律 `show: false`。所以逐槽结论**只有图例这一个承载面**。
> ⚠ **一个子槽都不给 `isRequired`**：配了 6 条先接 2 条是常态，给了会让整块被判 `unbound` 并盖上浮层，逐槽四档白画。全仓至今零个模块用 `isRequired: true`。
> ⚠ `unbound` 与 `stale` 两档**仍然归整格浮层**（`moduleStatus.ts:92-97` 的 `showsStatusOverlay(owns, status) = !owns || status === 'unbound' || status === 'stale'`）。这也是 D1 规定「序列槽不写 `timestampMs`」的第二个理由。
> ⚠ 设计态（模块库缩略图）走 `previewBindings.ts` 那条路，`slots` 里会多出模块自己不认识的 `…Points` 键——状态画法必须按**声明的子槽**遍历，不能按 `slots` 的键遍历。

**`hostClickable` 的取舍**：开了 `dataZoom` 滑块或内置缩放的图表**不要开 `hostClickable`**（`contracts/module.ts:366-367` 与 `twin-2d-view/manifest.ts:185-186` 都明写了这条）。故 `trend-chart` 与 `bar-chart` 只开 `emitsInteractions`，点击由 `useEChart` 的图元点击上抛（`useEChart.ts:54-58` 已替图表族做了 `params.event.event.stopPropagation()`——zrender 事件裹着原生事件，要两层 `.event`）。`pie-chart` / `radar-chart` / `calendar-heat` 两者都开。

---

## 9. 基建自己的两处缺口

### 9.1 canvas 在缩放舞台上会糊

`DashboardView/index.vue:135` 把整个节点树套在 `transform: translate(...) scale(stage.scale)` 上（编辑器 `EditorCanvas.vue` / `EditorPreview.vue` 同款）；`echarts.ts:143` 是 `init(host)`，不传 `devicePixelRatio`。现有 14 个模块是 DOM/SVG，被放大后仍锐利；canvas 不是——1920 设计屏放到 3840 墙屏 = scale 2.0，位图只有一半分辨率。而 `useEChart.ts:99-100` 的 `ResizeObserver` 观察的是 border-box 尺寸、与祖先 transform 无关，**不会因为舞台缩放变化而触发**，所以这个糊没有自愈路径。

修法（全部落在 `shared/chart/`，不需要跨包 provide）：

- `createChart(host, opts?)` 收一个 `devicePixelRatio`；
- 缩放比就地量：`host.getBoundingClientRect().width / host.offsetWidth`（前者含累积 transform，后者是未变换的布局宽），`dpr = window.devicePixelRatio * ratio`；
- echarts 的 dpr 只在 `init` 时读，所以缩放比变化要 `dispose + 重建`。触发点：`refresh(true)` 时重算一次比值，变化超过 25% 才重建（编辑器逐格缩放时不至于每步重建）。
- 全仓 `devicePixelRatio` 只有两处命中（`Knowledge/components/DocumentPreviewPdf.vue:162`、`packages/three-core/src/sceneCore.ts:127`），大屏运行时今天零处理。

### 9.2 图表对读屏是纯空白

echarts 自带的 `AriaComponent` 未注册（注册它要改 `echarts.ts` 与 `echarts.test.ts` 的 `REGISTERED` 逐项断言）。本设计选**不注册**，改在 `ChartShell` 的宿主 div 上挂一段由 views 派生的 `aria-label` 文本摘要（新增可选 prop `ariaSummary`）——模块侧可控、零注册变更。

> 注：`nightly.yml:60-67` 的 axe 作业当前是空转（`web/e2e` 不存在），所以这不是闸门问题，是真空白。

---

## 10. 颜色、字体、格式化

- **色板只走 `SERIES_VARS` 六个 token**（`theme.ts:9-16`：`--accent-primary` / `--state-success` / `--state-warning` / `--state-danger` / `--accent-secondary` / `--state-idle`），按序取用、用完循环；用户覆盖走 `paletteOverrideField()` 且**只填 `var(--…)` 引用**。
- ⚠ **BK 的 `--chart-series-1..5` / `--chart-cold` / `--chart-hot` / `--chart-value-g1..g4` / `--card-icon-*` 在本仓全部不存在**（`packages/tokens/src` 里 `--chart-*` 零命中）。照抄 BK 的 `option.ts` 会让配色整片丢失，且不报错。
- ⚠ **`--state-idle` 没有 `-rgb` 伴生变量**（`tokens.scss` 只有 text-title / accent-primary / accent-secondary / state-success / state-warning / state-danger / state-info / neutral-fg 八个），`rgba(var(--state-idle-rgb), .45)` 整条声明作废。要半透明用 `withAlpha()`。
- ⚠ **绝不写 `color: ''`**：echarts 会把空串当成一种颜色画出**透明的线**，而不是回退默认色。取不到就省掉那个键——用 `withColor()`。
- ⚠ **`.ts` 里的色值字面量那道闸拦不住**：`check_ts_style.py:309-313` 的 `_styled_files()` 只扫 `.vue` 与 `src` 下的 `.scss/.css`。图表的 option 全在 `.ts` 里，「零色值字面量」在这里靠约定 + 评审 + 单测兜。
- **数值格式化统一走 `textFactory(config)`**（绑 `unit` + `precision`），tooltip 与数值标签共用一份口径。⚠ 小数位必须夹到 `[0,6]`：手编的 config 绕得过面板 `min`/`max`，越界会让 `toLocaleString` 抛 `RangeError`（`chartKit` 已夹）。
- ⚠ **`.vue` 里禁 `new Date(` / `toLocaleString(` / `toLocaleDateString(`**（`check_ts_style.py:54-56` 的 `INLINE_FORMAT`，`check_formatting_is_centralised` 只扫 `.vue`）。时间轴刻度格式化必须写在 `option.ts` 里。
- ⚠ **tooltip 的函数 formatter 返回值被 echarts 原样 `innerHTML`**，拼进去的类目名/系列名/单位全是编辑器里的自由输入 → 能编辑大屏的用户可以让只读访客悬停即中招。**必须过 `escapeHtml()`**。反过来，**别拿它转义 series label / axisLabel**：canvas 不解析 HTML 实体，单位里的 `&` 会显示成字面量 `&amp;`。
- **换肤必须整图重算**：canvas 不吃 CSS 级联，只换 series 改不掉轴、图例与提示框的颜色。`useEChart.ts:136` 已把 `useThemeRedraw` 接到 `refresh(true)`。
- ⚠ **中文串排序不钉 locale 会本地绿 CI 红**（CI 的 runner 是中文 locale）。图例/类目/系列名排序一律钉 `'zh-CN'` 或干脆不排序。

---

## 11. type id 与图标

`moduleTypeLiterals.contract.spec.ts` 拿每个已注册 type 去 `packages/runtime/src`、`app/src`、`packages/modules/src`（排除 `src/modules`）的**脚本区**里 grep 带引号的同名字符串（`.vue` 只取 `<script>` 块），命中即红。

**实测**：

| 候选 type | 扫描根命中 |
|---|---|
| `trend-chart` / `bar-chart` / `pie-chart` / `radar-chart` / `calendar-heat` | **0 / 0 / 0 / 0 / 0** ✅ |
| `chart-line` | **2**（`app/src/components/layout/navItems.ts:113`、`app/src/pages/Dataset/TableDetail/index.vue:65`；裸 grep 是 8，其余 6 处在模板里、被扫描器排除） ❌ |

> ⚠ **别把模块 type 命名成图标名。** 历史上同类事故：`button`（撞 `type="button"`）、`tabs`（撞 `variant: 'tabs'`）、`list`、`card`、`gauge`、`feed`。**动手前先按扫描器口径 grep 一遍候选名。**

**图标分配（零新增，不动 `DtIcon/registry.ts`）**：`trend-chart` → `chart-line`（:261）、`bar-chart` → `chart-column`（:262）、`pie-chart` → `chart-pie`（:263）、`radar-chart` → `chart-mixed`（:268，妥协：本仓没有雷达图标）、`calendar-heat` → `calendar`（:184）。

> ⚠ 加新图标要改 `packages/ui/src/components/DtIcon/registry.ts`，那**不在新模块 PR 的豁免集合内**，会让整个 PR 掉回 400 行硬闸。为一个图标另开一个铺路 PR 不值，故接受 `chart-mixed`。

---

## 12. 每个模块要改的六处花名册

一个模块 PR 的**全部**可评审改动只许落在这四类路径（`check_pr_policy.py:178-200`，**一个文件落在集合外就整体不豁免**，而错误信息只说「超 400 行」）：

1. `web/packages/modules/src/modules/<type>/**`
2. `web/packages/modules/tests/modules/<type>/**`
3. **六份花名册**（`MODULE_REGISTRY`，逐字）：

| # | 路径 | 改什么 |
|---|---|---|
| 1 | `web/packages/modules/tests/manifests.contract.spec.ts` | 目录 `toEqual([...])` 数组加一项（按字典序）；若用导入常量做键还要登进 `KEY_CONSTANTS` |
| 2 | `web/packages/modules/tests/registerBuiltins.test.ts` | `BUILTIN_TYPES` 加一项（按字典序） |
| 3 | `server/services/platform-server/src/platform_server/apps/dashboard/module_types.json` | **`-u` 重新生成**，不是手改 |
| 4 | `server/services/platform-server/tests/contract/test_dashboard_module_catalog.py` | `EXPECTED_TYPES` 加一项 |
| 5 | `server/services/platform-server/tests/unit/test_dashboard_module_catalog.py` | `known_types()` 断言集合加一项 |
| 6 | `server/services/platform-server/tests/integration/test_dashboard_module_types_api.py` | 断言集合加一项 |

4. `^docs/MODULE_[\w-]+\.md$`（必须直接在 `docs/` 下，不能有子目录）

> ⚠ #4 与 #5 **同名不同目录**，只改一份的表现是另一份当场红。
> ⚠ **一个 PR 最多一个新模块目录**：`_new_module()` 在 `len(fresh) != 1` 时返回 `None`，两个新模块 = 豁免整体失效。
> ⚠ **顺手改一行 `shared/chart/` 就整体失效**——这是本方案把 span、dpr、aria 全部前置成独立轮次的唯一原因。
> ⚠ `registerBuiltins.ts` / `registry.ts` / `catalog.ts` / `ModuleRenderer.vue` / 任何编辑器页面 / 任何服务端 Python 源码**都不用改**——glob 自动发现，`BindingSpecOut` 已有 `is_time_series: bool = False`（`schemas/module_type.py:98`）。
> ⚠ `module_types.json` 是**烤进 platform-server 镜像**的，改了要重建镜像。

重生成命令（`cwd` 必须是 `web/`）：

```bash
export NVM_DIR="$HOME/.nvm"; export PATH="$NVM_DIR/versions/node/v24.18.0/bin:$PATH"
cd /Users/heyufan/Documents/Projects/DigitalTwin/web
pnpm vitest run packages/modules/tests/catalog.contract.spec.ts -u
```

---

## 13. 分轮实施（一轮一个 PR）

| 轮 | 类型 | 范围 | 行数量级 | 规模豁免 |
|---|---|---|---|---|
| **R0** | `fix` | dataset 绑定过校验（platform-server） | ~30 | 不需要 |
| **R1** | `feat` | `chart-config.ts` 15 个工厂补 `span` | ~70 | 不需要 |
| **R2** | `feat` | **`pie-chart`**（试金石，不依赖序列链路） | ~2000 | ✅ 新模块豁免 |
| **R3** | `feat` | `shared/chart` 铺路：舞台缩放下的 dpr + `ariaSummary` | ~200 | 不需要 |
| **R4** | `feat` | 分桶取数口径进绑定（contracts + wire + 绑点面板） | ~280 | 不需要 |
| **R5** | `feat` | 序列槽的契约与求值注入（contracts + runtime/moduleValues） | ~340 | 不需要 |
| **R6** | `feat` | 序列取数驱动器（runtime：seriesSlots / useSeriesSlots / runtimeData / ModuleRenderer） | ~380 | 不需要 |
| **R7** | `feat` | 点位与台账序列的批量取数适配器（web/app 的 api 层） | ~390 | 不需要 |
| **R8** | `feat` | 应用壳接线（bootstrap + 两处装配点 + 节拍） | ~230 | 不需要 |
| **R9** | `chore` | 看屏角色补 `collect:view` / `dataset:view` 并重跑种子 | ~60（**未确认**：先查种子文件形状再定，可能只是配置） | 不需要 |
| **R10** | `feat` | `trend-chart` | ~4000 | ✅ |
| **R11** | `feat` | `bar-chart` | ~3700 | ✅ |
| **R12** | `feat` | `radar-chart` | ~2200 | ✅ |
| **R13** | `feat` | `calendar-heat` | ~2050 | ✅ |
| R14 | `feat` | `data-table`（待拍板，§15 Q4） | ~3000 | ✅ |

**为什么把 `pie-chart` 提到第三轮**：它纯 `opcua` 标量、不依赖序列链路，是验证「ChartShell 用法 + 图例式逐槽状态 + 六份花名册 + catalog 快照 + 规模豁免」整条落地流程最便宜的试金石。序列链路那五轮风险高，先用一块低风险的模块把流程走通。它只需要 R1（span）。

**为什么 R5–R8 不能合并**：`check_pr_policy.py:216` 只有三条出路——`[机械]` 标题、新代码单元首次落地、新模块目录首次落地。这四轮碰的是 `packages/contracts` / `packages/runtime` / `web/app`，一条都不沾。「在描述里逐字交代动机/验证/风险」是 `pr-policy.yml:75` 里**另一个作业**，跟规模闸无关，救不了。另有 `MAX_CHANGED_FILES` 一档同样生效。

### 13.1 每一轮的过闸命令

```bash
export NVM_DIR="$HOME/.nvm"; export PATH="$NVM_DIR/versions/node/v24.18.0/bin:$PATH"
cd /Users/heyufan/Documents/Projects/DigitalTwin

# 秒级（开发循环）
uv run --project server python scripts/gates/check_ts_style.py
uv run --project server python scripts/gates/check_comments.py
uv run --project server python scripts/gates/check_structure_web.py
uv run --project server python scripts/gates/check_web_deps.py

# 模块 PR 专有
cd web && pnpm vitest run packages/modules/tests/catalog.contract.spec.ts -u && cd ..

# 提交前
scripts/ci-local.sh --fast          # 已含 pnpm --dir web typecheck（-r）与 prettier/black

# --fast 漏掉、必须手补的三样
cd web && pnpm test:coverage && pnpm build && cd ..
#   ⚠ 逐文件阈值：packages/*/src/**/*.ts 各自要 ≥95 行 / ≥90 分支（vitest.config.ts:63），
#     diff-cover 替代不了它，报告里逐个文件看
uv run --project server python scripts/gates/check_lcov_paths.py web/coverage/lcov.info
uv run --project server python scripts/gates/check_coverage.py web web/coverage/lcov.info
uv run --project server diff-cover web/coverage/lcov.info --compare-branch origin/main --fail-under=85
uv run --project server python scripts/gates/check_bundle_budget.py

# 规模豁免自验（不在 --fast 里）
PR_TITLE='feat(dashboard): trend-chart 趋势曲线模块' \
  uv run --project server python scripts/gates/check_pr_policy.py origin/main HEAD

# 推送前
docker stop dt-ci-pg dt-ci-redis 2>/dev/null
scripts/ci-local.sh --all
```

### 13.2 验收标准

| 轮 | 验收 |
|---|---|
| R0 | 编辑器里给任一槽选「数据台账」并挑一列，保存返回 200；detail 留空返回 400 而不是 500 |
| R1 | `pnpm vitest run packages/modules/tests` 全绿，且新加的穷举断言在故意删掉一个 `span` 时会红 |
| R2 | `pie-chart` 出现在模块库；6 片先接 2 片时只画 2 片、分母只算这 2 片；负值整片剔除并在图例说明；换肤后图例与提示框颜色全跟着变；卸载页面后无 `ResizeObserver` 与 echarts 实例泄漏 |
| R3 | 1080 设计屏在 2x 缩放的舞台上，canvas 文字与 DOM 文字锐利度一致（无头 Chrome 截图比对）；`ariaSummary` 出现在宿主 `aria-label` 上 |
| R4 | 绑点面板上能给 archive 绑定选桶宽与聚合档；存进去再读回来两个字段不丢（wire 往返用例） |
| R5 | 14 个既有模块渲染零变化；「带 transform 的时序槽 points 与 value 同口径」用例绿；「points 缺席不写空数组」绿；`meta.slots` 里能读到 `isTruncated`；`catalog` 快照按新注释重生成 |
| R6 | 驱动器四条竞态用例绿（键变即 abort / 结果晚到不写 / 不依赖槽表故不自激 / 取不到落 error）；时序槽绑 opcua 落 error 而不是空图；`sourceLiterals` 绿 |
| R7 | 同表 3 列合并成一次 `:series`；同窗 8 个点位合并成一次 `:aggregate`；台账 code 解析失败诚实报错；`has_more` 为真时报错而非当没这张表；认不出的相对窗落 `invalid-query` |
| R8 | 手工给一个临时的时序 spec 用例断言注入链路通；`document.hidden` 时不发请求；编辑器不装节拍 |
| R9 | **用一个只有看屏权限的真账号**打开一张挂了 archive 与 dataset 绑定的屏，五格全部出数（不是 403） |
| R10 | 真库里三条 archive 绑定画出三条曲线；拔掉其中一条的点位后另外两条照画、图例上那条标「取不到」并置灰；1s 点位配 `1h` 窗时曲线画到**现在**而不是断在前 16 分钟；换肤后轴/图例/提示框颜色全跟着变 |
| R11 | 实时档 8 个点位摆成 8 根柱；历史档 3 条台账列按天堆叠；`percent` 档在某桶全缺时整桶留空而不是 0%；一行切成 `plot: line` + `axis: right` 后画在右轴 |
| R12 | 某根轴 `max ≤ min` 时该轴留空不画；轴少于 3 根走空态 |
| R13 | 跨零点的东八区样本落在正确的那一天（`timezone` 配 `Asia/Shanghai` 与留空两组用例）；一年窗被切成多段聚合后日历铺满而不是后半年空白；触顶时早期空白那一段有明确文案 |

### 13.3 合并纪律

- **分支与 PR 上不触发 `ci.yml`**，唯一的真运行器验证是合并后 main 上那一轮——**合并后盯一眼**，红了当场修或回滚。
- 并发组只留一个 pending run，连着合几个 PR 会让中间的提交 cancelled 且零作业，要跟着 runner 的节奏合。
- PR 正文必须逐字含 **`动机`**、**`验证`**、**`风险`** 三个词（`pr-policy.yml:75` 是 `grep -q`）。⚠ 它与规模闸是两个作业，写了不换来规模豁免。
- 提交标题 `^(feat|fix|refactor|perf|test|docs|build|chore)(\(范围\))?!?: 一句话`；分支名 `^(同类型)/[\w./-]+$`（`feature/x` 不合规）。

---

## 14. 坑清单（照着这张表逐条自查）

| # | 坑 | 症状 |
|---|---|---|
| 1 | 模块入口叫 `index.ts` 而不是 `manifest.ts` | 模块**从模块库消失且不报错**（BK 的图表模块全是 `index.ts`） |
| 2 | `defaultSize` 写成 BK 的 `{w,h,minW,minH}` | 初始尺寸变 `undefined`，TS 不报错 |
| 3 | `BindingSpec` 写 BK 的 `required`/`array`/`timeSeries` | 是多余可选属性，TS 不报错、面板永远不认 |
| 4 | 忘了写 `description` | `description.contract.spec.ts` 当场红；类型上可选，typecheck 放行 |
| 5 | 忘了声明 `contentKeys` | 别人套预设时把用户配好的系列名整片抹掉 |
| 6 | 组件 props 不是恰好 `config/meta/values` 三件套 | `manifests.contract.spec.ts:416-427` 当场红 |
| 7 | 顶层 option 键拼错（`visualmap` / `datazoom` / `gridd`） | typecheck **全绿**（TS 只查嵌套字面量，不查顶层多余键），运行时静默无效。只能靠单测断言 option 形状 |
| 8 | 用了未注册的 series/component（`graphic` / `markArea` / `dataset` / `toolbox` / `aria`） | 静默不渲染，零报错 |
| 9 | 紧凑控件缺 `span` | 默认铺满整行（R1 修的就是这个）；⚠ 闸门只查顶层 `configSchema`，不递归 `itemSchema` |
| 10 | `when.key` 指错键 | 那个字段**永远不出现**，typecheck 与 lint 双双放行 |
| 11 | `exactOptionalPropertyTypes` 下写 `when: undefined` | 是类型错，不是「没条件」。用 `chart-config.ts:30` 的 `whenOf()` |
| 12 | `array` 配置项删中间一行 | 其后每一行的绑定都改喂前一行 |
| 13 | 「留空 = 不判」的字段给了 `default: 0` | 「没填」与「真的是 0」再也分不开 |
| 14 | `readBoolean` 只认真正的 `true` | BK 的 `cfgBool` 口径不同，`showDot: 0` 开关方向会反 |
| 15 | `readText` vs `readTrimmedText` | 判「配了没有」必须用后者，一串空格在前者眼里是有值的，于是标题条画出来却是空的 |
| 16 | `:watch-values` 传解包后的值 | `ChartShell.vue:26` 收的是 `() => unknown`，是类型错；只有 `vue-tsc` 看得见 |
| 17 | 忘了 `:values-deep="false"` | 6 系列 × 数百点每次求值被 Vue 深遍历，零报错、只是发涩 |
| 18 | `v-for` 的键用索引 | `check_ts_style.py:52` 的 `INDEX_KEY` 直接红；用签名 + 出现序去重 |
| 19 | 模板里写 `x > 0` 或内联箭头函数 | `_template_depth` 的 `<[^>]+>` 提前结束标签、深度算错，误报「嵌套 7 层」 |
| 20 | 注释里写字面量 `<style>` | 被当成样式块开头，一路吞到真 `</style>`，模板里的色值全被判成硬编码 |
| 21 | 用例体里的正则字面量括号不配平 | `check_tests.py` 的括号配平器截断用例体，误报「测试必须有断言」 |
| 22 | 注释里写「原先/改造前/legacy」 | `check_comments.py` 的变更史词表整片红——跨仓迁移时这是最自然的写法 |
| 23 | 只跑 `pnpm --filter @dt/modules typecheck` | 比 `pnpm typecheck`（`-r`）窄，跨包类型错只在消费方那个包出现，曾害 main 红过一轮 |
| 24 | 在 `web/app/` 下手搓 `const mine = ++seq` | `check_ts_style.py:235-263` 强制改用 `useRacedFetch`（只扫 `app/`，`packages/` 里允许手搓） |
| 25 | `useSeriesSlots.ts` 写超 200 行 | `check_ts_style.py:27` + `:90-95` 对 `src` 下 `use*` 的 `.ts` 是整文件行数硬闸 |
| 26 | 本机 `act` 跑 `web-test` | 必 OOM（约 2GB 堆），伪装成 `Channel closed`；在未改动的 main 上同样复现。容器外 `pnpm exec vitest run` 全绿 |
| 27 | `scripts/ci-local.sh` 的 act 路径失败仍返回 `exit 0` | 判绿只能 `grep -E "🏁\|❌"` 看每个作业的 `Job succeeded` |
| 28 | 在 git worktree 里跑 act | `.git` 是指针文件，容器里 `git ls-files` 退 128，前置作业先红、后面全 skipped |
| 29 | 跑 act 期间改工作树 | act 绑本地目录，新写的文件会被当被测内容 |
| 30 | 服务目录下的 `.env` | 被 pydantic-settings 读进用例，本机红 CI 绿 |
| 31 | 中文串排序不钉 locale | CI 与开发机 locale 不同，`localeCompare` 本地绿 CI 红 |
| 32 | `cmd \| tail` 之后读 `$?` | 那是 tail 的退出码；zsh 要用 `${pipestatus[1]}`。曾因此把红闸门读成绿并推上 main |

---

## 15. 开放问题与已拍板的决策

### Q1 · 序列的刷新节拍怎么定？(甲) 应用壳给整屏一个统一 epoch（60s）+ 同 query 去重 + document.hidden 时停拍；(乙) 只在绑定签名变化时取一次，挂一天的大屏曲线停在打开那一刻；(丙) 每个模块自己出 refreshSec 并各起定时器。

甲=应用壳一个定时器 + 一处注入 + 一处清理（约 40 行，落在应用壳接线那一轮）；乙=零成本但曲线不动；丙=N 个模块 = N 条定时器，按观看者数放大。
⚠ 审查提出「甲与 datasources/src/dataset/provider.ts:5-11 的明令冲突」。核实原文：那段反对的是**在 provider 层伪造 subscribe 推送**（「台账列的实时化等发布器那条推送接通，不在这一层伪造」），而不是反对显式的整屏历史重取——甲不注册 subscribe、不冒充推送。但它点名的那条放大逻辑（十个人看同一张屏 = 十条轮询）对甲同样成立，所以这条不是伪问题，是要用「同 query 去重 + 隐藏页停拍 + 批量合并」把放大压下去。

**结论**：选甲，并把三条约束写死进实现：① 同一个 detailJson 原文的多个槽共用一次取数（批量合并层已经做到）；② document.hidden 时停拍、可见时立刻补一拍；③ 周期先写死 60s 常量，二期再接平台运行参数。选乙会让 trend-chart 交付即被判「曲线不动」；选丙会多出 5 处定时器与 5 组清理用例，且正撞 provider.ts 那段注释。

### Q2 · 公开大屏（匿名令牌页）要不要能画历史？

不做=trend-chart / calendar-heat / bar-chart 历史档在公开屏上永久显示「公开屏不提供历史数据」；做=需要一条新的后端工作流：public-dashboards 前缀下的历史读代理端点（权限跟着公开令牌走）+ auth 目录里新增匿名规则 + 边缘免认证 location + 限流，且要重新审「匿名可读多久的历史」。
事实：PublicDashboard/index.vue:74-76 明令不装 history provider；auth-server rules_platform.py 的 _PUBLIC_RULES 只有 public-dashboards/* 一条，注释写着它是整个 platform 唯一的匿名可达前缀；point-histories* 与 dataset-tables* 都按 collect:view / dataset:view 收着。

**结论**：本轮不做，且**应用壳接线那一轮不碰 PublicDashboard**。在三个时序模块的空态里给一句专门的文案（不是通用「暂无数据」），并把它写进各自的 MODULE_*.md。公开屏历史另开一个独立议题，先决定匿名能读多久、限不限流，再动代码。

### Q3 · 看屏账号的授权怎么补？只有 dashboard:view 的账号打开一张挂了 5 块图表的屏，每一格都是 403。

甲=给「看屏」角色补 collect:view + dataset:view 并重跑种子（改的是角色的码集合，不改路由规则）；乙=在大屏面做一条 /dashboards/{id}/series 代理读端点，权限跟着大屏走（顺带把公开屏那条也解决），但那是一整轮后端工作；丙=不管，让部署时手工加码。
事实：rules_platform.py:176-181 point-histories* GET → collect:view；:281 dataset-tables* GET → dataset:view；dataset_series.py:59 ViewDep = require(DATASET_VIEW)。仓内既有经验是「加功能必重跑种子否则新端点全 403」。

**结论**：一期选甲，单独一轮 PR，且验收必须是「用一个只有看屏权限的真账号打开一张挂了 archive 与 dataset 绑定的屏，五格全部出数」。乙留作二期——它同时解决公开屏那条，但会把取数从 provider 分派改成大屏代理，属于架构级改动，不该塞进本次。丙不可接受：那正是「本机绿、部署红」的老坑。

### Q4 · 要不要顺带做 data-table（列头 + N 行 × M 列的表格模块）？

做=多一轮 PR（约 3000 行，12 个固定子槽的行数组槽 + 列格式），不依赖序列链路，可以紧跟 pie-chart；不做=「12 台逆变器 × 5 列」这类矩阵只能用 info-list 凑，凑出来没有列头也没有列对齐。

**结论**：建议做，排在五个图表模块之后。它是本次盘点里唯一一个「不需要任何铺路就能落、且现有 14 个模块真凑不出来」的缺口。若人力紧张就明确写进模块文档的「一期不做」清单，而不是留白。

### Q5 · 散点/气泡还做不做？原方案给的否决理由（「本仓没有配对取数接口」）经核实不成立。

事实：POST /point-histories:aggregate 一次收最多 50 个点位（MAX_NODE_KEYS=50），所有点位共用同一套 interval、按 bucket_start 天然对齐（CollectHistoryBucket 有 node_key + bucket_start），这就是配对取数。

**结论**：理由改成「优先级不够」而不是「做不了」，本轮仍不做。真要做时它是最便宜的一块：ScatterChart 与 EffectScatterChart 都已注册，取数直接复用 bar-chart 历史档那一条批量聚合路径。

### Q6 · bar-chart 的取数窗口与聚合档位放在哪：绑定的 detailJson，还是模块 config？

甲=放绑定 detailJson（本方案选的），要给 ArchiveBindingDetail 加 interval/aggregate 两个可选字段，并改 dashboardWire.ts 的 toHistoryRange/fromHistoryRange 与 BindingSourceEditor.vue 的表单；乙=放模块 config，但驱动器只拿得到 binding + BindingSpec，拿不到模块实例的 config，实现要把整个 config 也透进驱动器。
事实：detail_json 在后端是自由 JSONB（schemas/binding.py:28 `dict[str, Any] | None`），加字段不动后端；但前端 wire 是逐字段显式映射的，不改 dashboardWire 的话新字段会被静默丢掉。

**结论**：选甲。窗口本来就住在绑定上（BindingSourceEditor.vue:65/101/123），聚合档位是「怎么读这条绑定」的一部分，与窗口同住才自洽。⚠ 档位不是装饰：contracts/src/collect.ts:268-271 明写「温度看 avg、电量看 max，拿平均去读一条累积曲线会画出一条压扁了的假线，而数值本身完全合法」——不给用户选档就等于给累积量默认画错。
