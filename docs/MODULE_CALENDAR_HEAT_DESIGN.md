# 日历热力 `calendar-heat` —— 架构设计

> 关联：[`DASHBOARD_CHART_MODULES_DESIGN.md`](DASHBOARD_CHART_MODULES_DESIGN.md) §3 / §6 / §8 / §10 / §11 / §12、
> [`MODULE_PIE_CHART_DESIGN.md`](MODULE_PIE_CHART_DESIGN.md)（本族第一块图表模块，写法蓝本）、
> [`DASHBOARD_DESIGN.md`](DASHBOARD_DESIGN.md) §4–§7、[`DATASET_DESIGN.md`](DATASET_DESIGN.md) §16。

把一条历史序列按天折成一格，铺成日历或月 × 日矩阵，回答「哪几天异常、哪几天停机」。
每日能耗、每日达标率、每日产量这类**以天为粒度的长周期观察**归它。

---

## 0. 三句话说清它与已有模块的关系

| | 已有的画法 | 本模块 |
|---|---|---|
| 一天之内怎么走 | 留给 `trend-chart` 的时间轴 | 不重复做 |
| 十几项之间比高低 | 留给 `bar-chart` 的共享值轴 | 不重复做 |
| 一年 365 天里哪几天不对 | 没有：`info-list` 的行结构摆不下 365 行，也没有色阶映射 | ✅ 这一块 |

⚠ **一行基建都不改**：`shared/chart/`（`chartKit` / `chart-config` / `theme` /
`echarts` / `useEChart` / `ChartShell`）与序列取数链路（`isTimeSeries` → `seriesSlots`
→ 行内 `seriesPoints`）都已就位，本模块只出「取值 + option + 清单」三样。
`HeatmapChart` / `CalendarComponent` / `VisualMapComponent` / `GridComponent` /
`TitleComponent` **全部已在 `echarts.ts` 的 `use()` 清单里**，零新增注册项。

---

## 1. 数据接入：一个时序数组槽，行钉在配置上

```
bindings: [{ key: 'dayValues', dataType: 'number',
             isArray: true, isEntityPinned: true,
             arrayFields: [{ key: 'series', dataType: 'number',
                             isTimeSeries: true }] }]
bindingRowCounts:  { dayValues: config.metrics.length }
bindingRowLabels:  { 'dayValues[i].series': { title: 指标名, id: 指标名 } }
```

**一行 = 一张日历。** 三条不能少的理由与 `pie-chart` 同源：名称 / 单位 / 小数位 /
逐日归并档**都是配置**（实体钉行的定义）；「配了 4 张先接 1 张」是常态（列表式在
服务端被强制「索引连续且从 0 起」，第 2 条绑定直接存不下去）；`bindingRowLabels`
让绑点面板显示指标名而不是「第 3 行」。

⚠ **一个子槽都不给 `isRequired`**：给了会让整块被判 `unbound` 并盖上状态浮层，
下面那套逐张状态就整片白画。

⚠ **`isTimeSeries: true` 是这一块与 `pie-chart` 的唯一结构性差别**：漏了它，求值层
根本不会去拉历史序列，行内也就没有 `seriesPoints`——屏上只是一张空日历，零报错。

### 1.1 序列落在行内的伴生键上

求值层把 `dayValues[i].series` 的历史点写到**同一行**的 `dayValues[i].seriesPoints`
（`moduleValues.ts` 的 `pointsFieldKeyOf`）。模块**不声明**这个键，也不拿它去问状态：
逐张状态一律按**清单声明的子槽**（`dayValues[i].series`）遍历。

⚠ 设计态（模块库缩略图）走 `previewBindings` 那条路，它按行对象的**每个键**摊成一条
static 绑定，于是 `meta.slots` 里会多出一个模块自己不认识的 `dayValues[0].seriesPoints`。
按 `slots` 的键遍历就会凭空多画一张日历。

### 1.2 没有「时间范围」这一项

取数窗口（`lastWindow` / `fromMs` / `toMs`）住在**每条绑定**的 `detailJson.range` 上，
由绑点面板写入，模块既读不到也改不了。所以：

- 清单里没有 `rangeMonths`、没有 `lastWindow`；
- 日历跨度只能**按取回的点算**：`spanOf()` 取各张已取回日子的并集；
- 同一块里两张日历的窗口可以不同——这是既有形状，模块必须容忍。

一年的日历靠在绑定上写 `365d`（相对窗正则允许四位数）。

---

## 2. 时区：这一块最容易错且最不响的一处

**日界必须按 `config.timezone` 给的 IANA 串算，留空即浏览器本地。**

```
dayFormatterOf(zone) → Intl.DateTimeFormat('en-US', zone === '' ? 三段 : { …三段, timeZone: zone })
dayKeyOf(formatter, t) → formatToParts → `YYYY-MM-DD`
```

三条纪律：

1. ⚠ **绝不写死 +8。** 同一批读数在不同时区里落在不同的日子上；写死之后换个部署
   整块**错一天且零报错**。web 侧 grep 不到任何时区常量，没有任何东西会替你拦这一条。
2. ⚠ **locale 钉死 `'en-US'`。** 日期串只当键用、不给人看；不钉的话开发机与 CI 的
   runner 各按各的 locale 排月与日，键当场对不上（CI 的 runner 是中文 locale）。
3. ⚠ **认不出的时区不静默回落本地。** `new Intl.DateTimeFormat(..., { timeZone })`
   对认不出的串抛 `RangeError`；catch 之后**按本地折日**看着「能用」，其实每一格都
   可能错一天——那与写死 +8 是同一种错法。本模块的做法是**整块画不出来**，
   并把那个串原样写进空态：`时区「Mars/Olympus」认不出来，日界算不了`。

用例上「`timezone` 配 `Asia/Shanghai`」与「留空」各有一组：`2026-03-05 16:30 UTC`
在东八区是 **03-06**、在 UTC 与纽约是 **03-05**；留空那一组拿测试里另起的一份 Intl
反算本地日期做交叉核对，因此它证明的是「跟着环境走」，不是「等于某个写死的档」。

---

## 3. 一天之内那几百个采样怎么并成一个数

逐张可配 `dayAggregate`：`sum` / `avg` / `max` / `min` / `last`，缺省 `sum`。

⚠ **档位不是装饰**：电量这类累积量要 `sum` 或 `max`，温度这类瞬时量要 `avg`——
拿平均去读一条累积曲线会画出一张整体偏低的假图，而**每一个数本身完全合法**。

⚠ **极值走 `reduce` 而不是把一天的读数摊成实参**：1 秒周期的点位一天有八万多个
采样，`Math.max(...values)` 会直接把调用栈撑爆，而爆的地方跟日历一点关系都没有。

⚠ **非数值的读数整点丢掉，不当成 0**：日历上「0」是真读数、有颜色，「那天没采到」
是空格——混起来就再也分不出停机与归零。

⚠ **形参不许叫 `values`**：「绑定槽键两侧逐一对上」那条闸按 `values.<键>` 的形状扫
模块目录源码，于是 `values.length` 与 `values.reduce` 会被判成两个模块自己都不知道的
绑定槽。这一条本轮实测踩到过一次。

---

## 4. 逐张状态：日历族画在**标题**上（§8 的对应位置）

开 `ownsStatusDisplay: true`。日历族**没有图例可挂**——热力图的图例是色标
（`visualMap`），它说的是数值区间，不是数据源状态；`graphic` 组件没有注册
（写了静默不渲染）；模块标题条走 `ModulePanel`。于是承载面只剩已注册的
`TitleComponent`：**一块日历配一条标题，逐张各一条。**

| 档 | 画法 |
|---|---|
| 没配来源（`slots` 里没这个键） | 该张**整块不进 option**，标题也不列它 |
| `pending` | 日历框**照建**、格子给空数组；标题 = `名称 · 单位（等首帧）`，文字取 `theme.textMuted` |
| `error` | 同上，后缀「取不到」 |
| `ok` 但窗内 0 天 | 同上，后缀「窗内一天都没有」 |
| `ok` 且 `isTruncated` | 正常画 + 后缀「只到 X 至 Y，此外的日期没取回」（§5） |
| `ok` | 标题 = `名称 · 单位`，文字取 `theme.text` |
| 一张都画不出来 | 交给 `ChartShell` 的 `isEmpty` + 一句逐张列原因的文案 |

**为什么框照建、而不是整张撤掉**：日历的价值有一半在「哪几天**没有**」。把坏掉的
那张撤走，屏上「这块指标坏了」与「这块指标没配」是同一片空白；框留着 + 标题置灰，
看的人一眼知道位置在、数据没有。这也是为什么非 `ok` 的那几张仍以
`series.data: []` 进 option——`calendarIndex` 与 `series` 的序号必须一一对应。

⚠ **这一条组件用例抓不到。** 组件用例把 echarts 整包打了桩、断言的是 option 的
形状，而这里错的是「这份合法的 option 交给真 echarts 之后画不出来」。故有一条
`ssr.spec.ts` 拿**真** echarts 跑 SSR（`renderer: 'svg'`、`ssr: true`、
`renderToSVGString()`），断言那两张非 `ok` 的名字**真的出现在 SVG 里**、日历底格
真的画了（`<path>` 计数 > 100）、而第三张从「等首帧」变成有读数后图元数真的变多。
实测：把 `title` 砍成只留第一条，这条用例当场红，而全部 option 形状断言仍然全绿。

⚠ `unbound` 与 `stale` 两档仍归整格浮层（`moduleStatus.ts` 的 `showsStatusOverlay`），
不是本模块能决定的。序列槽一律不写 `timestampMs`，所以历史数据不会因为 WS 抖一下
被标成陈旧。

### 4.1 空态那三句各说各的

| 情形 | 文案 |
|---|---|
| 时区认不出 | `时区「…」认不出来，日界算不了` |
| 一张都没配来源 | `config.emptyText`，清空则回落「暂无数据」 |
| 配了却一天都没取到 | `一天的读数都没取到：能耗（取不到）、产量（等首帧）` |

合成一句「暂无数据」的代价是：看的人不知道该去改配置、去配绑定，还是再等一会儿。

---

## 5. 触顶：说清取回的是**哪一段**

台账 `:series` 一次最多回 `MAX_SERIES_ROWS = 20000` 行且留的是**最新**那批。
10 秒周期的表一年窗只够 **2.3 天**（20000 × 10s ≈ 55.6 小时）；按可用跨度换算：

| 采样周期 | 20000 行覆盖的跨度 |
|---|---|
| 10 s | ≈ 2.3 天 |
| 1 min | ≈ 13.9 天 |
| 5 min | ≈ 69 天 |
| 15 min | ≈ 208 天 |
| 1 h | ≈ 2.3 年 |

**所以一年窗的日历必须配分钟级以上的源，或走点位归档的分桶聚合。** 点位侧
`:aggregate` 的桶数上限是 `MAX_PAGE_SIZE(200) × 点位数`，单点位一年 365 个日桶同样
会触顶，取数适配器把长窗切成 ≤190 天的多段再拼。

⚠ **早期那一段空白与「那几天真停机」在日历上长得一模一样**，所以 `isTruncated` 不能
写一句通用的「数据被截断」。本模块的文案是**取回的那一段的首尾**：

```
只到 2026-03-05 至 2026-03-07，此外的日期没取回
```

**已知欠账：`truncatedSide` 到不了模块。** 适配器算得出方向（点位侧砍晚的
`'late'`、台账侧砍早的 `'early'`，见 `pointSeries.ts` / `datasetSeries.ts`），但
`seriesSlots.ts` 折成 `BindingSlot` 时只搬了 `isTruncated`，`ModuleSlotMeta`
（`contracts/src/module.ts`）里也没有这个字段。补它要动 `contracts` + `runtime` +
catalog 快照，**不在新模块 PR 的豁免路径集合内**，故本轮不做。
选「说清取回的是哪一段」而不是「说清砍了哪一头」是有意的：前者只依赖模块手里已有的
事实，且对两个方向都成立——凡是落在这一段之外的日期，空白都不代表停机。

---

## 6. 配置面

分段名只用 `chart-config.ts` 的 `GROUP` 八个，不另造字符串。

| 分段 | 键 |
|---|---|
| 数据 | `title`（工厂） · `metrics`（array，行内 `name` / `unit` / `precision` / `dayAggregate`） · `emptyText` · `timezone` |
| 样式 | `chartStyle`（工厂） · `colorScale` · `minValue` · `maxValue` · `cellGap` |
| 提示框 / 动画 | 两个工厂各自产出 |

- **不 spread `cartesianAxisFields()` / `legendFields()` / `dataLabelFields()` /
  `paletteOverrideField()`**：日历没有可命名的坐标轴；图例这一档由色标承担；
  一年 365 格摆不下数值标签；配色由色阶两档派生，另开一个色板会与它打架。
- `contentKeys: ['title', 'metrics', 'emptyText', 'timezone']`。不声明的话这几个内容键
  会被 `styleKeysOf()` 当成观感键，别人套预设时把用户配好的指标与时区整片抹掉。
- `metrics` 封顶 `MAX_METRICS = 4`：多摆一张，每张的高度就少一份，第五张起一格只剩
  一两个像素——看得见颜色但读不出是哪一天。
- 逐张 `precision` 与色阶两个端点**刻意都没有 `default`**。

### 6.1 `minValue` / `maxValue` 为什么是 `number` 而不是 `range`

「留空 = 按数据自动定色阶」与「真的填了 0」必须分得开。滑杆没有空态
（`RangeControl.vue` 是 `readNumber(props.value, range.min ?? 0)`），没配时面板上
**显示 min 而渲染按自动走**，两边对不上；而且拖过一次就再也回不到「自动」。
这是 `pie-chart` 那一轮踩过的同一个坑。

三条口径：

- 两个都留空 → 按取回的数据自动定（每次刷新跟着数据走，跨天比色深就没有意义了，
  要横向比就把它填死，help 里写了这句）；
- 只填一头 → 另一头按数据补；
- **填反了按小的那个当下限**，不报错——两个数本身都合法，报错只会让屏上只剩一句错误。

### 6.2 一块里的几张日历**共用一条色阶**

色阶端点是整块级配置，`visualMap` 只有一条。所以**同一块只该摆同量纲的指标**：
0–100 的达标率与 0–5000 的能耗挤在一条色标上，达标率那张会整片一个色。
这一条写进了 `description`、`metrics` 的 help 与 `option.ts` 的文件头。
要混量纲请再放一块——这比给每张各挂一条色标（要占掉三分之一的高度）诚实。

---

## 7. 两档铺法

| 档 | 坐标 | 读的是什么 |
|---|---|---|
| `calendar` | `CalendarComponent`，横轴周、纵轴星期几 | 周中还是周末出的事 |
| `matrix` | 直角坐标，横轴几号（1–31）、纵轴年月（升序，最近的在最上） | 每个月的同一天是不是都这样 |

**换档只换坐标，一个读数都不换。** 这与设计文档 §1.1 那条红线一致：没有任何一档
是「切一下下拉就从实时数据变成手填 JSON」。

⚠ `calendar` 的 `cellSize: 'auto'` 必须配 `left` / `right` / `top` / `height` 一起给：
不给这四项时 echarts 反过来按 `cellSize` 推整块的尺寸，几块会重叠着摞在一起。
（实测确认：给全四项后两块日历各就各位，非 `ok` 的那块框照画。）

⚠ `matrix` 的 grid **不走 `cartesianGrid()`**：那一份出的是单块的四边留白，摆不了
「第 i 块从这里起、占这么高」。轴本体仍复用 `categoryAxis()`。

⚠ 类目轴从底往上排，所以年月按**升序**进 `data`，最近的那个月才落在最上面。

---

## 8. 颜色与文案

- 色阶取 `theme.ts` 的 `sequentialStops()` / `divergingStops()`，两者都从
  `SERIES_VARS` 六个 token 派生。**一个色都派生不出时不写 `inRange`**
  （`visualMapContinuous` 已经这么做），不自己补一套默认色——补出来的那套不跟着换肤走。
- ⚠ BK 那套 `--chart-series-1..5` / `--chart-cold` / `--chart-hot` 在本仓**全部不存在**，
  照抄会让配色整片丢失且不报错。
- ⚠ 绝不写 `color: ''` / `borderColor: ''`：echarts 会把空串当成一种颜色画出**透明**的
  图元。取不到就用 `withColor()` / 本模块的 `withBorderColor()` 省掉那个键。
- **格缝画成分隔线色**（`theme.splitLine`），不是画成背景色：图表背景是透明的
  （卡片框那层底由 host 铺），拿背景色描边等于描一个看不见的东西。
  没数据那一天露出来的也是这层底色，热力格盖在它上面。
- **月名与星期名写死成数组喂给 echarts**，不走它的 locale：CI 的 runner 与开发机不是
  同一个 locale，交给它挑会让同一份配置在两台机器上画出两种月名。SSR 用例断言
  SVG 里出现「1月」且不出现「Jan」。
- **日期串一律用 `<` 直接比大小，不走 `localeCompare`**：ISO 串的字典序就是时间序，
  而 `localeCompare` 的结果跟着 locale 走。
- 提示框的函数 formatter 返回值被 echarts 原样 `innerHTML`，拼进去的指标名与单位全是
  编辑器里的自由输入，逐段 `escapeHtml()`。
- ⚠ `.ts` 里的色值字面量那道闸拦不住（`check_ts_style.py` 只扫 `.vue` 与 `.scss`），
  option 全在 `.ts` 里，「零色值字面量」在这里靠约定 + 单测兜。

---

## 9. 交互

`hostClickable: true` 与 `emitsInteractions: true` **都开**：日历没有 `dataZoom`
滑块也没有拖拽手势，两者不打架。点某一格经 `ChartShell` 的 `itemClick` 上抛
`{ event: 'click', value: 那张日历配置里写的名称 }`；冒泡由 `useEChart` 一处吞掉。

⚠ **上抛的是指标名，不是日期。** 日期看着更「有信息」，但一年三百多个日期没法在联动
规则里逐个配，而 `setActive` 这类动作是**按值匹配**的——上抛日期等于配了一条永远
匹配不上的规则。日期在提示框里。指标名则正好对上「点这张日历 → 切到这个指标的明细屏」。

⚠ **重名的那几张按出现序加 `#1` 后缀**（标题栏上才分得出谁是谁），但**上抛的仍是
配置里的原名**：后缀名没人猜得到，「第 N 张」在上面插一张就整体挪位——两种都会让
配好的联动规则静默失配。没起名的那几张因此点了**不上抛**。

---

## 10. 刷新口径

`partialMerge: ['series', 'title', 'calendar', 'visualMap', 'grid', 'xAxis', 'yAxis']`。

⚠ **坐标必须一起进替换范围**：日期跨度、色阶端点与逐张标题**全是从实时值派生的**。
只换 `series` 会让日历框停在第一帧的跨度上，而格子按新跨度落位——**整片错格**，
且零报错。这与 `pie-chart` 把 `title`（环心读数）纳入替换范围是同一类问题的加重版。

`watchValues` 收的是**函数**，配 `valuesDeep: false`：签名里带上天数、首尾日期与
**读数之和**——天数与首尾都不变、只有今天那一格在长，是这一族的常态，光比天数会让
整块停在第一帧上。

---

## 11. 目录与文件

```
web/packages/modules/src/modules/calendar-heat/
├── manifest.ts       唯一 export default；含 description 与 contentKeys
├── Component.vue     套 ChartShell；只做「读 config/values → build 闭包」
├── option.ts         ChartBuild 实现：(theme) => ECOption
├── days.ts           取值层：config + values + meta.slots → MetricView[]，含空态口径
├── options.ts        枚举取值表（as const satisfies readonly ConfigOption[]）
└── presets.ts        四套整套观感
```

⚠ 入口文件必须叫 `manifest.ts`：叫 `index.ts` 的模块**从模块库消失且不报错**。
⚠ `manifest.ts` 里绝不静态 import `Component.vue` / `option.ts`：注册用的 glob 是
`eager: true`，静态引一下就把渲染组件并进注册 chunk，并破坏懒加载语义。
⚠ 绑定槽键要在 `Component.vue` 里**字面读一遍**（`props.values[DAY_SLOT_KEY]`）：
「绑定槽键两侧逐一对上」那条闸只扫模块目录本身、不跟 import 走。而 `config.<键>`
那条查的是**可达集**，所以 `title` 由 `ChartShell` 读、`animation` 由 `chartKit` 读
**是算数的**。
⚠ `manifest.ts` 里的演示序列**逐点写死**，不从两个数组按下标拼：拼的话每个下标都得
兜一次底，而那几个兜底分支永远走不到，白白把这份清单的分支覆盖压到 33%
（逐文件阈值是 95 行 / 90 分支）。

---

## 12. 落地要改的六份花名册

| # | 路径 | 改什么 |
|---|---|---|
| 1 | `web/packages/modules/tests/manifests.contract.spec.ts` | 目录数组加 `'calendar-heat'`（字典序）；`DAY_SLOT_KEY` 与 `METRIC_ITEMS_KEY` 登进 `KEY_CONSTANTS` |
| 2 | `web/packages/modules/tests/registerBuiltins.test.ts` | `BUILTIN_TYPES` 加一项 |
| 3 | `server/…/apps/dashboard/module_types.json` | **`-u` 重新生成**，不是手改 |
| 4 | `server/…/tests/contract/test_dashboard_module_catalog.py` | `EXPECTED_TYPES` 加一项 |
| 5 | `server/…/tests/unit/test_dashboard_module_catalog.py` | `known_types()` 断言加一项 |
| 6 | `server/…/tests/integration/test_dashboard_module_types_api.py` | 断言集合加一项 |

⚠ #4 与 #5 同名不同目录，只改一份的表现是另一份当场红。
⚠ `module_types.json` 是**烤进 platform-server 镜像**的，改了要重建镜像。本轮它第一次
出现 `"is_time_series": true`——服务端的 `BindingSpecOut` 早有这个字段，不用改代码。
⚠ 类型 id 叫 `calendar-heat`：按「零模块类型字面量」那条闸的口径 grep 过，
`packages/runtime/src` / `app/src` / `packages/modules/src`（排除 `src/modules`）三处
命中 **0**。图标用注册表里已有的 `calendar`——加新图标要改 `@dt/ui`，那不在新模块 PR
的豁免集合内。

---

## 13. 一期不做的

| 不做 | 理由 |
|---|---|
| 逐张各挂一条色标 | 每条色标要占掉三分之一的高度，四张就没地方画日历了。混量纲请再放一块 |
| 按小时的热力（横轴日、纵轴 24 小时） | 那是 `trend-chart` 的粒度；真要做是第三档铺法，不是新模块 |
| 点某一格下钻到那天的曲线 | 联动规则已经能表达「点这块 → 切另一张屏」，不在模块内另造一套；且上抛日期在规则里匹配不上（§9） |
| 归档心跳结转空桶 | 需要逐点位的 `archive_max_interval_ms`，大屏绑定里没有。空桶就是空桶，与趋势页的口径差异记在这里 |
| `truncatedSide` 的方向文案 | 要动 `contracts` + `runtime` + catalog 快照，不在新模块 PR 的豁免路径里（§5） |
| 周/月粒度的折算 | 「按天」是这一块的定义。要按周看请在台账侧建一列周聚合 |
