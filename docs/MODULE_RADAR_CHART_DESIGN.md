# 多维雷达 `radar-chart` —— 架构设计

> 关联：[`DASHBOARD_CHART_MODULES_DESIGN.md`](DASHBOARD_CHART_MODULES_DESIGN.md) §2 / §3 / §6 / §8 / §10 / §11 / §12、
> [`MODULE_PIE_CHART_DESIGN.md`](MODULE_PIE_CHART_DESIGN.md)（本族第一块图表模块，本模块照它抄）、
> [`DASHBOARD_DESIGN.md`](DASHBOARD_DESIGN.md) §4–§7。

把一组**量纲不同**的指标（能效、达标率、设备健康度、绿色工厂评价）按**逐轴量程**
归一后连成一个封闭形状，做本组与对比组的横向比较。本仓没有这个几何。

---

## 0. 它与现有模块的关系

| | 已有的画法 | 本模块 |
|---|---|---|
| 几个量各占多少 | `pie-chart` 的扇形面积 | 不重复做 |
| 几个数各是多少 | `info-card` / `data-card` | 不重复做 |
| 离满还有多远 | `gauge-card` 的五档几何 | 不重复做 |
| 逐行比高低 | `info-list` 的进度件 | 留给后续的 `bar-chart` |
| **多个量纲不同的维度合成一个形状** | 没有 | ✅ 这一块 |

一行基建都不改，只出「取值 + option + 清单」三样。

---

## 1. 数据接入：一个数组槽，行钉在指标上，行内两个子槽

```
bindings: [{ key: 'axisValues', dataType: 'number',
             isArray: true, isEntityPinned: true,
             arrayFields: [{ key: 'value',   label: '本组' },
                           { key: 'compare', label: '对比组' }] }]
bindingRowCounts:  { axisValues: config.indicators.length }
bindingRowLabels:  { 'axisValues[i].value': { title: 轴名, id: 轴名 } }
```

- 轴名、**量程**、单位、小数位都是配置，必须有一份 config 侧的数组——这正是实体钉行的定义。
- 「配了 6 根先接 3 根」「对比组整条留空」都是常态。实体钉行允许中间留空。
- `bindingRowLabels` 的键是这一行**第一个**子槽的 `fieldKey`（`ModuleManifest` 的口径），
  对比组那个子槽跟着同一行走，不另起一条。

⚠ **一个子槽都不给 `isRequired`**：给了会让整块被判 `unbound` 并盖上状态浮层，
下面那套逐轴四档就整片白画。

### 1.1 逐轴量程为什么必须是静态配置

雷达的每根轴各有各的量纲（分、%、kWh、℃）。没有逐轴量程就只能拿所有轴的读数一起归一，
那时「能效 85 分」和「温度 85 ℃」会画成同样长的一根——形状不再有任何意义。
所以 `min` / `max` 是**逐轴的静态配置**，写在 `radar.indicator` 上，由 echarts 逐轴归一。

⚠ **本组与对比组共用这一套量程**（§4）。

---

## 2. ⚠ 这一族最硬的那条事实：雷达画不出「空着的一维」

设计文档 §8.1 给折线 / 柱 / 雷达族的写法是「非 ok 的槽 → series 照常进 option、
`data` 给空数组」。那条对**整条系列**成立，但本模块的逐槽状态落在**轴**上，
于是要问的是「一根轴取不到时，那一维怎么留空」。

**实测（真 echarts 6.1.0 + SSR）：`null` / `NaN` / `'-'` / `undefined` 四种写法出的
SVG 路径，与直接喂 `0` 的那一份逐字节相同——都落在圆心上。**

```
[90, null, 90, 90] → M250 110L250 200L250 290L340 200L250 110
[90, 0,    90, 90] → M250 110L250 200L250 290L340 200L250 110   （同一条）
[90, 90,   90, 90] → M250 110L160 200L250 290L340 200L250 110
```

圆心就是这根轴的 `min`。所以「喂个空值把那一维留空」这条路**在 echarts 上不存在**：
喂什么都是在图上画一个**真实的凹陷**，而看图的人会把它读成「这个指标很差」，
读不出那是「量程配错了 / 点位断了」。这正是需求里那句「伪造的 0 在雷达上是一个真实的凹陷」。

### 2.1 于是：画不出来的那根轴**整根不进轮子**

```
可归一（max > min）且本组有读数  → 进 radar.indicator，形状上有这个顶点
其余任何一种                     → 整根轴不进 indicator，改在图例上占一条
```

形状因此**少一个顶点**（五边形变四边形），而不是多一个塌到圆心的假凹陷。
这是唯一一种不撒谎的画法。

### 2.2 那这根轴还怎么「能看出来」

需求原文是「indicator 名字上加后缀 + 该维不参与形状」。**这两件事在 echarts 上互斥**：
只要这根轴还在 `indicator` 里，两条 series 就都被迫在它上面有一个顶点。
留在轮子上就必然伪造，剔出去才诚实。

剔出去之后，可用的承载面只剩图例。而图例只认**一条**认领路径：
名字等于某条 series 的 `name`（实测：图例 `data` 里放一个不对应任何 series 的名字，
那一条**根本不会被创建**；雷达族的数据项名不参与认领，这一点与饼族相反）。

**所以每根被剔掉的轴，都以一条 `data: []` 的空 series 进 option**，
名字是「轴名（原因）」，图元与文字都取 `theme.textMuted` 置灰。
这与 §8.1 给本族的机制是同一条——「series 照常进 option、`data` 给空数组，
名字由 series 自己带着」——只是这里占位的是一根轴而不是一条系列。

图例因此是这样一份混合清单：

```
■ 本组                    （实色，有形状）
■ 对比组（取不到）         （灰，空 series）
■ 达标率（量程配错）        （灰，空 series）
■ 清洁度（等首帧）          （灰，空 series）
```

⚠ **图例一律 `selectedMode: false`**：一半条目背后是没有数据的空 series，点了什么都不会
发生。一半能点一半点不动，比整条都点不动更难解释。这里的图例是状态板，不是开关。

### 2.3 五档原因各说各的

| 判据 | 图例后缀 |
|---|---|
| 量程没填出一个有限数 | `量程未配` |
| `max ≤ min` | `量程配错` |
| `pending`（配了没首帧） | `等首帧` |
| `error`（取不到） | `取不到` |
| `ok` 但不是有限数 | `无读数` |
| 本组子槽没配来源 | **整根轴不进输出**，图例也不列它 |

⚠ **量程比状态先判**：量程是配置错、自己不会好；「等首帧」再等一会儿就有了。
两件事同时成立时报量程，看的人才知道该去改哪里。

⚠ 「没配来源」与「配了取不到」分开：一块摆了 8 个指标的雷达，图例上挂着 5 条从没接过
点位的空名字，比少画它们更难看懂。

---

## 3. 轴少于三根：直接走空态

两根轴的雷达是一条线段、一根是一个点（实测两根轴时 echarts 画出的就是一条竖线）。
几何还在，但「多维形状」这件事已经没有了，而看图的人会把那条线读成一条趋势线。

所以画得出来的轴 **< 3** 时：

- `ChartShell` 出空态浮层；
- **option 里连 `radar` 带 `series` 一起不写**。空态文案是透明的一层字，
  底下压着一条线段两边都读不清。

空态文案分三档，各说各的：

| 情形 | 文案 |
|---|---|
| 一根轴都没绑来源 | 用户配的 `emptyText`，清空则回落「暂无数据」 |
| 绑了，但指标本来就配得少于三个 | `可画的维度不足 3 根，雷达退化成线段` |
| 绑了，有轴画不出来 | 上面那句 + `：能效（量程配错）；清洁度（取不到）` |

第三档把原因逐根挂在后面——图什么都不画的时候，这一句是唯一能说清「该修哪一根」的地方。

---

## 4. 本组与对比组：整条画，或整条不画

量程写在 `indicator` 上、两组共用，所以两组的读数**原值直接进 series**，
由 echarts 逐轴归一。两组各归一各的话，同一个长度在两组里代表不同的数，形状之间没法比。

对比组的画不画由整条决定：

| 情形 | 画法 |
|---|---|
| 每根画出来的轴上，对比子槽都没绑 | 整条**不进 option**，图例也不列 |
| 有一根画出来的轴缺对比读数 | series 进 option、`data: []`，图例名加后缀 |
| 每根画出来的轴上都有对比读数 | 正常画 |

⚠ **缺一根就整条不画**，理由同 §2：多边形跳不过一个顶点，补一个数就是凭空造一个凹陷。

原因取最该先看的那一条：`取不到` > `等首帧` > `缺读数`。前两条是现场的事，最后一条是还没绑完。

⚠ 被剔出轮子的那根轴上的对比读数**不参与判定**：那根轴本来就不画。

### 4.1 轴与读数在构造处就配好对

`AxisReading = { axis, value }`。对比组的读数不是一个「与 `drawnAxes` 等长的数组」，
而是一串已经配好对的 `{轴, 值}`。换成两个等长数组按下标配对的话，一旦哪一头少一项，
读数就会整体错位到相邻那根轴上，**而两边都不报错**。类型上配好对，这一类错就没有了。

---

## 5. 超出量程：几何夹，文案不夹

⚠ **echarts 不会把超出量程的读数夹回去**（实测 `[0,100]` 的轴上喂 200，顶点画在最外圈
之外、压在轴名上）。所以取值层照原样留着读数，渲染层在**画之前**把它夹进 `[min, max]`。

⚠ **夹的是几何不是数**：顶点标签与提示框照说原值（`200分`），否则「超了多少」这条信息
就丢了。`GroupReading` 因此同时带 `value`（原值）与 `plotted`（夹过的坐标）。

---

## 6. 配置面

分段名只用 `chart-config.ts` 的 `GROUP` 八个，不另造字符串。

| 分段 | 键 |
|---|---|
| 数据 | `title`（工厂） · `indicators`（array，行内 `name` / `min` / `max` / `unit` / `precision`） · `seriesName` · `compareName` · `emptyText` |
| 样式 | `chartStyle`（工厂，描边 / 填充） · `shape`（多边形 / 圆形） · `splitCount` · `areaOpacity` · `palette`（工厂） · `unit` / `precision`（工厂） |
| 图例 / 提示框 / 数据标签 / 动画 | 四个工厂各自产出 |

- **不 spread `cartesianAxisFields()`**：雷达没有直角坐标轴，摆出「X 轴名称」是纯噪声。
- `contentKeys: ['title', 'indicators', 'emptyText', 'seriesName', 'compareName']`。
  不声明的话这几个内容键会被 `styleKeysOf()` 当成观感键，别人套预设时把用户配好的指标整片抹掉。
- `indicators` **出厂给满三项**（各带 `0–100` 的量程）：只给一项时新拖出来的一块必然是
  空态，看着像模块坏了。
- 逐轴 `min` / `max` 是 `type: 'number'` 而不是 `'range'`：量纲不同的指标量程差着几个
  数量级，滑杆表达不了。
- 逐轴 `precision` **刻意没有 `default`**：留空 = 跟随整块。同样必须是 `number`——
  滑杆没有空态，没配时面板显示 0 而渲染按整块那一档走，两边对不上。
- `areaOpacity` 挂 `when: { key: 'chartStyle', in: ['area'] }`；上限刻意留在 **80**，
  填满会让后画的那一组把先画的整个盖掉。
- `showLegend` 缺省 `true`（§2.2 唯一的承载面）；`showValueLabel` 缺省 `false`
  ——两组 × 六根轴就是十二个数糊在轮子上。
- `splitArea` 一律关掉：隔行底色会把两个半透明的形状搅成四五种深浅，谁压着谁看不出来。

---

## 7. 颜色与两处相反的转义口径

- 色板只走 `theme.ts` 的 `SERIES_VARS` 六个 token，本组取第 0 色、对比组取第 1 色；
  用户覆盖走 `paletteOverrideField()`。
  ⚠ BK 那套 `--chart-series-1..5` / `--chart-cold` / `--chart-hot` 在本仓**全部不存在**。
- ⚠ 绝不写 `color: ''`：echarts 会把空串当成一种颜色画出**透明**的图元。取不到就用
  `withColor()` 省掉该键。
- 网格分隔线经 `withAlpha()` 淡化：轮子是背景，不该压过两个形状。
- **提示框**的函数 formatter 返回值被 echarts 原样 `innerHTML`，拼进去的轴名与单位全是
  编辑器里的自由输入，必须逐段 `escapeHtml()`；反过来**顶点标签**走 canvas，不解析
  HTML 实体，转义了只会把 `&` 显示成字面量 `&amp;`。两条各有一个用例钉住。

---

## 8. ⚠ 顶点标签只挂在图元上

实测：`symbol: 'none'` 时 series 的 `label.formatter` **一次都不会被调用**，
十个数一个都画不出来，且零报错。所以本族**恒画顶点符号**（`symbol: 'circle'`）。

标签的 `params` 里只有 `dimensionIndex` 可靠——`params.value` 是**夹过的**坐标（§5），
说真话要回查这一组自己的原值。故 formatter 是**逐 series 各一份**的闭包，
捕获这一条自己的 `readings`，只用 `dimensionIndex` 取。

---

## 9. 刷新口径：`partialMerge` 必须带 `radar`

轮子上有几根轴是由**实时值**决定的（某根轴取不到就少一根）。只换 `series` 的话，
轴停在上一帧而形状跟着变，两边当场对不上且零报错。

`PARTIAL_MERGE = ['series', 'legend', 'radar']`。

实测 `replaceMerge: ['series','legend','radar']` 确实能让 indicator 列表缩短
（四根轴的图换成三根后，第四根的轴名从 SVG 里消失），也能在整个 `radar` 键不写时
把轮子摘干净。

---

## 10. 交互

`hostClickable: true` 与 `emitsInteractions: true` **都开**：雷达没有 `dataZoom` 滑块，
也没有拖拽手势，两者不打架。

上抛的是**这一组配置里写的称呼**（`seriesName` / `compareName`），按 `params.seriesIndex`
回查，与 `buildGroups` 的顺序逐位对齐（有一条用例把两处顺序钉在一起）。

⚠ **不上抛轴名**：雷达的图元点击落在整条折线上，`params` 里没有可靠的维度下标，
猜一根轴出来会让配好的联动规则接到另一根轴上。

⚠ 被剔掉的那几根轴对应的空 series 排在两组之后，下标越界即空串——它们不是一组数据，
点了不上抛。

⚠ 两组的称呼**不许留空**：图例名同时是这条 series 的 `name`，空串在 echarts 那边认领不到
任何图例项。清空时回落到出厂称呼。

---

## 11. 目录与文件

```
web/packages/modules/src/modules/radar-chart/
├── manifest.ts       唯一 export default；含 description 与 contentKeys
├── Component.vue     套 ChartShell；只做「读 config/values → build 闭包」
├── option.ts         ChartBuild 实现：(theme, resolve) => ECOption
├── axes.ts           取值层：config + values + meta.slots → AxisView[]，含空态口径
├── options.ts        枚举取值表（as const satisfies readonly ConfigOption[]）
└── presets.ts        四套整套观感
```

⚠ 入口文件必须叫 `manifest.ts`：叫 `index.ts` 的模块**从模块库消失且不报错**。
⚠ `manifest.ts` 里绝不静态 import `Component.vue` / `option.ts`（注册用的 glob 是 `eager: true`）。
⚠ 绑定槽键要在 `Component.vue` 里**字面读一遍**（`props.values[AXIS_SLOT_KEY]`）。
⚠ **取值层里任何 `x.values` 都会被当成读了一个绑定槽**：「绑定槽键两侧逐一对上」那条闸
认的是 `config|values` 前面允许一跳前缀的形状，于是 `compare.values.map(...)` 会被读成
「读了 `values.map`」、`compare.values[i]` 会被读成「读了一个没登记的键常量 `i`」，
两条一起把那道闸打红。本模块的对比组读数因此叫 `readings` 而不是 `values`。

---

## 12. 落地要改的六份花名册

| # | 路径 | 改什么 |
|---|---|---|
| 1 | `web/packages/modules/tests/manifests.contract.spec.ts` | 目录数组加 `'radar-chart'`（字典序）；`AXIS_ITEMS_KEY` / `AXIS_SLOT_KEY` 登进 `KEY_CONSTANTS` |
| 2 | `web/packages/modules/tests/registerBuiltins.test.ts` | `BUILTIN_TYPES` 加一项 |
| 3 | `server/…/apps/dashboard/module_types.json` | **`-u` 重新生成**，不是手改 |
| 4 | `server/…/tests/contract/test_dashboard_module_catalog.py` | `EXPECTED_TYPES` 加一项 |
| 5 | `server/…/tests/unit/test_dashboard_module_catalog.py` | `known_types()` 断言加一项 |
| 6 | `server/…/tests/integration/test_dashboard_module_types_api.py` | 断言集合加一项 |

⚠ #4 与 #5 同名不同目录，只改一份的表现是另一份当场红。
⚠ `module_types.json` 是**烤进 platform-server 镜像**的，改了要重建镜像。
⚠ 类型 id 叫 `radar-chart` 而不是 `radar`：「零模块类型字面量」那条闸按已注册的 type
逐个 grep 源码，短词会红在一堆与模块毫不相干的属性上。

### 12.1 图标是一处有意的妥协

本仓的 `DtIcon` 注册表里**没有雷达图标**，本模块借用 `chart-mixed`。
加一个图标要改 `packages/ui/src/components/DtIcon/registry.ts`，那**不在新模块 PR 的
豁免集合内**（`check_pr_policy.py` 的路径集合），一个文件落在集合外就整体不豁免、
整个 PR 掉回 400 行硬闸。为一个图标另开一个铺路 PR 不值。

---

## 13. 测试

| 文件 | 守什么 |
|---|---|
| `axes.test.ts` | 逐轴四档、量程两档、对比组整条画或整条不画、三句空态、行标题与行数 |
| `option.test.ts` | option 的形状：indicator 里有谁、图例与 series 名一一对上、夹取、转义 |
| `ssr.test.ts` | **拿真 echarts 跑 SSR**，断言那几行字与那几个形状真的画得出来 |
| `Component.spec.ts` | 整块渲染、三句空态、`replaceMerge` 三个键、点击上抛、卸载释放 |
| `manifest.test.ts` | 清单声明 |
| `presets.test.ts` | 四套预设的数据面 |

⚠ **组件用例把 echarts 整包打了桩**，断言的是 option 对象的形状。
「这份合法的 option 交给真 echarts 之后画不出来」这一类缺陷它一条都抓不到——
`ssr.test.ts` 就是为这一类存在的：`renderer: 'svg'` + `ssr: true` + `renderToSVGString()`，
断言画不出来的那几根轴的名字与原因**真的出现在 SVG 里**。

⚠ 那条用例里认形状的方法是 `<polyline>` 上 echarts 自己打的 `ecmeta_ssr_type="chart"`：
网格、轴线与图元符号都是 `<path>`，按 `d` 去筛会把网格一起筛进来，而**轴数一变筛法就失准**。

⚠ 它自己 `use()` 了一套 `SVGRenderer`：`shared/chart/echarts.ts` 只注册了 CanvasRenderer
（canvas 在 happy-dom 里画不出可断言的东西）。注册是全局一次性的，多注册一个渲染器不影响
那份 `REGISTERED` 清单，`echarts.ts` 与它的用例一行都不用改。

---

## 14. 一期不做的

| 不做 | 理由 |
|---|---|
| 三组以上 | 三个半透明形状叠起来谁也读不清；真要比三组，两块雷达并排更清楚 |
| 逐轴不同的极性（越小越好） | 需要在量程之外再加一个「反向」开关，而反向后的形状与原值的对应关系要另讲一遍 |
| 轴的排序 / 拖拽调序 | 轴序就是 `indicators` 的文档序，调序在配置里做；模块内另造一套会与绑定行号打架 |
| 点某根轴下钻 | echarts 的雷达图元点击给不出可靠的维度下标（§10） |
| 历史序列（形状随时间变） | 要整条序列取数链路；雷达本身也不适合表达时间 |
