# 分析建模：算子结果展示规格

> 目标（用户原话）：**「美化数据分析模块中每一个算子的结果展示，尽可能展示完整的数据、各种对比图形、公式等。」**
>
> 本文是唯一可施工的设计规格，合成自三份提案（A 前端为主 / B 契约扩容 / C 问题导向）与三份评审（可施工性 / 数据正确性 / 视觉与信息设计）。评审挑出的每一条硬伤在 §11 逐条落到决策。
>
> **先更正一处既知事实：注册的算子是 24 个，不是 22 个。** `grep @register_operator` 24 处，`server/services/platform-server/tests/contract/test_modeling_operator_catalog.py:30-55` 的写死名单也是 24 项。§5 按 24 个给全。

---

## 1. 现状与病症

### 1.1 用户实际看到的两级界面，没有第三级

| 级 | 位置 | 内容 |
|---|---|---|
| 卡片一行字 | `web/app/src/pages/Modeling/Canvas/components/ModelingNode.vue:99-104,146,200-209` | 14rem 宽、单行省略号，与错误文案互斥 |
| 结果弹窗 | `components/ResultDialog.vue:27-32`（`DtModal width="56rem"`） | 逐端口摆开三种视图之一 |

`ResultView.vue:43-59,84-93` 只认 `kind` 派发到 `FrameView` / `ModelView` / `MetricsView` / `DtEmpty`。整体版面是纯纵向 flex + gap 1.25rem（`ResultView.vue:99-117`），**没有分区、没有卡片、没有主次**。

### 1.2 五类算子跑完后，屏幕上到底有什么

- **source（2 个）**：`FrameView` 一张表。看不到台账原本多少列、丢了哪几列、上限多少、触顶后实际起点在哪。
- **preprocess（6 个）**：与上一步**几乎一模一样**的一张表，只有行数或空值率变了几个百分点。`cast_type` 的 coerce 抹掉了多少格、`fill_missing` 填了什么值、`clip_outlier` 界在哪，**一个字都没有**。
- **feature（7 个）**：同上，外加列凭空多出来或消失。`pca` 末尾多出 `pc1…pcK` 几列没有物理含义的数（`operators/reduction.py:388-395`），载荷与解释方差一个都没有。
- **model（4 个）**：`ModelView` 一个四行事实表 + 权重条 + 三行英文超参键名。**零公式、零散点、零残差**。
- **evaluate（5 个）**：`MetricsView` 一排指标 chip；`feature_importance` / `cross_validate` **一张图都没有**（`pairs` 与 `residual_bins` 都是空元组，`MetricsView.vue:51-59` 两个 `v-if` 全不成立，plots 区是个空 div）。

### 1.3 已实测确认的九处真缺陷（都不是「不够好看」，是坏的或说谎的）

| # | 缺陷 | 证据 |
|---|---|---|
| D-1 | **图现在是黑的**。11 处非法 `rgb(var(--x-rgb) / α)`——`--accent-primary-rgb` 是逗号三元组 `0, 206, 252`（`web/packages/tokens/src/tokens.scss:40`），混用逗号分量与斜杠 alpha 让**整条声明作废**。散点的点、残差柱回落成黑；权重条是 `background`，作废 = **整条不画** | 实测 grep 全仓 11 处，**全部集中在 `pages/Modeling/Canvas` 一个目录**：`ScatterChart.vue:93`、`ResidualChart.vue:99`、`ModelView.vue:213,216`、`ModelingNode.vue:150`、`CanvasMenu.vue:176,191`、`CanvasToolbar.vue:122,136`、`EditorCanvas.vue:436,444`。其余 101 处 `-rgb` 消费都写的是合法的 `rgba(var(--x-rgb), α)`（参照 `packages/ui/src/components/DtTable/DtTable.vue:173,182`）。两道 CSS 变量闸都逮不到——变量名完全正确，错的是外层函数语法 |
| D-2 | **小系数一律显示成 0**。`niceNumber` 注释写「保留四位有效小数」，实现是 `toFixed(4)` 即四位**小数**：`0.00003 → "0"`、`1e-7 → "0"`。系数与截距都走它，模型公式一写出来就是错的 | `scripts/numbers.ts:7-13`（实测已核） |
| D-3 | **同一个数在两处会显示成两样**。`nodeHeadline.ts:23-26` 的 `short()` 是 `niceNumber` 的**逐字复制品**（同样 `toFixed(4).replace(/0+$/,'')`）。只改 `numbers.ts` 会让卡片与弹窗分叉 | 实测已核 |
| D-4 | **训练成功的树模型被写成「还没训出来」**。`operators/trees.py:151-153` 刻意 `fitted={}`（通道 B，真参数在二进制产物里）→ `services/preview.py:136` 原样带出 → `scripts/preview.ts:204` `Object.keys(fitted).length > 0` 判 false → `ModelView.vue:69-71` 弹橙色告警 | 链路逐跳已核 |
| D-4b | **且现有用例并没有钉住这条错语义**。`tests/pages/Modeling/scripts/preview.test.ts:111-117` 的 `model()` 夹具 `serving_channel: 'json'`，改判据成 `servingChannel === 'binary'` 时不看 `fitted` 对它一个字都不影响，用例照绿 | 实测已核（三份提案都判错了这一条） |
| D-5 | **权重条整排缩成看不见的一丝**。基准钉死在 `Math.max(1, ...ranked.map(|w|))`，所有系数 <1 时（未标准化的原始量纲上是常态）看起来像「所有特征都不重要」 | `ModelView.vue:40-42` |
| D-6 | **触顶警示方向写反**。`operators/record_read.py:122,171` 明说留下的是**最新**那批、丢的是靠前的；`FrameView.vue:113` 写的是「靠后的数据根本没有取进来」。用户照它缩时间范围会缩错一头 | 逐行已核 |
| D-7 | **出处那行字在触顶时是假的**。`provenance.since` 存的是**请求**起点（`operators/frame_source.py:87,134`），触顶时实际起点是 `frame.index[0]`、比它晚得多 | 逐行已核 |
| D-8 | **散点会无声消失**。`services/preview.py:176-187` 的 `_stripped` 摘掉 `pairs` 却留着 `pairs_truncated`，而 `preview.ts:244` 只读 `pairs_truncated`——超预算的评估结果少掉一张图且界面零提示 | 实测已核 |
| D-9 | **标准化后一列 z 分数还顶着「℃」**。`operators/frame.py:175-190` 的 `with_column_values` 只换行不换列定义，`FrameView.vue:125` 照旧渲染 unit | 逐行已核 |

### 1.4 后端算了 / 传了、前端一个字没读的四处

| 数据 | 后端 | 前端 |
|---|---|---|
| `labels` + `matrix`（混淆矩阵） | `operators/evaluate.py:247-248` → `services/preview.py:152-153`，且有单测钉住 `tests/unit/test_modeling_classification.py:166-173` | `scripts/preview.ts:226-247` 的 `metricsOf` 只读 `metrics/pairs/pairs_truncated/residual_bins`。**混淆矩阵从上线到现在一次都没显示过** |
| `fitted.classes`（正类是哪个值） | `operators/model.py:501-507` 随 `fitted` 整包带出 | `preview.ts:190-210` 只读 `coef`/`intercept`。不知道正类是 0 还是 1，权重条的方向就是反的 |
| `is_preview_truncated` | `schemas/run.py:52`、前端契约 `packages/contracts/src/modeling.ts:180` 都已声明 | **`web/app/src` 下零引用** |
| `FrameColumn.coerce_failed` | `operators/frame.py:48` 定义、`frame_source.py:126` 写入 | **全仓零读取**，`preview.py:93-104` 的 `_column_stat` 不带它 |

### 1.5 算了就丢的十一处中间量（本次要买回来的东西）

`join.py:143` 的 `best_gap` · `join.py:115-118` 的 `matched` 计数 · `cleaning.py:305-308` 的 coerce 失败计数与原值 · `cleaning.py:198-216` 的 `dropped`/`kept` · `cleaning.py:349` 的 `blanks` 归因 · `cleaning.py:496-500` 的桶映射 `grouped` · `preprocess.py:347-356` 的 μ/σ/Q1/Q3 · `reduction.py:173-175` 的每列打分 · `feature.py:330-335` 的类目频次 · `estimators.py:280-300` 主动丢掉的 `explained_variance_ratio_` · `diagnostics.py:391-399` 被 `_summary` 折成四个标量的逐折分数。

### 1.6 两处会让新增内容静默失效的字节账（必须先修）

- **`fit_budget` 走到 `_stripped` 之后不复量尺寸就返回**（`services/preview.py:53-61`，实测已核），而 `_stripped` 只摘 `head/index_head/pairs/fitted` 四个键（:176-187，实测确认是**黑名单**）。任何新大键都会**直接突破 256KB 写进 JSONB 且 CI 全绿**——现有那条「preview 有硬上限」的用例只喂帧（`tests/unit/test_modeling_preview.py:13-26,50-54`）。
- **运行级 8MB 按每端口固定记 `PREVIEW_MAX_BYTES`**（`services/run_executor.py:205`），与实际字节无关。实际语义是「一次运行最多 32 个输出端口有摘要」，第 33 路起写的是 `{"kind": …, "note": "本次运行的结果摘要已用满预算"}` 桩——**没有 columns、没有 shape**。

---

## 2. 设计原则（七条）

**P1 · 同一种信息永远在同一位置。**
结果面是固定六区（§3），块自带 `zone` 而不是自带顺序；渲染器按一张常量 `ZONE_ORDER` 排，不按数组顺序排。理由：24 个算子分四批写，若顺序由每条注册表条目自定，两批人写出来的读起来不像同一个产品——这正是用户提这次需求的原因。

**P2 · 同一个语义永远同一个外形。**
「前后对比」在 15 个产 frame 的算子上都长成 `BarList` 的 pairs 模式；「分布 + 一条线」都长成 `HistogramChart`。后端块按语义分（做了什么），前端件按形状分（画成什么），两层分开且是多对一。理由：块词表一宽（B 的 13 种里 delta/funnel/bars 本质都是横条），「各画各的脸」只是从组件层下沉到数据层。

**P3 · 不替用户下没根据的结论。**
有阈值口径的指标（r2/mape/accuracy/precision/recall/f1）才三档染色；MAE/RMSE/最大误差/残差统计/置换重要性一律 `unknown` 灰（`scripts/metricBands.ts:49-56` 的既有口径）。但 `MetricsView.vue:34` 那句「好坏取决于这一列的量纲」套到**无量纲**的 ΔR² 与 `score_std` 上是**错的**提示，要改成「这个数没有公认的好坏线」。

**P4 · 算不出来就说算不出来，不用近似冒充精确。**
凡写「摘要里已有」的地方，必须点出两侧的函数与行号并证明同源（范例：`drop_missing` 丢列判据 `cleaning.py:199` 的 `null_ratio_of` 与摘要 `preview.py:99` 的 `_column_stat` 都过 `frame.values_of` 全帧，是同一个量）。论证不到这一步的，一律**由后端算准**，不做前端推断。理由见 §11 的三条数据硬伤——三份提案的「零后端精确复算」有三条经不起审计。

**P5 · 截断必须标注，且四种「没有」一个都不许合并。**
① 数据根本没进来（取数触顶）② 摘要削掉了（字节预算）③ 上游那份摘要被削了或被换成桩 ④ 这次运行没记这一项（老运行）。措辞、位置、intent 各不相同，且 ②③ 要显示在**被削掉的那个块的位置**，不是笼统在顶上说一句。

**P6 · 图是给眼睛的，图下那行字是给所有人的。**
每张图下必须有一行**可见**（不是 `sr-only`）文字结论：「12,480 行 → 8,336 行，丢了 33.2%，其中 91% 是因为『湿度』为空」。颜色不作唯一编码：丢弃段用警示色**并且**加斜纹，越界用危险色**并且**加 1px 边框。先例：`pages/Hvac/ModelDetail/components/ErrorHistogram.vue:81-85`。

**P7 · 先修再刷漆。**
D-1～D-8 排在任何新画法之前。不修的话新旧画法一起黑，而「不好看」会被归因到新画法上。

---

## 3. 结果面的统一版式

### 3.1 容器

`ResultDialog.vue` 的 `width` 从 `56rem` 改成 `min(72rem, 92vw)`。
**它是 ResultDialog 自己传给 DtModal 的 prop**（`ResultDialog.vue:30` → `DtModal.vue:129` 落成 panel 的 `:style="{ width }"`，panel 另有 `max-width: 100%`，实测已核），**只影响这一个弹窗**，不是全局动作。必须改的理由：`FrameView` 的两张 `DtTable` 写死 `min-width="52rem"`，56rem 弹窗内容宽约 53rem，**今天就在横向滚**。

高度侧三条硬规则（三份提案全缺，评审 3 点名）：
- 「⑤ 完整数据」区**默认折叠**，标题行写「完整数据（200 行 × 8 列）」，点开才渲染。
- 展开后的 `DtTable` 外层套 `max-height: 28rem; overflow: auto`（`DtTable` 自身无 max-height，200 行是全高渲染）。
- 弹窗顶部一条**分区锚点条**（六个区名，点击滚到），`position: sticky`。

### 3.2 六区（从上到下，顺序由常量 `ZONE_ORDER` 锁死）

| 区 | 名 | 内容 | 组件 | 尺寸 |
|---|---|---|---|---|
| ① | **这一步做了什么** | 一句话 gist + 参数 chips + 行/列/格子的账 + 告警 note | `StepSummary.vue`（内含 `DtTag` chips + `DtNotice`） | 全宽，≤3 行文字 + ≤2 个 note |
| ② | **关键数字** | 4–8 张指标卡 | `StatCards.vue`（`grid gap-3 sm:grid-cols-2 lg:grid-cols-4` + `DtCard padding="sm"` + `DtDigits` + `DtHelpTip`） | 每卡最小 12rem，最多两行 |
| ③ | **对比图** | 主体图 + 辅图 | 见 §7 的六个图元件 | 主体图 `min(44rem, 100%)`；辅图网格 `repeat(auto-fit, minmax(22rem, 1fr))`（70rem 下两列） |
| ④ | **怎么算的** | 公式（符号态 / 代入态）+ 变量表 | `FormulaBlock.vue` | 全宽，行内 flex-wrap |
| ⑤ | **完整数据** | 列统计表 / 系数表 / 明细表 / 混淆矩阵 | `DtTable`（禁手写 `<table>`） | 默认折叠 + 内滚 28rem |
| ⑥ | **出处与截断** | provenance 行 + 四档截断说明 + 下载全量结果 | `ProvenanceBar.vue` + `TruncationNotice.vue` | 一行灰字 + 0–3 条 `DtNotice` |

### 3.3 节点级 vs 端口级

```
ResultDialog  (min(72rem, 92vw))
├─ 锚点条（sticky）
├─ ⑥-顶  TruncationNotice        ← 整屏级：is_preview_truncated / 取数触顶
├─ ①②③④  节点级区（只渲染一次）   ← report.blocks 里 port === "" 的那些
└─ <section v-for 端口>（DtCard）
   ├─ 端口标签（>1 路才摆）
   ├─ ①②③④  端口级区
   ├─ ⑤  主体视图（FrameView / ModelView / MetricsView / UnknownView）
   └─ ⑥  出处与下载
```

节点级放在端口段**之外**：`split_dataset`（train/test 两路）与三个建模算子（model/scored 两路）真正要说的话是**跨端口**的（「测试段在训练段之后吗」「这个模型的公式」），端口级放不下；多端口节点也不会把同一份账印两遍。

### 3.4 两端口节点的重复（评审 3 点名，三份提案全缺）

`split_dataset` 与三个建模算子逐端口摆开 = 两张 200 行明细表 + 两份列统计表 + 两段一字不差的出处文案（`select_rows` 不动 provenance，`operators/frame.py:239-252`）。
**决策**：多端口节点的「⑤ 完整数据」区改成 `DtSegmented` 页签（训练集 / 测试集），一次只渲染一路；「⑥ 出处」在两路 provenance 完全相同时**只印一次**并加一行「两路来自同一次取数，切分不改出处」。

---

## 4. 结果摘要契约的演进

### 4.1 preview kind：保持 3 种 + unknown，一种都不加

**判据（写进 `docs/MODELING_DESIGN.md` 的 D 序列，与 D21 并列）**

- **判据 A（够格成为 preview kind）**：端口负载的**顶层形状**变了，既有读取器一个字都读不出来，`previewOf` 必须多一条分支才不掉进 unknown。等价说法：它是 `summarize()` 按 payload Python 类型派发得出的**载体**。
- **判据 B（只够成为块）**：这一屏多了一块内容，主体读取器照读不误。

**按判据 A 逐个查 24 个算子：满足的是零个。** 24 个算子的输出端口只挂三种契约（`operators/base.py:20-30`），`summarize()` 也只认三种 payload（`services/preview.py:32-45`）。transform / importance / decomposition / folds / confusion 这五样全部是「一屏里的一块」。

**三条不加的硬理由：**
1. **加 kind 会静默弄坏发布**。`services/model_service.py:353-364` 抽发布指标靠 `preview["metrics"]["kind"] == "metrics"`（实测已核）。评估算子换 kind → 模型版本 `metrics` 静默变空字典、模型库详情页那块指标空白、后端一句错都不报、没有用例守。
2. **派发链会无限长且表达不了组合**。`clip_outlier` 一屏要「定界表 + 触界条 + 分布直方 + 公式」四样，单一 kind 表达不了。块可以组合，kind 不能。
3. **kind 是端口的，块是屏的**。`split_dataset` 的跨端口对比 kind 再多也放不下。

**唯一要动的是 `unknown` 的兜底**：`ResultView.vue:93` 今天落到 `DtEmpty`，与设计 §8.4 承诺的「格式化 JSON 兜底、永不白屏」不符。改成 `UnknownView.vue`：`note` 放第一行（旧的「摘要已用满预算」桩靠它），下面折叠一个 `<pre>`。

### 4.2 新增：节点级 `report`（独立列，不塞进 preview）

**决策：一次扩展步迁移，`modeling_node_runs` 加 `report_json`（nullable JSONB、无 CHECK、无回填、开头设 `lock_timeout`），出接口为 `NodeRunOut.report`。**

选它而不是塞进 `preview_json` 的理由（这是本规格与提案 B 的最大分歧，评审 1 与评审 3 都点了 B 的这处）：
- 帧摘要**已经贴着天花板**：200 行 × 60 列全精度浮点实测 246,662 / 262,144 字节。块一进去就触发降档，而 `_trim_rows` **只削行、不削新键**——用户看到的是「明细行数莫名从 200 变成 50」，没有一个字说是为了腾地方。
- 后果更坏的是**界面长相取决于数据宽度**：同一个 `resample` 节点，窄表有图、宽表没图，用户无法预期也无法投诉。
- **先例就在同一张表上**：`models/run.py:174-179` 的 `fitted_json` 独立成列，注释自己写明「摘要有字节预算、超了会被静默削掉」。这不是新模式。

### 4.3 `report` 的形状

```python
# operators/reporting.py
@dataclass(frozen=True)
class ReportBlock:
    kind: BlockKind        # 8 种，见下表
    zone: Zone             # 'step' | 'stats' | 'charts' | 'formula' | 'table'
    port: str              # "" = 节点级
    title: str
    tier: int              # 0 标量 / 1 小数组 / 2 大数组，降档用
    payload: dict[str, Any]
```

| block kind | 回答什么 | payload 关键字段（含硬上限） | 谁产 |
|---|---|---|---|
| `rows` | 行数变了多少、谁的锅 | `before/after/dropped/dropped_blank/ratio_configured/ratio_actual/funnel[≤6]/by_column[≤12]` | 8 个算子 |
| `columns` | 列去哪了 / 多出来的是谁造的 | `added[≤60]/removed[≤60]/kept/dtype_before[≤12]/reason` | 9 个算子 |
| `cells` | 默默改了多少个数 | `by_column[≤12]: {key, changed, low, high, samples[≤3]}` | 4 个算子 |
| `fits` | 学到了什么、能不能核对 | `method/train_rows/total_rows/by_column[≤60]: {key, params{}, skipped_reason}` | 6 个算子 |
| `bins` | 这条线画在哪、分布长什么样 | `by_column[≤8]: {key, bins[≤40], marks[≤4]{at,label,intent}, off_axis{label,count}}` | 8 个算子 |
| `axis` | 时间轴被怎么动了 | `bucket_ms/tz_offset_minutes/actual_since/actual_until/occupancy[≤200]/gaps[≤20]/segments[≤20]` | 5 个算子 |
| `breakdown` | 按项的一组数 | `label/unit/score_kind/baseline/items[≤60]{name,value,spread}` | 3 个算子 |
| `structure` | 模型内部长什么样 | `importances[≤60]/ranges[≤60]/tree{depth≤3,nodes≤31}/pdp[≤10×20]/loadings[≤20×20]/explained[≤20]` | 3 个算子 |

**`breakdown` 是键空间冲突的根治**：`feature_importance` 今天把**列名**当指标键塞进扁平的 `metrics` 字典（`diagnostics.py:190,215`），于是某列若恰好叫 `r2`，`metricBands.ts:22` 会给它套上回归阈值染色；更隐蔽的是 `MetricsView.vue:30` 拼的是 `${niceNumber(value)}${unitOf(key)}`，`UNITS` 里有 `mape: '%'`——一列叫 `mape` 时，无量纲的 ΔR²=0.12 会被印成「0.12%」（评审 2 发现，三份提案都只修了颜色）。搬进 `breakdown` 之后 `metrics` 字典留空；`MetricsView` 的「这一步没有产出任何指标」告警条件同步改成「metrics 与 blocks 双空才报」。

### 4.4 `report()` 这条缝

```
operators/base.py        + def report(self) -> tuple[ReportBlock, ...]:  默认 ()
services/node_task.py    + NodeResult.report 字段；run_node_payload 里 report=operator.report()
services/run_dispatch.py + 落 report_json
schemas/run.py           + NodeRunOut.report + NodeRunOut.fitted
```

**位置必须是 `NodeResult`，不能「执行器跑完从算子实例取」**：算子实例跑在子进程里（`services/run_pool.py` 的 ProcessPoolExecutor，`node_task.py:49-71` 是模块级纯函数入口），`node_task.py` 的文件头逐字写着「算子实例用完即弃……留在子进程里就再也拿不回来了」。实测确认 `NodeResult` 今天已经带着 `outputs / fitted / artifact / io` 四样走这条路，加第五个字段是同一条缝。

**加一个新算子的完整代价**：在算子类里写一个 `report()`，用 `reporting.py` 的构造函数拼几个块（十几行）。前端零改动，`preview` 相关契约零改动。

### 4.5 `NodeRunOut.fitted` 只读出口

`fitted_json` 列（`models/run.py:177`）早已存着 `fill_missing` 的填充值、`clip_outlier` 的上下界、`standardize` 的 center/scale、`one_hot` 的类目清单、`select_feature` 的名单、`pca` 的载荷，但只有发布（`publish_service.py:392-408`）与推理（`serving.py:242-254`）两条路读它。**D1 的原意是不让摘要预算削掉它，不是不让看。** 加一个只读字段是**零迁移**（列已在库）。

> 反对 B 的做法（拒开出口、让算子在 `report()` 里自己挑一份放进块）：那会把用户最需要核对的六个数放进会被降档丢掉的地方，完全违背 D1 立那一列的初衷。

### 4.6 字节预算与降档策略

**常量**（继续集中在 `services/preview.py` 一处，D19）：

```python
PREVIEW_MAX_BYTES     = 256 * 1024   # 不动
RUN_PREVIEW_MAX_BYTES = 8 * 1024 * 1024
REPORT_MAX_BYTES      = 64 * 1024    # 新：单节点 report 的独立上限
RUN_REPORT_MAX_BYTES  = 2 * 1024 * 1024
```

`REPORT_MAX_BYTES = 64KB` 不是保守值，是被一条乘法定死的：运行成功后前端最多预取 **24 份**摘要用来算卡片那行字（`scripts/useCanvasPage.ts:32-38`），report 会跟着一起下载。

**三处必须先修的字节账（PR-1，无 UI 变化）：**

1. `fit_budget` 走完 `_stripped` 之后**复量一次尺寸**，仍超就再降一档。
2. `_stripped` **保持黑名单**（今天摘 `head/index_head/pairs/fitted`），只**扩充**名单，**绝不改成白名单**。
   > ⚠ 这是评审 1 挑出的、提案 B 会静默炸生产的一条：metrics 摘要的键是 `kind/task/metrics/pairs/pairs_truncated/residual_bins/labels/matrix`，白名单只留 `kind` 会把 `metrics` 整个摘掉，而 `model_service._metrics_of` 正是靠 `preview["metrics"]["metrics"]` 冻结发布指标；model 摘要同样会只剩 `kind`，`ModelView` 整块渲染不出。
3. `run_executor.py:205` 的 `self._used += PREVIEW_MAX_BYTES` 改成按 `_size_of` 的**实际字节**记账。
   > 这是**行为变更**：今天第 33 路端口起一律只剩桩，改完之后大多数图的全部节点都会有摘要。必须配一条钉住新语义的用例（三份提案都没提）。

**report 的降档：按 zone 优先级，不按 tier。**

```
0  原样                                  ← 量一次
1  丢 tier 2 且 zone == 'table'          ← 再量
2  丢 tier 2 且 zone == 'charts' 的辅图   ← 再量（isPrimary=false 的先走）
3  丢 tier 1 且 zone != 'step'           ← 再量
4  只留 zone == 'step' 的 tier 0 块 + 一条 note
```

> ⚠ 这条修掉了提案 B 的自相矛盾：B 的「档 1 先丢全部 tier 2」会把它自己放在主体位的 `resample` 前后叠图、`lag/rolling` 叠图、`pca` 载荷热力第一个斩掉——恰好在最需要解释的那类运行（宽、长、列多）上，旗舰图 100% 不出现。**主体图最后丢。**

**每次降档在 `report` 里留痕**：`report.dropped: ["pca-loadings", "resample-overlay"]`，由 `TruncationNotice` 渲染成明示。

**实测量级**（本规格的新增数据都在 KB 级，`REPORT_MAX_BYTES` 绰绰有余）：混淆矩阵 5×5=224B / 20×20=2.6KB；PCA 载荷 20×60=7KB；10 折明细 950B；系数表 60 列=5KB；每列 20 桶直方 ×8 列=3.1KB；限深树 31 节点=3.4KB；PDP 10×20=1.6KB。**唯二危险的两个都已限死**：决策树全结构（2047 节点 229KB → 限 31 节点）、宽帧逐列直方（60 列 23.4KB → 限 8 列，且只挑「这一步真正动过的列」）。

### 4.7 存量兼容

- `report_json` 可空、无 CHECK、无回填。旧行为 NULL → `NodeRunOut.report = null` → 前端渲染零个块 → 界面退化成今天的样子，一个字不多一个字不少。历史回看（`?run_id=…`）因此自动正确。
- **blocks 为空就整个不渲染那一区**，不摆空态——否则旧运行的详情弹窗会出现一片白块。
- 「新结构 + 旧代码」可用：旧前端不认识 `report` 字段，读取器忽略即可。
- **`openapi.json` 必须重导**：`NodeRunOut` 加了 `report` 与 `fitted` 两个顶层字段，`check_openapi_sync.py` 会逐字节比对。同时 `web/app/tests/contract/modeling-shapes.contract.spec.ts` 的 `NODE_RUN` 键集要同步加两项。
  > ⚠ 这条更正提案 C：C 的 backendChanges 一边给 `NodeRunOut` 加两个字段、一边写「不需要动 openapi.json」，本地会绿、合进 main 当场红在契约段。
- **`preview` 内部形状仍然零契约保护**（`ModelingNodeRun.preview` 是 `Record<string, unknown>`，线形契约只锁 11 个顶层键），所以本次新增的键全部走 `report` 而不是 `preview`——`report` 有双向契约（§10）。

---

## 5. 逐算子规格表（24 个，一个不漏）

**读法**：`块` = §4.3 的 block kind（`zone` 在括号里）；`图` = §7 的图元件；`公式` = LaTeX，实参来源在括号里；`后端` = 是否需要后端改动。
**通用约定**（不再逐条重复）：每个算子的 ⑤ 区都保留既有主体视图（`FrameView`/`ModelView`/`MetricsView`）；每个算子的 ④ 区都有公式；参数 chips 一律从 `ModelingRun.graph.nodes[].config` 取（运行时冻结的快照，历史回看正确，**零后端**）。

### source（2 个）

#### 1. `ledger_source` · 台账取数
- **块**：`rows`(step) 取数漏斗 · `columns`(step) 丢空列名单 · `axis`(charts) 时间覆盖 · `bins`(charts) 各列空值率与转坏格数
- **图**：`BarList` 三级漏斗（台账 12 列 → 选中 9 → 丢空列后 7；窗口命中 300,142 行 → 上限 50,000 → 实取 50,000）· `TimelineBand` 占用条 + 断档 · `BarList` 每列空值率双段条（第二段是 `coerce_failed`，>50% 标 danger）
- **公式**：$\text{rows} = \operatorname{last}_{L}\{\, r \in T : t_{\text{since}} \le t(r) \le t_{\text{until}},\ \operatorname{src}(r) \in S \,\}$，$L = \texttt{row\_limit}$（代入 config）
- **来源**：`frame_source.py:73-86` 的三级收窄 · `source.py:143` 的 `empty_keys` · `frame.index` 首末 · `frame.py:48` 的 `coerce_failed`
- **后端**：**要**。`_column_stat` 补 `coerce_failed`；`report` 出漏斗、`index_histogram[≤120]`、`actual_since/actual_until`
- **顺带修**：D-6 触顶文案方向、D-7 出处那行字（触顶时并排印「请求 2026-01-01 / 实际 2026-08-12」两行）

#### 2. `ledger_join` · 多台账对齐
- **块**：`rows`(step) 三分账 · `bins`(charts) 时刻差与复用次数 · `columns`(step)
- **图**：`BarList` 堆叠（两边都有 / 左有右无 / 右侧从没被用上）· `HistogramChart`(gap，≤30 箱，τ 处一条 danger 竖线) · `HistogramChart`(右行复用次数) · `BarList` pairs（左 / 右 / 输出三段行数）
- **公式**：$j(i) = \underset{j:\,|t^{R}_{j}-t^{L}_{i}|\le\tau}{\arg\min}\ |t^{R}_{j}-t^{L}_{i}|$，$\tau=\texttt{tolerance\_ms}$；`how=left` 时 $j(i)$ 不存在则右侧整排置 $\varnothing$
- **来源**：`join.py:115-118` 的 `matched` · `join.py:143` 算完即弃的 `best_gap`
- **后端**：**要**。顺手把 `_nearest` 的 $O(N_L \times N_R)$ 全扫（`join.py:140-146`，两边各 5 万行 = 25 亿次比较且不早停）改成双指针
- **一句话结论**：「一条右行最多被 60 条左行命中——这一步事实上做了一次前向填充」

### preprocess（6 个）

#### 3. `cast_type` · 类型归一
- **块**：`cells`(step) 转坏格数与样例 · `columns`(step) dtype 前后 · `bins`(charts) 空值率前后
- **图**：`BarList` pairs（前后空值率，行数不变故差值可信）· `BarList`（每列转坏格数）· 小表（dtype 前后对照，只列被处理的列）
- **公式**：$\operatorname{cast}_{\texttt{number}}(v) = \begin{cases}\varnothing & v=\varnothing\\ 1.0/0.0 & v\in\{\text{true},\text{false}\}\\ \operatorname{float}(v) & v\ \text{可解析}\\ \varnothing & \texttt{on\_error}=\text{coerce}\\ \text{抛错} & \texttt{on\_error}=\text{error}\end{cases}$（按 config 高亮走到的那一支）
- **来源**：`cleaning.py:305-320` 的 `converted is None` 那一支（文件自己在 `cleaning.py:40-42` 写明这是个坑）
- **后端**：**要**（前 3 个转不动的原值只能后端给——「哦是那个 `--` 占位符」）

#### 4. `drop_missing` · 丢缺失
- **块**：`rows`(step) 丢行数与归因 · `columns`(step) 被丢列清单 · `bins`(charts) 空值率对阈值
- **图**：`BarList` pairs（行数）· `BarList`（丢行归因，降序）· `BarList` + 阈值参考线（各列 $\rho_c$ vs $\theta$，看得出「阈值再调低 0.1 会连温度也一起丢掉」）
- **公式**：丢行 $\text{keep}(i)=\neg\bigl(\bigvee_{c\in S}[v_{i,c}=\varnothing]\bigr)$（any）/ $\neg\bigl(\bigwedge_{c\in S}[\cdot]\bigr)$（all）；丢列 $\rho_c=\frac{\#\{i:v_{i,c}=\varnothing\}}{n},\ \text{drop}(c)\iff\rho_c>\theta$
- **来源**：`cleaning.py:198-216` 的 `dropped`/`kept` · `cleaning.py:349` 的 `blanks`
- **后端**：**要**（丢行归因只能后端算）。丢列档的列名与 $\rho_c$ 理论上可前端复算（`cleaning.py:199` 与 `preview.py:99` 同源，已核），但 `PREVIEW_COLS=60` 截断会让第 61 列起复算失败，故统一由后端给

#### 5. `filter_rows` · 条件过滤
- **块**：`bins`(charts, **isPrimary**) 被比较列分布 · `rows`(step) 保留率与因空丢弃
- **图**：`HistogramChart`（≤40 箱，保留段实心 / 丢弃段斜纹 + 阈值竖线）。**⚠ 直方图右侧必须画一根离轴柱「空值：2,891 行（不在这条轴上）」**——因空值被丢的行在数轴上没有位置，不画它会出现「丢弃段目测一小截、顶上写着丢了 33%」的对不上账（评审 2 挑出的 C 的硬伤）
- **公式**：$\text{keep}(i)\iff\begin{cases}x_i\neq\varnothing\ \wedge\ x_i\ge v & \texttt{op}=\text{gte}\\ x_i=\varnothing & \text{is\_blank}\\ x_i\neq\varnothing & \text{not\_blank}\end{cases}$
  **⚠ 单列一行加警示底**：$x_i=\varnothing \Rightarrow$ 比较档一律丢弃（不当 0 参与比较）
- **来源**：`cleaning.py:279-283` 已在手的整列取值 · `cleaning.py:360-366` 那一支的计数
- **后端**：**要**

#### 6. `resample` · 时间重采样
- **块**：`rows`(step) 压缩比 · `axis`(charts, **isPrimary**) 桶占用与断档 · `bins`(charts) 每桶行数
- **图**：`TimelineBand`（占用 + 断档，降采样 ≤200 格）· `HistogramChart`（每桶行数，单行桶那一柱标警示）· `ScatterPlot mode=series`（同一列前后叠图：原始点 + 聚合折线，各 ≤500 点）
- **公式**：$b(t)=\bigl\lfloor\frac{t+\Delta}{w}\bigr\rfloor\cdot w-\Delta$，$w=\texttt{bucket}$，$\Delta=\texttt{tz\_offset\_minutes}\cdot 60000$；$\tilde{x}_b=\frac{1}{|B_b|}\sum_{i\in B_b}x_i$（agg=avg，八档按 config 挑一条）
- **来源**：`cleaning.py:496-500` 的 `grouped`
- **后端**：**要**。⚠ `tz_offset_minutes` 由运行环境注入、界面拿不到，必须进 `report`——按 UTC 切一天在东八区会整体偏 8 小时且每个数看着完全正常。顺手把 `cleaning.py:531` 每格一次的线性查列 `position_of` 提到循环外

#### 7. `fill_missing` · 填缺失
- **块**：`fits`(table, **isPrimary**) 逐列填充表 · `cells`(step) 填格数 · `bins`(charts) 填充前分布
- **图**：`DtTable`（列 / 填充值 / 填了多少格 / 填前空值率 / 拟合样本数）· `HistogramChart` + 填充值竖线（用均值填 30% 的空会在正中堆出一根假柱、把方差压掉——只有图看得见）· `BarList` pairs（空值率前后）
- **公式**：$\hat{x}_c=\operatorname{mean}/\operatorname{median}\{x_{i,c}: i\in\text{train},\,x\neq\varnothing\}$ 或 $\texttt{value}$；$P_c=\{i\in\text{train}: x_{i,c}\neq\varnothing\}$（**这个下标集单独讲**——它正是「用户拿全表均值核对填充值却对不上」的原因，`fitting.py:3-5` 的防泄漏是刻意设计）
- **来源**：填充值已落 `fitted_json`（`preprocess.py:141`）→ 走 §4.5 的 `NodeRunOut.fitted`；填格数与训练行数走 `report`
- **后端**：**要**（fitted 出口 + report）

#### 8. `clip_outlier` · 离群裁剪
- **块**：`fits`(table, **isPrimary**) 定界表 · `cells`(step) 触界计数 · `bins`(charts) 裁剪前分布
- **图**：`DtTable`（列 / 方法 / k / μ,σ 或 Q1,Q3 / lo / hi）· `HistogramChart` + 两条界线（超界部分标红并堆到边界柱）· `BarList` 堆叠（夹到下界 / 夹到上界 / 未动）
- **公式**：zscore $\mu=\frac1n\sum x_i,\ \sigma=\sqrt{\frac1n\sum(x_i-\mu)^2}$（**总体口径，除 $n$**），$[lo,hi]=[\mu-k\sigma,\ \mu+k\sigma]$；iqr $[Q_1-k\cdot\text{IQR},\ Q_3+k\cdot\text{IQR}]$。**代入实参**：μ=23.41、σ=1.83、k=3 ⇒ [17.92, 28.90]。**这是全模块第一处能把公式代上真参数的地方，做成范例**
- **来源**：lo/hi 在 `fitted_json`；μ/σ/Q1/Q3 在 `preprocess.py:347-356` 算完即弃
- **后端**：**要**
- **⚠ 版式**：代入式公式**不进表格 td**（那一行要塞列名+方法+k+μ+σ+lo+hi+公式，70rem 里必然折成两三行、行高参差），改成表格下方一段，一列一行、等宽起排
- **⚠ 不做**：「裁后 min/max 恰好等于 lo/hi」这条零后端推断**不成立**——`_clipped` 是 $\min(\max(v,lo),hi)$，只有真有行越界时才相等。k 配大了（一行都没碰到界）时会把该列真实极值当成「本步定的界」印出来
- **免费的额外告警**：界在**训练行**上拟合（`preprocess.py:290-293`）却裁**整帧**，所以「本步 max = hi」同时是「有测试行超出了训练分布」的证据 —— 比较 split 两侧的 min/max 即可，加一条 note

### feature（7 个）

#### 9. `standardize` · 标准化
- **块**：`fits`(table, **isPrimary**) 逐列尺度 · `bins`(charts) 前后分布
- **图**：`DtTable`（列 / 中心 μ 或 min / 跨度 σ 或 max−min / 训练行数 / 是否被跳过）· `BarList` pairs 区间模式（前后 min–p50–mean–max 四点，一眼看出哪列还是几百量级 = 被 skip 了）
- **公式**：$z_j=\frac{x_j-\mu_j}{\sigma_j}$，$\sigma_j=\sqrt{\frac1n\sum(x_{ij}-\mu_j)^2}$（**总体口径**，`feature.py:182-186`）；minmax $z_j=\frac{x_j-\min_j}{\max_j-\min_j}$。逐列代入：$z_{\text{温度}}=\frac{x-27.75}{4.62}$
- **来源**：`fitted_json` 的 center/scale
- **后端**：**要**（fitted 出口 + skipped 列名 + train_rows）
- **必带口径卡**：「界面上这列的均值不会是 0」——列统计在**全帧**上算（`preview.py:91`），μ 只在**训练行**上拟合（`feature.py:102`）。不写清楚这会被当成「标准化没生效」
- **顺带修 D-9**：标准化后清空列的 `unit`（同文件已有专门换类型的 `with_column_cast` 这个先例）

#### 10. `one_hot` · 独热编码
- **块**：`breakdown`(charts, **isPrimary**) 类目命中 · `columns`(step) 列 diff · `fits`(table) 类目清单
- **图**：`BarList`（类目命中率降序，被 keep_top 砍掉的用 disabled 画在后面）· `DtTable`（类目 / 频次 / 是否保留 / 编码位）
- **公式**：$e_{j,c}(x)=\mathbb{1}[x=c]$，$c\in C_j$ 按 $(-\text{count},\ \text{字典序})$ 排；列名 $=\texttt{key=c}$。**单列一行**：$x\notin C_j \Rightarrow \mathbf{e}_j(x)=\mathbf{0}$（未知类目不报错、落全零）
- **来源**：`feature.py:330-335` 数完就丢的计数
- **后端**：**要**
- **⚠ 不做**：「1 − Σ命中率 = keep_top 砍掉的类目占比」这条零后端推断**归错了因**——`feature.py:387-389` 的 `_flags` 对 `value is None` 也返回全零，所以那个数是「未见过的类目」+「这一格本来就是空」两者之和。后端分成 `unseen_rows` 与 `blank_rows` 两项分别报

#### 11. `select_feature` · 特征筛选
- **块**：`breakdown`(charts, **isPrimary**) 打分排行 · `columns`(step) 保留 / 淘汰
- **图**：`BarList`（打分降序，保留实心 / 淘汰空心，第 k 与 k+1 名之间一条 top_k 切割线——**分数断层在哪比排名本身更能指导调参**）
- **公式**：variance $s_j=\frac1n\sum(x_{ij}-\bar{x}_j)^2$（**总体口径**）；correlation $s_j=\left|\frac{\sum(x-\bar{x})(y-\bar{y})}{\sqrt{\sum(x-\bar{x})^2\sum(y-\bar{y})^2}}\right|$（**只取两边都非空的行**，`reduction.py:343-349`）；保留 $=\operatorname{TopK}_k$ 按 $(-s_j,\text{key})$ 排
- **来源**：`reduction.py:173-175` 在 `sorted` 的 key 函数里现算现丢
- **后端**：**要**，且必须带 `degraded_reason`
- **⚠ 静默退化的真条件**：`services/graph_walk.py:53-69` 的 `split_plan_of` 调 `downstream_splits` **往下游走**，且 `len(splits) != 1` 就返回 `None`（实测已核）。所以退化有**两种**触发：① 下游零个切分（含「切分摆在本节点之前」）；② 下游**两个**切分。前端按「上游有没有 standardize / split」判的写法**方向是反的**，会在没退化时乱报、在真退化时抓不到。**由后端出布尔 + 原因文案**
- **连带告警**：`split_plan=None` 时 `training_frame`（`fitting.py:24-37`）是在**整帧**上拟合的 = 数据泄漏。同一条 note 里一并说
- **量纲敏感告警**：variance 档且上游链路上没有 standardize 时提示——**写成提示（「看起来…，如果是这样…」）而不是断言**，用户可能用别的方式满足了前提

#### 12. `pca` · 主成分降维
- **块**：`structure`(charts, **isPrimary**) 碎石图与载荷 · `columns`(step) 压缩说明
- **图**：`BarList`（各主成分解释方差比 + 累计折线）· `MatrixTable`（载荷 K 行 × J 列，正负双色，≤20×20）· `ScatterPlot`（pc1–pc2，前 200 行，**零后端**：head 里就有这两列）
- **公式**：$z_k=\sum_{j=1}^{J}w_{kj}(x_j-\mu_j)$，$W=\texttt{components\_},\ \boldsymbol\mu=\texttt{mean\_}$。**代入实参**：$\text{pc}_1=0.62(\text{温度}-27.75)+0.51(\text{负荷}-1380.4)-0.30(\text{湿度}-61.2)$
- **来源**：载荷与中心点在 `fitted_json`；**`explained_variance_ratio_` 是被主动丢掉的**——sklearn 拟合时就有，`estimators.py:280-300` 只取了 `mean_`(:286-289) 与 `components_`(:290-293)，全仓没有第二处算过它
- **后端**：**要**（`estimators.py` 保留解释方差 + report 出碎石图与载荷）
- **必带 note**：`matrix_of` 遇缺失即抛（`frame.py:152-172`），故 pca 隐含要求上游已填缺失

#### 13. `time_feature` · 时间特征
- **块**：`breakdown`(charts, **isPrimary**) 各档取值分布 · `axis`(step) 时区口径 · `columns`(step) 新增列
- **图**：`BarList`（hour 0-23 / dayofweek 0-6 / month 1-12 逐格计数，三组各一排；dayofyear 折成 12 个月，不出 366 项）· `StatCards` 周末样本占比
- **公式**：$t^{\text{local}}=t+\Delta$；$\texttt{ts\_hour}\in[0,23]$，$\texttt{ts\_dayofweek}\in[0,6]$（**周一 = 0**），$\texttt{ts\_month}\in[1,12]$，$\texttt{ts\_is\_weekend}=\mathbb{1}[\operatorname{weekday}\ge 5]$
- **来源**：`timefeature.py:179-202`
- **后端**：**要**（`tz_offset_minutes` + 低基数整数列的全帧 `value_counts`，上限 24 项）。低基数循环量的 min/p50/mean/max 毫无意义（「平均小时 11.5」说明不了任何事）
- **零后端的一格**：周末占比 = `ts_is_weekend` 的 mean（全帧口径、精确），只是今天被当普通均值渲染，没人会那样读

#### 14. `lag_feature` · 滞后特征
- **块**：`columns`(step) 新增列与实际档位 · `rows`(step) 头部空行
- **图**：`ScatterPlot mode=series`（原列与各 @lagL 列叠放，**零后端**：head 里两列同在。曲线整体右移 L 格是肉眼可验的，方向搞反是这类算子最常见的错）· `TimelineBand` 示意图
- **公式**：$x^{@\text{lag}L}_i=\begin{cases}x_{i-L} & i>L\\ \varnothing & i\le L\end{cases}$，列名 $=\texttt{key@lag}L$，$L\in\operatorname{sorted}(\operatorname{set}(\texttt{lags}))$
- **来源**：`window.py:262-270`；`OperatorSpec.serving_window_required`（`base.py:106`）已出 API
- **后端**：**几乎不要**（只需 `report` 记「配了 [1,1,3] 实际只造两列」）
- **必带两条 note**：① 前 L 行为空占 L/N，**填 0 会把「还没有历史」说成「历史上是 0」**；② **本步让整条流水线不可上线**（`SERVING_NEEDS_WINDOW`，今天这条后果只有到发布那一刻才知道）；③ 公式里写明「按**行序**而不是按时刻」（`window.py:7-8`，中间插了改行序的算子就整片错，图校验也拦不住）

#### 15. `rolling_feature` · 滚动统计
- **块**：`columns`(step) · `bins`(charts) 逐行有效样本数
- **图**：`ScatterPlot mode=series`（原列 vs 滚动列叠放，调 window 唯一的直观依据）· `ScatterPlot mode=series`（$m_i$ 曲线，降采样 ≤500 点）· `TimelineBand` 示意（**含不含当前行是最容易记反的一条**）
- **公式**：$S_i=\{x_t\mid i-W+1\le t\le i,\ x_t\neq\varnothing\}$，$m_i=|S_i|$；$y_i=\varnothing$ 若 $i<W$ 或 $m_i=0$；$\operatorname{std}=\sqrt{\frac{1}{m_i}\sum_{x\in S_i}(x-\bar{x})^2}$（**总体口径**）
- **来源**：`window.py:285-308`
- **后端**：**要**（$m_i$ 序列）
- **⚠ 这是一条会算错结论的真缺陷的可视化**：分母逐行不同——窗口内先滤掉空再按剩下的个数折，所以「近 3 期均值」在缺失多的段上可能只是 1 个点的值，而它与满窗口的均值在界面上长得一模一样。类注释（`window.py:148-150`）只承诺了「窗口不满给空」，没提「窗口内有空照算」

### model（4 个）

#### 16. `split_dataset` · 训练测试切分
- **块**（**全部 port=""，节点级**）：`rows`(step) 比例账 · `axis`(charts, **isPrimary**) 时间跨度 · `bins`(charts) 目标列分布 · `columns`(charts) 每列空值率两侧对比
- **图**：`TimelineBand`（一条水平轴画两段双色；**random 档下自动变成交叉散列——把未来数据泄漏画成一眼可见的交叉**）· `HistogramChart`（目标列训练/测试叠放；分类任务时它就是类目占比对比）· `BarList` pairs（每列空值率两侧——**某列只在时间轴后半段才有数据，是「训练时好好的、上线全空」最常见的来源，切分这一步是唯一能看见它的地方**）
- **公式**：$n_{\text{test}}=\min\bigl(\max(\lfloor N\cdot r\rfloor,1),\ N-1\bigr)$，$n_{\text{train}}=N-n_{\text{test}}$；time_order $\mathcal I_{\text{test}}=\{N-n_{\text{test}},\dots,N-1\}$；random $\pi=\operatorname{Permutation}(N;\texttt{random\_state})$。**代入并当场对照配置比例**
- **来源**：`frame.py:301-305`；帧摘要需补 `index_min`/`index_max`（今天只有前 200 个时间戳，训练集的**最后**一个时刻与测试集的**第一个**时刻都不在里面）
- **后端**：**要**
- **必带 note**：配 5% 而只有 10 行时实际给 1 行 = 10%（向下取整 + 夹取），用户会以为自己配错了
- **版式**：按 §3.4 的页签处理两路 FrameView；两路 provenance 相同时出处只印一次

#### 17. `linear_regression` · 线性回归
- **块**（port=""）：`fits`(formula, **isPrimary**) 模型公式与系数 · `structure`(stats) 训练分 vs 测试分 · `structure`(step) 共线性告警
- **图**：`FormulaBlock`（$\hat{y}=1403.2+3.21\cdot\text{温度}-0.84\cdot\text{负荷}$，**可抄走的一行式子，右上角复制成纯 ASCII**）· `DtTable` 系数表（值 / 符号 / **可比贡献 $\beta_j\sigma_j$**，排序可在 $|\beta|$ 与 $|\beta\sigma|$ 之间切）· `BarList` 权重条（**修好 D-1 与 D-5 之后才画得出来**）· scored 端口的 `ScatterPlot`×2 + `HistogramChart`（真值-预测 / 残差-预测 / 残差直方，**由 head 的 200 行前端现算，不必再接一个评估算子**，须标注「这 200 行来自摘要，time_order 下是测试段最早的 200 行」）
- **公式**：$\hat{y}=\beta_0+\sum_j\beta_j x_j$；$\hat{\boldsymbol\beta}=\arg\min\sum_i\bigl(y_i-\beta_0-\sum_j\beta_jx_{ij}\bigr)^2+\alpha\sum_j\beta_j^2$，$\alpha=0$（none）或 $\texttt{ridge\_alpha}$（ridge）；岭解 $(\tilde X^\top\tilde X+\alpha I)\boldsymbol\beta=\tilde X^\top\tilde y$，已中心化故截距不进惩罚项
- **来源**：`preview.fitted` 的 coef/intercept（已在传）
- **后端**：**要**（训练集 R²/RMSE、`rank_`/`singular_`、每列 σ）。秩亏时系数符号会整体翻过来而模型看着完全正常，这是「公式讲不通」最常见的真因
- **必带告警**：上游没有 standardize 时按 $|\beta|$ 排序会把单位小的列顶到最前——`diagnostics.py:141-145` 已经把这条坑写下来了，展示侧还在犯

#### 18. `logistic_regression` · 逻辑回归
- **块**（port=""）：`fits`(formula, **isPrimary**) 判别式与几率比 · `breakdown`(charts) 训练集类目占比 · `structure`(stats) 正类与收敛
- **图**：`FormulaBlock` · `BarList`（$\exp(\beta_j)$，零线在 1.0——「这一列每加 1 个单位，出事的几率乘几倍」是逻辑回归唯一能讲给业务听的读法）· `BarList` 堆叠（类目占比）
- **公式**：$z=\beta_0+\sum_j\beta_jx_j$；$p(x)=\sigma\bigl(\operatorname{clip}(z,-700,700)\bigr)=\frac{1}{1+e^{-z}}$；$\hat{y}=c_1$ if $p\ge 0.5$ else $c_0$，$(c_0<c_1)=\texttt{fitted.classes}$；$\hat{\boldsymbol\beta}=\arg\min\frac12\lVert\boldsymbol\beta\rVert_2^2+C\sum_i\log(1+e^{-\tilde y_i(\beta_0+\boldsymbol\beta^\top x_i)})$。业务读法：$\frac{p}{1-p}=e^{\beta_0}\prod_j(e^{\beta_j})^{x_j}$
- **来源**：`fitted.classes` **后端已在传**（`model.py:501-507`），`preview.ts:190-210` 一个字没读
- **后端**：**要**（类目计数、`n_iter_`/收敛、概率饱和行数）
- **必带三条 note**：① **这是过一层 sigmoid 再比 0.5**（今天那排权重条会被当成线性系数直接读，界面上没有任何一处拦这个误读）；② 阈值 0.5 是私有常量（`model.py:50`），既不是超参也不进摘要，类不平衡时用户改不了也看不见；③ penalty/solver 用的是 sklearn 默认（`estimators.py:198-200` 只传了 `fit_intercept` 与 `C`），公式里按默认写死并注明
- **本批不做**：ROC / PR / 校准 / 阈值扫描——打分帧只有硬标签没有概率（`model.py:477-499`，注释自认「那是下一轮的事」）。见 §12-Q5

#### 19. `tree_regressor` · 树回归
- **块**（port=""）：`structure`(charts, **isPrimary**) 重要性 / PDP / 训练区间 / 代表树 · `structure`(stats) 集成结构
- **图**：`BarList`（特征重要性——树没有系数，唯一能讲的就是它）· `ScatterPlot mode=series`（PDP，每特征 20 网格点，≤6 条。**树的「公式」只能用图讲，顺带把「不外推」直接画出来：曲线两端一定是平的**）· `BarList` 区间模式（每特征训练 min/max）· 缩进 if-else 规则列表（限深 3、≤31 节点）· scored 端口三张诊断图（树的散点会呈现特有的**横向条带**——分段常数的直接证据，是判断树深够不够的直观线索）
- **公式**：forest $\hat{y}(x)=\frac1M\sum_{m=1}^{M}T_m(x)$，分裂准则 $\Delta=\operatorname{Var}(S)-\frac{|S_L|}{|S|}\operatorname{Var}(S_L)-\frac{|S_R|}{|S|}\operatorname{Var}(S_R)$；gbdt $\hat{y}(x)=F_0+\nu\sum_m h_m(x)$，$F_0=\bar{y}$，**$\nu=0.1$（sklearn 默认，本仓未暴露，`estimators.py:437-441` 没传——必须按默认写死并注明「这个参数你改不了也看不见」）**。⚠ 两式都是分段常数：$x$ 落在训练区间之外时 $\hat{y}$ 恒为边界叶值
- **来源**：`TreeEnsemble.importances`（`estimators.py:414-423`）是现成属性，一个字都没往负载里放
- **后端**：**要**（本类最大的一笔）
- **⚠ 先撤两条假信息**：① D-4 的假警报（判据换成 `servingChannel === 'binary'` 时不看 `fitted`，**不能**改成「fitted 空就算没训出来」的反面——那会把线性模型真没训出来的情况一起放过）；② `ModelView.vue:27-30` 的「二进制产物，本轮不可上线」与 `publish_service.py:138-155` 的实际判据（通道 B 只判产物在不在）矛盾
- **⚠ 树结构必须限深限节点**：实测 127 节点 13.8KB、511 节点 56KB、2047 节点 229KB。**限深 3 / ≤31 节点是硬性的，不做成用户可调参数**——一旦可调，配到 5 层就会把整份 report 挤没，而表现是别的图无声消失
- **附带说明**：`feature_importance` 算子对树模型**直接抛错**（`diagnostics.py:258-260` 调 `load_fitted({})` 撞上 `trees.py:196-198`「树模型缺少特征列序」），所以树的重要性只能走这一条

### evaluate（5 个）

#### 20. `regression_metrics` · 回归评估
- **块**：`breakdown`(stats) 五个指标 · `bins`(charts) 残差直方 · `rows`(step) 截断口径 · `structure`(table) 分位与最差 N 行
- **图**：`ScatterPlot`（真值-预测，**补坐标轴 / 刻度 / 单位 / R² 标注并放开到主体宽**——今天锁在 18rem 且一个数字都没有）· `ScatterPlot`（残差-预测，由 pairs 前端现算，**异方差与系统性偏差 R² 一点也看不出来，而这是回归诊断的第一张图**）· `HistogramChart` + 均值线 + ±1σ 带 + 正态参考曲线 · `DtTable`（p05/p25/p50/p75/p95/max；最差 20 行含时刻）
- **公式**：$e_i=y_i-\hat{y}_i$；$R^2=1-\frac{\sum e_i^2}{\sum(y_i-\bar{y})^2}$（分母为 0 ⇒ **无定义，不写 0**）；$\text{RMSE}=\sqrt{\frac1n\sum e_i^2}$；$\text{MAE}=\frac1n\sum|e_i|$；$\text{MAPE}=\frac{100}{|Z|}\sum_{i\in Z}\frac{|e_i|}{|y_i|},\ Z=\{i:y_i\neq 0\}$；$\text{MaxErr}=\max|e_i|$。**五式全部代入本次实测值**
- **来源**：`pairs` 已在传
- **后端**：**要**（截前总行数 n、residual_mean/std、分位数组、最差 N 行）
- **⚠ 同屏两张图口径不一致**：`pairs` 是 `[:limit]` **头切**（`evaluate.py:117`，time_order 下是测试段最早的 500 行、有偏样本），而 `residual_bins` 在**全量**残差上算。**两件一起做**：后端把头切改成等距抽样；前端在两张图下各标一行口径（只改抽样不标注的话，「500 点 vs 全量」这条口径差仍在）

#### 21. `classification_metrics` · 分类评估
- **块**：`breakdown`(stats) 四个指标 · `structure`(charts, **isPrimary**) 混淆矩阵 · `breakdown`(charts) 类别分布 · `structure`(table) 每类 P/R/F1/支持度
- **图**：`MatrixTable`（**n×n，格子底色按行内占比取深浅**——按绝对计数会让类别不平衡时少数类整行看不见；对角线单独一个色相；右侧一列挂每类召回率与支持度，底部一行挂每类精确率与预测数，右下角放总数与准确率）· `BarList` pairs（真实占比 vs 预测占比——**模型是不是全押多数类，并排一看就穿帮**）
- **公式**：$\ell=\operatorname{sorted}(\{y\}\cup\{\hat{y}\})$，$C_{ij}=\#\{k:y_k=\ell_i\wedge\hat{y}_k=\ell_j\}$；$\text{Acc}=\frac{\sum_iC_{ii}}{\sum_{ij}C_{ij}}$；$TP=C_{pp},\ FP=\sum_{i\neq p}C_{ip},\ FN=\sum_{j\neq p}C_{pj}$；$P=\frac{TP}{TP+FP},\ R=\frac{TP}{TP+FN},\ F_1=\frac{2PR}{P+R}$。分母为 0 一律无定义——**把矩阵与公式并排放，用户自己就看懂精确率为什么是「无定义」**（没判过正类 / 判成正类的全错，两种情形）
- **来源**：**`labels` 与 `matrix` 后端一年前就在传**，且有单测钉住。每类 P/R/F1/支持度、行列合计、类别分布**全部由 matrix 前端推出**
- **后端**：**几乎不要**——这是全模块投入产出比最高的一屏。只补两件小事：`positive_label` 与空测试集检查
- **⚠ 正类匹配必须归一化**：config 的 `positive_label` 是 **float**（`evaluate.py:193`，default=1.0），而摘要里的 `labels` 是 **str**（`evaluate.py:328` 的 `_label_text`，1.0 → `"1"`）。**由后端出 `positive_label_text`**，前端只做字符串比对
- **⚠ 正类可能不在 labels 里**：`labels = sorted({*truth, *predicted})` 只从测试集取。类别极不平衡、模型全押多数类时正类既没出现也没被预测过 → 矩阵里**没有那一行**，P/R 双双 None。此时**不画正类徽标**，改成一条 danger note：「正类 `1` 在这份测试集里一次都没出现过，精确率与召回率无定义」
- **⚠ 空测试集**：回归评估会明确报错（`evaluate.py:134`），分类评估不检查（`evaluate.py:253-265`），四个指标全 None、矩阵空元组、界面一片空白。两侧对齐

#### 22. `residual_analysis` · 残差分析
- **块**：`breakdown`(stats) 五个统计量 · `bins`(charts, **isPrimary**) 残差直方 · `structure`(charts) QQ 与时间序列
- **图**：`HistogramChart` + 均值线 + ±1σ 带 + 同均值同方差的正态参考曲线（**一行后端都不用改**——mean 与 std 就在同一份 metrics 里，只是今天那个数和那张图是两块互不相干的界面元素，而这个算子的注释 `diagnostics.py:69-72` 说的就是这件事）· `BarList` 区间模式（p05 — p50 — p95，0 位标出）· `ScatterPlot`（残差-预测 / QQ）· `ScatterPlot mode=series`（残差按时间——**台账数据是时序的，工况切换造成的整段偏移在直方图上会被摊平成一个胖尾**）
- **公式**：$\bar{e}=\frac1n\sum e_i$，$s_e=\sqrt{\frac1n\sum(e_i-\bar{e})^2}$（**总体口径除 $n$**，`diagnostics.py:227`）；$Q(q)=e_{(\lfloor t\rfloor)}+(e_{(\lceil t\rceil)}-e_{(\lfloor t\rfloor)})(t-\lfloor t\rfloor),\ t=q(n-1)$（**分位数插值口径各家不同，写出来才对得上别处的数**）；分桶 $w=\frac{\max e-\min e}{B}$
- **后端**：**要**（本算子不产出 `pairs`；p50；51 个等距分位点；时间索引——数据在 `model.py:318` 已跟到打分帧上，但 `payloads.py:26-41` 没有承载它的字段）
- **⚠ 时间序列是本批最大的一块**，必须标 tier 2 + zone charts 非 isPrimary
- **顺带修**：五个键补中文名（偏均值 / 离散度 / 5% 分位 / 95% 分位 / 最大绝对误差）；今天界面直接印 `residual_p05` 这样的裸 snake_case，画布卡片那行**永远是空的**

#### 23. `feature_importance` · 特征重要性
- **块**：`breakdown`(charts, **isPrimary**) 重要性排行 · `structure`(stats) 基线分
- **图**：`BarList`（**降序、正负分色、零线居中、条上印 Δ 值、每条带 R 次重复的误差棒**——今天是一排既不排序也不可比的灰标签，顺序是 `feature_keys` 原序）· `BarList` pairs（基线 vs 打乱后）· `ScatterPlot mode=series`（累计重要性曲线 + 80% 线，直接回答「留几列就够了」）
- **公式**：$I_j=\frac1R\sum_{r=1}^{R}\bigl[s(y,f(X))-s(y,f(X^{\pi_{j,r}}))\bigr]$，$s=R^2$（回归）或 $\text{Acc}$（分类）；$X^{\pi_{j,r}}$ 只把第 $j$ 列按种子 $(\texttt{random\_state}+r)$ 的置换重排。$I_j>0\Rightarrow$ 这列在起作用；$I_j\le 0\Rightarrow$ 打乱反而没变差，**是噪声列**（一个可以直接行动的结论，现在它只是一个不起眼的负号）
- **来源**：`diagnostics.py:199-215` 的 baseline 与 drops
- **后端**：**要**（搬进 `breakdown` + baseline + 逐列 spread + score_kind + 列中文名）
- **必带 note**：同一个 0.12 在 R²=0.9 的模型上是砍掉 13% 的解释力，在 R²=0.2 上是砍掉 60%——没有基线分读不出来

#### 24. `cross_validate` · 交叉验证
- **块**：`breakdown`(charts, **isPrimary**) 逐折分数 · `axis`(charts) 折布局 · `rows`(step) 配置 vs 实得
- **图**：`BarList`（逐折分数柱 + 均值横线 + ±σ 带 + 最差折高亮——**这正是算子注释 `diagnostics.py:459-461` 自己说的「这条评估要说的事」，而现在只给了一个 σ，看不出是某一折特别差还是普遍抖**）· `TimelineBand`（每折一行，训练段与测试段按行区间画成两色横条）
- **公式**：$w=\lfloor N/K\rfloor$，$T_k=[kw,(k{+}1)w)$（末折吃余数）；前向链 $\text{Tr}_k=[0,kw)\Rightarrow k=0$ 无训练行、**整折丢弃，实得 $M=K-1$**；K 折 $\text{Tr}_k=\{0..N{-}1\}\setminus T_k\Rightarrow M=K$（⚠ **时序数据会拿未来训过去**）；$\bar{s}=\frac1M\sum s_k$，$\sigma=\sqrt{\frac1M\sum(s_k-\bar{s})^2}$，$s_{\min}=\min_k s_k$
- **来源**：`diagnostics.py:391-396` 的 scores 列表在 :399 被 `_summary` 折成四个标量；`_folds` 的下标（:404-431）只喂给 `_fold_score`
- **后端**：**要**（`fold_scores[≤20]` + `fold_spans[≤20]` + method + configured_folds + score_kind。折数上限 20，字节可忽略）
- **必带两条**：① 「配置 5 折 · 实得 4 折 · 前向链」说明条（今天 `folds=3` 与配置里的 4 对不上，界面没一个字解释）；② 稳定性判读 $\sigma/|\bar{s}|$ 三档（σ=0.03 是好是坏取决于均值多大，**替用户做这一步除法是有根据的**，不同于 MAE 那种量纲问题）
- **顺带修**：四个键补中文名；画布卡片那行今天是空的

---

## 6. 公式渲染方案

### 决策：HTML + CSS 手排，骨架在前端、实参从摘要与 config 代入。不引 KaTeX / MathJax，不用 MathML。

**为什么不引 KaTeX**（离线、包体、主题、无障碍四条全占）：
- **离线无 CDN**：产品跑在工控内网。KaTeX 的公开发布件是 JS 数十 KB gzip + **一整套 woff2 数学字体（约 60 个文件）** + 一份必须**全局引入**的 dist CSS，全部要打进产物。仓里已有前科：nginx 不认 `.mjs`、字体走 CDN 在内网拿不到。
- **包体敏感**：全局 dist CSS 计入首屏 **100KB CSS 预算**（`scripts/gates/check_bundle_budget.py:20-23`）；样式表只能是 `.scss`（`check_web_styles.py:96-120`），第三方 dist CSS 只能经 `.scss` 转手；引依赖还要单独的锁文件 PR + 许可闸（KaTeX 是 MIT，进白名单，但流程照走）+ 一份 ADR（引新依赖类别是 ADR 的四条触发条件之一）。
- **跟随暗色主题**：主题引擎把 token 写成宿主元素的**内联变量**（`packages/tokens/src/theme.ts:30-57`），HTML 排的公式六套预设白拿；KaTeX 的内建配色要另行覆盖。
- **无障碍**：HTML 公式就是普通文本——读屏原生朗读、可选中、可复制（KaTeX 的 HTML 输出选中复制是乱的）、能被 Ctrl+F 找到。
- **需求量根本不够**：本模块真正需要二维排版的只有**分式 8 处、根号 3 处、Σ 上下限 4 处**，其余全是行内线性式。

**为什么不用 MathML**：零依赖、常青浏览器都支持（构建目标 `es2022`，`web/app/vite.config.ts:44`），但字形依赖**系统数学字体**——Linux 容器里若无 STIX 会退化成普通字形，且不带自动断行。本产品要在客户现场的 Windows 与容器里都长一个样。

### 数据模型：公式**不进摘要**

公式随算子代码走、不随运行走。放摘要里等于每次运行把同一串常量重传一遍还要吃字节预算。

```ts
// scripts/formula.ts
type FormulaNode =
  | { node: 'run';   terms: FormulaTerm[] }
  | { node: 'frac';  over: FormulaNode[]; under: FormulaNode[] }
  | { node: 'sqrt';  of: FormulaNode[] }
  | { node: 'sum';   from: string; to: string; of: FormulaNode[] }
  | { node: 'cases'; rows: { when: string; then: FormulaNode[] }[] }
interface FormulaTerm { text: string; kind: 'var' | 'num' | 'op' | 'name' | 'warn' }
```

- **骨架**在 `scripts/formulaCatalog.ts`，按 `operator code + formula id` 建键。
- **实参**从 `report` / `preview.fitted` / `ModelingRun.graph.nodes[].config` 取。config 是**运行时冻结的快照**，所以 `tolerance_ms` / `threshold` / `k` / `test_ratio` / `method` / `lags` / `window` 这些「参数不进摘要」的问题**零后端**解决，历史回看也正确。

**排版**：分式 = 两行 + `border-top: 1px solid currentColor`；根号 = `√` + 一个带 `border-top` 的 span；上下标 `<sub>/<sup>`；`cases` = 左侧 `border-left` + grid 两列。变量名 `--font-mono`，数值 `--font-digit`，运算符前后各 `0.25em`。

**折行**：`display:flex; flex-wrap:wrap; column-gap:.25em`，每一「项」（`+ 3.21·温度`）是一个不可断的 `<span class="term">` → **换行只发生在运算符前，永不断在变量名中间**。这是 CSS 天然能做而 KaTeX 做不到的。

**两态**：
- 符号态（折叠时那一行）：`ŷ = β₀ + Σ βⱼ·xⱼ`
- 代入态（展开）：`ŷ = 1403.2 + 3.21·温度 − 0.84·负荷`

**默认展开规则**（防评审 3 挑出的「十几处默认展开把一屏拉到十几屏」）：
- **有实参且实参就是结论**的展开：`clip_outlier` 的定界、`standardize` 的 z、`linear`/`logistic` 的判别式、`pca` 的 pc 展开、`split_dataset` 的 $n_{\text{test}}$。共 6 处。
- **纯口径说明**的折叠：MAPE 定义、分位数插值、总体 vs 样本标准差、各类 keep 判据。指标为 `null` 时对应那一条**自动展开**（回答「为什么是无定义」）。

**复制**：右上角一个按钮，复制**纯文本 ASCII**：`y = 1403.2 + 3.21*温度 - 0.84*负荷`。**不复制 LaTeX**——用户要拿它去 Excel 或台账 `PREDICT()` 公式里核对，LaTeX 对他没用。

**代价**：`formula.ts` ~110 行 + `formulaCatalog.ts` ~280 行 + `FormulaBlock.vue` ~140 行 = 约 530 行、零依赖、零字节、全部可被行覆盖闸覆盖。

**复议条件**（写进 `formula.ts` 文件头）：若将来要展示矩阵推导、多行等式对齐或积分超过三处，再单独开 ADR + 锁文件 PR 引 KaTeX。

---

## 7. 图形方案

### 决策：全部自绘（SVG + HTML），一个 echarts 都不引。

**理由（三条硬事实 + 一条同类先例）**：
1. **app 侧根本拿不到 echarts**：`web/app/package.json` 未声明，pnpm 不提升，`web/app/node_modules` 下没有 echarts 目录。走 echarts 必须在 `@dt/ui` 新开组件并改那份**全局共享**的 `packages/ui/src/shared/chart/echarts.ts:24-30` 的 `use` 清单（今天只注册了折线一族 + Grid/Legend/Tooltip/CanvasRenderer），影响所有既有消费方。
2. **`@dt/modules` 那套 chartKit 够不着**：有测试、功能齐全（17 种 series + visualMap + 色阶），但既没从 barrel 导出、又零消费方，深链被 `scripts/gates/check_structure_web.py:33,87` 直接打回。要用得先开一个「把 chart 基础设施提升进公开面」的**独立 PR**，不在美化 PR 里顺手做。
3. **换肤白拿**：SVG/CSS 吃级联，六套预设零成本；canvas 不吃，echarts 要在 JS 里读 CSS 变量 + `observeThemeChange` 后整图 `setOption`，项目已为图表实例泄漏吃过亏。
4. **同类先例**：`docs/AC_MODEL_UI_DESIGN.md:660-676` 的「继续手写 SVG，不加 echarts 的 ScatterChart」，四条理由与明确复议条件。**ADR-0028/0036 不是依据**——那两条答的是「要不要引 vue-flow 这类**图编辑框架**」，与统计图无关。

> **复议条件**：单张图点数常态超过 5000 且用户明确需要框选下钻。本规格所有图的点数上限都在 500 以内（`max_scatter_points` 默认 500、bins ≤40、occupancy ≤200、breakdown ≤60），离触发很远；触发时正解也未必是 echarts，可能是 canvas。

### 逐类定型（六个图元件，多对一服务 24 个算子）

| 图元件 | 技术 | 为什么 | 服务的算子数 |
|---|---|---|---|
| `BarList.vue` | **HTML**（不是 SVG） | 名称要跟条子对齐、要能 `text-overflow`、右侧要挂读数。`docs/MODELING_DESIGN.md:1336` 对特征权重条已定过同款口径 | **18** |
| `HistogramChart.vue` | SVG | 一排矩形 + 若干参考竖线 + 一条参考曲线 | **9** |
| `ScatterPlot.vue` | SVG | 一层点 + 参考线/带；`mode: pairs \| residual \| series \| qq` 四态 | **9** |
| `TimelineBand.vue` | SVG | 一条轴上若干段 + 断档 + 交叉散列 | **6** |
| `MatrixTable.vue` | **HTML（走 `DtTable`）** | 格子里要印数字、行列表头要对齐、右侧与底部要挂边栏。页面**禁手写 `<table>`**（`check_web_styles.py:164-178`）。走 echarts heatmap 要引 HeatmapChart + VisualMap 两个组件，还得另配数字与对齐 | 2 |
| `FormulaBlock.vue` | HTML | §6 | **24** |

**`BarList` 的四种 mode**（这是「同一个语义同一个外形」的落点）：`single`（排行）· `pairs`（前后对比）· `stacked`（三分/占比）· `range`（min–p50–max 区间条 + 均值打点）。**15 个产 frame 的算子的前后对比全部走 `pairs`**，不因算子而异。

### 配色与暗色主题

- **只用 token，源码零色值字面量**（`check_ts_style.py:52-61` 禁十六进制 / `rgb()` / `hsl()` 字面量）。
- **半透明只能用有 `-rgb` 伴生三元组的八个**：`accent-primary` / `accent-secondary` / `state-success` / `state-warning` / `state-danger` / `state-info` / `text-title` / `neutral-fg`。写法一律 `rgba(var(--x-rgb), α)`。
- **系列色沿用既定顺序**（`packages/ui/src/shared/chart/lineOption.ts:13-20`）：`--accent-primary` → `--state-success` → `--state-warning` → `--state-danger` → `--accent-secondary` → `--state-idle`。
- **语义映射**：主序列/「之后」= `--accent-primary`；「之前」= `--text-disabled` **空心描边、无填充**（不用两个色相——两个色相在六套预设下的对比关系不稳定）；丢弃/被改写 = `--state-warning` **+ 斜纹 pattern**；越界 = `--state-danger` **+ 1px 边框**；参考线 = `--border-strong` 虚线；阈值线 = `--state-warning` 虚线 + 文字标签。
- **⚠ 热力格子必须铺不透明底**（评审 3 挑出、三份提案全缺）：`--surface-raised` 在暗色是 `rgba(0,80,160,0.15)`、弹窗面板是 `--surface-overlay: rgba(0,10,30,0.9)`，背后还有 `backdrop-filter: blur(2px)` 压着一张会动的画布。直接叠 `rgba(--accent-primary-rgb, α)` 会在暗夜紫主题下把 3% 与 12% 的格子糊成一片。**做法**：`MatrixTable` 的格子容器先铺一层 `background: var(--surface-panel)` 的**实底**（不透明化：用 `color-mix(in srgb, var(--surface-panel) 100%, transparent 0%)` 无用——直接给矩阵容器一层 `--surface-raised` 之上再叠一层同色实心 div），格子色用 `color-mix(in oklab, var(--accent-primary) calc(α*100%), var(--surface-raised))`，α ∈ [0.12, 0.72]，α>0.45 时文字切 `--text-on-emphasis`。**验收要求：六套预设各截一张图人工核对**（§10）。
- `packages/*` 里**不许出现任何 Tailwind 工具类**（`check_web_styles.py:51-77`）。六个图元件全在 `app/src/pages/` 下，但**统一用 scoped SCSS + `var()`** 而不是 Tailwind 语义类——Tailwind 类名写错（`fill-accent-main`）静默无样式且**没有闸门拦**，而 `var()` 有 css-variables 契约闸覆盖。

### 长列名截断口径（评审 3 点名，三份提案全缺）

`FrameView` 的 `headColumns` 给动态列**不设 width**，一个「1#冷冻水泵出口温度」当表头就能把 200 行表撑到几个屏宽。统一口径：
- 表头与条形的名称列：`max-width: 12rem; overflow:hidden; text-overflow: ellipsis; white-space: nowrap`，配 `DtTooltip` 出全名。
- `MatrixTable` 的行列名：`max-width: 8rem` 同款。
- 公式里的变量名**不截断**（它是结论的一部分），靠 §6 的项级折行处理。

---

## 8. 新增与改动的文件清单

### 8.1 后端新增（`server/services/platform-server/src/platform_server/apps/modeling/`）

| 路径 | 职责 | 行 |
|---|---|---|
| `operators/reporting.py` | `ReportBlock` dataclass + 8 种 block 的构造函数 + `BLOCK_KINDS` / `ZONES` 花名册（契约测试遍历它） | 190 |
| `operators/steps.py` | 块的算料：分箱、占用降采样、归因聚合、样例值截取、漏斗 | 290 |
| `operators/modelstats.py` | 训练分、共线性判读、PDP 网格、每特征训练区间、限深代表树序列化 | 250 |
| `services/report_budget.py` | `REPORT_MAX_BYTES` 裁剪：按 zone 优先级降档、`dropped` 留痕、逐块硬上限 | 130 |
| `migrations/versions/xxxx_add_report_json.py` | 扩展步：`modeling_node_runs` 加 `report_json`（nullable JSONB，无回填，`lock_timeout`） | 40 |

### 8.2 后端改动

| 路径 | 改什么 | 增删行 |
|---|---|---|
| `services/preview.py` | `fit_budget` 走完 `_stripped` 复量 + 再降一档；`_stripped` **扩黑名单**；`_column_stat` 补 `coerce_failed`/`std`/`p25`/`p75`；帧摘要补 `index_min`/`index_max` | +70 |
| `services/run_executor.py` | `_Budget.take` 按实际字节记账；合并 `result.report` | +25 |
| `services/node_task.py` | `NodeResult.report` 字段 + `report=operator.report()` | +10 |
| `services/run_dispatch.py` | 落 `report_json` | +8 |
| `services/presenters.py` | `to_node_out` 装 `report` 与 `fitted` | +8 |
| `schemas/run.py` | `NodeRunOut` 加 `report` / `fitted` | +6 |
| `models/run.py` | `report_json` 列 | +6 |
| `operators/base.py` | `report()` 默认 `()` | +12 |
| `operators/estimators.py` | 保留 PCA `explained_variance_ratio_`、线性 `rank_`/`singular_`、逻辑 `n_iter_`+类目计数、树 `importances`/深度/叶子数 | +90 |
| `operators/source.py` · `join.py` · `cleaning.py` · `preprocess.py` · `feature.py` · `reduction.py` · `timefeature.py` · `window.py` · `model.py` · `trees.py` · `evaluate.py` · `diagnostics.py` | 各算子的 `report()`（10–40 行 / 个，逻辑一律外置到 `steps.py`/`modelstats.py`） | +520 |
| `operators/payloads.py` | `MetricsPayload` 加 `breakdown` / `n` / `positive_label_text` / `quantiles` / `worst_rows` / `fold_layout` / `pairs`（残差分析） | +30 |
| `operators/join.py` | `_nearest` 改双指针（顺带降复杂度） | +25 |
| `operators/feature.py` | 标准化后清 `unit`（D-9） | +6 |
| `operators/evaluate.py` | `pairs` 头切改等距抽样；分类补空测试集检查；`positive_label_text` | +30 |
| `openapi.json` | 重导（**不计入 PR 行数**） | — |

**⚠ 拆分前置**：`operators/cleaning.py` 实测 **577/600**（装 4 个算子）、`operators/model.py` 实测 **580/600**（装 3 个）。两者都要先拆，见 PR-0。

### 8.3 前端新增（`web/app/src/pages/Modeling/Canvas/`）

| 路径 | 职责 | 行 |
|---|---|---|
| `components/ReportBlocks.vue` | **唯一**块派发点：按 `ZONE_ORDER` 分区 → 按 `block.kind` 查常量表 → `<component :is>`；查不到交给 `UnknownBlock` | 100 |
| `components/StepSummary.vue` | ① 区：gist + 参数 chips + 账 + note | 130 |
| `components/StatCards.vue` | ② 区：指标卡网格（`DtCard` + `DtDigits` + `DtTag` + `DtHelpTip`） | 100 |
| `components/BarList.vue` | 图元件：四 mode 横条（HTML） | 210 |
| `components/HistogramChart.vue` | 图元件：直方 + 参考线 + 双色 + 正态曲线 + 离轴柱 | 240 |
| `components/ScatterPlot.vue` | 图元件：四 mode 散点（由 `ScatterChart.vue` 升级） | 250 |
| `components/TimelineBand.vue` | 图元件：时间/行区间段 | 190 |
| `components/MatrixTable.vue` | 图元件：n×n 热力表 + 边栏（`DtTable`） | 210 |
| `components/FormulaBlock.vue` | ④ 区：公式（自引用递归） | 140 |
| `components/UnknownBlock.vue` | 认不出的块：照实说明 + 折叠 JSON | 45 |
| `components/UnknownView.vue` | 兑现 §8.4 的「格式化 JSON 兜底」，替换 `ResultView.vue:93` 的 `DtEmpty` | 55 |
| `components/TruncationNotice.vue` | 四档截断 | 85 |
| `components/ProvenanceBar.vue` | ⑥ 区：出处 + 下载 | 65 |
| `scripts/reportBlocks.ts` | `report` 的类型与安全读取器（全部走既有 `asRecord/asNumber/asList`，**禁 `as` 断言**） | 200 |
| `scripts/zones.ts` | `ZONE_ORDER` 常量 + 分区归组 | 45 |
| `scripts/formula.ts` | `FormulaNode` 模型 + 纯 ASCII 序列化 | 110 |
| `scripts/formulaCatalog.ts` | 24 个算子的公式骨架与代入函数 | 280 |
| `scripts/svgScale.ts` | `bounds`（含全等值时人为撑开跨度免除零）/ `project` / `niceTicks`，从 `ScatterChart`+`ResidualChart` 抽出共用 | 75 |
| `scripts/matrixStats.ts` | 由 `labels`/`matrix` 推每类 P/R/F1/支持度、行列合计、真实 vs 预测占比 | 85 |

### 8.4 前端改动

| 路径 | 改什么 | 增删行 |
|---|---|---|
| `components/ResultView.vue` | 六区骨架 + 节点级/端口级分层 + 锚点条 + 多端口页签 | +90 |
| `components/ResultDialog.vue` | `width` → `min(72rem, 92vw)` | +2 |
| `components/FrameView.vue` | D-6 触顶文案方向；`ROLE_LABELS` 删幽灵 `index` 补 `ignored`；列统计表 `sortable`；空值率横条；「完整数据」默认折叠 + `max-height` 内滚 | +80 |
| `components/ModelView.vue` | D-1 颜色、D-4 判据换 `servingChannel`、D-5 条基准、可服务性文案；权重条抽进 `BarList` | +60 |
| `components/MetricsView.vue` | 拆成派发外壳（回归三件套→`ScatterPlot`/`HistogramChart`，分类→`MatrixTable`，breakdown→`BarList`）；原生 `:title` → `DtHelpTip`；「量纲免责」文案改对；`isPairsTrimmed` | −40/+70 |
| `components/ResidualChart.vue` | **删除**，调用点改 `HistogramChart` | −111 |
| `components/ScatterChart.vue` | **改名升级**为 `ScatterPlot.vue` | — |
| `components/CanvasMenu.vue` · `CanvasToolbar.vue` · `EditorCanvas.vue` · `ModelingNode.vue` | D-1 的另外 7 处非法颜色 | +7 |
| `scripts/preview.ts` | 读 `classes` / `labels` / `matrix` / `indexMs`（毫秒原值）/ `isPairsTrimmed`；`isFitted` 判据 | +55 |
| `scripts/numbers.ts` | D-2：`niceNumber` 改真四位有效数字 + 极小量走指数；注释一并改对 | +18 |
| `scripts/nodeHeadline.ts` | D-3：删 `short()` 改用 `niceNumber`；白名单补 `score_mean`/`residual_mean` 等 | +20 |
| `scripts/metricBands.ts` | 补 9 个键的中文名（`residual_*` 5 + `folds`/`score_*` 4）；`unknown` 档提示文案改对 | +30 |
| `scripts/useResultPanel.ts` | 取 `report` / `fitted` | +18 |
| `packages/contracts/src/modeling.ts` | `ModelingNodeRun` 加 `report` / `fitted` | +6 |

**⚠ 净增量必须为 0 的两个文件**：`Canvas/index.vue` 实测 **490/500**、`scripts/useCanvasPage.ts` 实测 **199/200**。所有新接线进 `ResultView` 或新 `scripts/`。

---

## 9. 分期与 PR 切分

**约束**：≤400 变更行、≤20 文件、`server/services` 下只碰 1 个服务（`web/` 不计入服务数，故后端 + 前端可同 PR，但行数跨两侧合计）。`openapi.json` / `dist` / `coverage` 不计入行数。**本次改动没有任何功能性规模豁免可用**——三类豁免（机械化 / 新代码单元首次落地 / 新大屏模块首次落地）里只有第一类适用于 PR-0。

### 阶段一：先修（4 个 PR，一周内可全绿）

| PR | 范围 | 行 | 服务 | 依赖 |
|---|---|---|---|---|
| **PR-0** | `[机械] refactor(platform-server)`：拆 `cleaning.py`(577/600) 与 `model.py`(580/600)，纯文件搬运不改一行逻辑。**挂机械化豁免** | ~600（豁免） | platform-server | — |
| **PR-1** | `fix(web)`：D-1 的 11 处非法颜色 + D-6 触顶文案方向 + `ROLE_LABELS` + D-5 权重条基准。纯样式与文案，逐行可评审 | 90 / 8 文件 | web | — |
| **PR-2** | `fix(web)`：D-2 `niceNumber` 改真四位有效数字 **+ D-3 删 `nodeHeadline.short()` 复制品**（两处必须同批，否则同一个数在卡片与弹窗里显示成两样）+ 一条「两处口径一致」的用例 | 120 / 5 文件 | web | — |
| **PR-3** | `fix(web)`：D-4 树模型假警报（判据换 `servingChannel === 'binary'`）+ 可服务性旧文案 + D-8 `isPairsTrimmed`。**⚠ 现有用例不会红**（夹具 `serving_channel:'json'`，实测已核），必须**新增**两条用例：通道 B 的模型不许被说成没训出来 / 通道 A 的 `fitted:{}` 仍要报 | 150 / 4 文件 | web | — |

### 阶段二：零后端的兑现（4 个 PR，投入产出比最高）

| PR | 范围 | 行 | 依赖 |
|---|---|---|---|
| **PR-4** | `feat(web)`：`svgScale.ts` + `HistogramChart.vue`（由 `ResidualChart` 升格，含退化分支用例：空数据 / 全同号 / 单箱 / 负区间） | 380 / 5 | PR-1 |
| **PR-5** | `feat(web)`：`BarList.vue` 四 mode + 退化分支用例（空列表 / 全零 / 全负 / 单项 / 超 60 项截断） | 390 / 4 | PR-1 |
| **PR-6** | `feat(web)`：`matrixStats.ts` + `MatrixTable.vue` + `preview.ts` 读 `labels`/`matrix`/`classes` + 退化用例（1×1 / 20×20 / 正类不在 labels 里 / 空矩阵） | 400 / 6 | PR-5 |
| **PR-7** | `feat(web)`：`MetricsView` 拆成派发外壳 → 分类评估落地（混淆矩阵 + 每类 P/R/F1/支持度 + 类别分布 + 正类判定）+ `metricBands` 补 9 键与文案修正 | 390 / 8 | PR-6 |

> 阶段二结束时，分类评估从「一张图都没有」变成全模块最完整的一屏，**后端一行都没改**。

### 阶段三：字节账与契约（3 个 PR，无 UI 变化）

| PR | 范围 | 行 | 服务 | 依赖 |
|---|---|---|---|---|
| **PR-8** | `fix(platform-server)`：`fit_budget` 复量 + `_stripped` 扩黑名单 + `run_executor` 按实际字节记账 + **一条用非帧摘要喂的上限用例** + 一条钉住「按实际字节」新语义的用例 | 180 / 4 | platform-server | PR-0 |
| **PR-9** | `feat(platform-server)`：`report_json` 迁移（单独提交）+ `ReportBlock`/`reporting.py` 花名册 + `NodeResult.report` + `run_dispatch` + `NodeRunOut.report`/`fitted` + `presenters` + **重导 `openapi.json`** + 契约用例。**零算子接入**，所有 `report()` 返回 `()` | 330 / 12 | platform-server | PR-8 |
| **PR-10** | `feat(web)`：`reportBlocks.ts` + `zones.ts` + `ReportBlocks.vue` + `UnknownView`/`UnknownBlock`/`TruncationNotice`/`ProvenanceBar` + `ResultView` 六区骨架 + `ResultDialog` 宽度 + 契约类型 + **块 kind 双向契约测试** | 400 / 14 | web | PR-9 |

### 阶段四：算子接入（10 个 PR）

| PR | 范围 | 行 | 服务 | 依赖 |
|---|---|---|---|---|
| **PR-11** | `feat(platform-server)`：`steps.py` + `report_budget.py` + `ledger_source` / `ledger_join` 的 `report()`（含 `coerce_failed` 进列统计、`_nearest` 双指针） | 390 / 8 | platform-server | PR-9 |
| **PR-12** | `feat(platform-server)`：`cast_type` / `drop_missing` / `filter_rows` 的 `report()` | 350 / 6 | platform-server | PR-11 |
| **PR-13** | `feat(platform-server)`：`resample`（含 `tz_offset_minutes`、`position_of` 提循环外）/ `fill_missing` / `clip_outlier` 的 `report()` | 390 / 7 | platform-server | PR-11 |
| **PR-14** | `feat(platform-server)`：`standardize`（含清 `unit`）/ `one_hot`（unseen 与 blank 分开）/ `select_feature`（`degraded_reason` 按 `len(downstream_splits)!=1` 的真条件） | 380 / 7 | platform-server | PR-11 |
| **PR-15** | `feat(platform-server)`：`estimators.py` 保留 PCA 解释方差 + `pca` / `time_feature` / `lag_feature` / `rolling_feature` 的 `report()` | 370 / 7 | platform-server | PR-11 |
| **PR-16** | `feat(web)`：`ScatterPlot.vue` 升级（四 mode + 轴刻度 + 参考带）+ `TimelineBand.vue` + 退化用例 | 390 / 5 | web | PR-10 |
| **PR-17** | `feat(web)`：`StepSummary` / `StatCards` / `ProvenanceBar` 落地 + source + preprocess 九个算子的块渲染接线 + 四档截断空态 | 390 / 8 | web | PR-16 |
| **PR-18** | `feat(web)`：feature 七个算子的块渲染接线（含 pca 载荷热力、one_hot 命中条、select_feature 排行与两条告警） | 350 / 6 | web | PR-17 |
| **PR-19** | `feat(platform-server)`：`modelstats.py` + `split_dataset`（含 `index_min/max`、provenance 说明）/ `linear_regression`（训练分 + 秩亏 + 每列 σ）/ `logistic_regression`（类目计数 + 收敛）的 `report()` | 390 / 8 | platform-server | PR-13 |
| **PR-20** | `feat(platform-server)`：`tree_regressor` 的 `report()`（`importances` + 集成结构 + 训练区间 + PDP + 限深代表树） | 380 / 5 | platform-server | PR-19 |

### 阶段五：公式与评估收口（3 个 PR）

| PR | 范围 | 行 | 服务 | 依赖 |
|---|---|---|---|---|
| **PR-21** | `feat(web)`：`formula.ts` + `FormulaBlock.vue` + `formulaCatalog.ts` 的 model 类四条 + 复制成 ASCII + **formula id 双向契约测试** | 390 / 6 | web | PR-16 |
| **PR-22** | `feat(platform-server)`：evaluate 五个算子——`breakdown` 字段 + `feature_importance` 搬出 `metrics` + `cross_validate` 逐折与折布局 + `residual_analysis` 的 pairs/时间索引/51 分位 + 回归的截前行数/分位/最差 N 行 + 头切改等距抽样 + 分类空测试集检查 | 390 / 7 | platform-server | PR-13 |
| **PR-23** | `feat(web)`：evaluate + model 的块渲染接线 + `formulaCatalog` 补齐其余 20 条 + 六套主题截图核对 + 多端口页签 | 400 / 9 | web | PR-21, PR-22 |

**合并节奏**：main 的并发组只留一个 pending run，连着合会让中间几个提交 cancelled 且零作业。**一次最多合两个 PR，然后盯完那轮流水线再合下一批。**

---

## 10. 测试策略

### 10.1 逐期要加的测试

| 期 | 类型 | 锁什么 |
|---|---|---|
| PR-1 | 视图用例 | 每个改过颜色的组件断言「计算后的 fill/background 不是黑/不是 transparent」；触顶文案的方向（断言文案里有「最新」「靠前」） |
| PR-2 | 单元 | `niceNumber(3e-5)` 不是 `'0'`；**`nodeHeadline` 与 `numbers` 对同一个数给同一串**（这条是 D-3 的守） |
| PR-3 | 视图 | **新增**：`servingChannel:'binary'` + `fitted:{}` ⇒ 不报「没训出来」；`servingChannel:'json'` + `fitted:{}` ⇒ 仍报。⚠ 现有 `preview.test.ts:111-117` 不会红（夹具是 `'json'`），不能当成守 |
| PR-4~6 | 视图 + 单元 | **每个图元件的全部退化分支**：空数据 / 全等值（人为撑开跨度免除零）/ 全同号 / 负区间 / 单项 / 单箱 / 1×1 矩阵 / 零方差列 / 超上限截断。增量覆盖 ≥85% 全靠它 |
| PR-7 | 视图 | 正类不在 labels 里 ⇒ 不画徽标、出 danger note；空矩阵 ⇒ 出空态不崩 |
| PR-8 | 后端单元 | **用非帧摘要（metrics / model）喂的字节上限用例**（现有那条只喂帧）；`_stripped` 之后仍超时再降一档；`_Budget` 按实际字节的新语义 |
| PR-9 | 后端契约 | `NodeRunOut` 顶层键集；`openapi.json` 逐字节同步 |
| PR-10 | 前端契约 | **块 kind 双向**（见下）；`ZONE_ORDER` 常量与渲染顺序一致 |
| PR-11~15,19,20,22 | 后端单元 | 每个算子的 `report()` 产出形状 + **该算子最坏负载的字节断言**（见下） |
| PR-17,18,23 | 视图 | 夹具**照抄后端单测的真实产出**；四档空态各一条 |
| PR-21 | 前端契约 | **formula id 双向**；代入实参后的 ASCII 序列化 |

### 10.2 四条必须新建的契约测试

1. **块 kind 双向对齐**（`web/app/tests/contract/modeling-blocks.contract.spec.ts`）：后端 `reporting.py` 的 `BLOCK_KINDS` 花名册 ↔ 前端 `ReportBlocks.vue` 的派发表，**两边都遍历**。理由：`report` 的内部形状同样没有 openapi 保护，键名写错时 typecheck / lint / 线形契约全绿——`labels`/`matrix` 被无声丢掉一年就是这个机制。
2. **「每个算子都要有结果面」**（`server/.../tests/contract/test_modeling_report_coverage.py`）：从**后端算子花名册**（`registry.py` 的 24 个 code，`test_modeling_operator_catalog.py:30-55` 已有写死名单）出发遍历，断言每个 code 的 `report()` 在一份最小输入上**至少产出一个 zone='step' 的块**。
   > 这是评审 1 挑出的、三份提案全缺的一层：双向 kind 契约只挡拼写，挡不住「算子 X 的 `report()` 返回 `()`」。缺了它，失败形态是某一个算子的结果面永远只有裸骨架、全闸绿——本仓已为这一类失败记过一次账（「有路由没导航」）。
3. **formula id 单向覆盖**（`web/app/tests/contract/modeling-formulas.contract.spec.ts`）：后端算子清单快照里出现的每个 `formula id` 在 `formulaCatalog` 里都要有；反向允许多（前端可先备好）。
4. **逐算子最坏字节**（`server/.../tests/contract/test_modeling_report_bytes.py`）：对 24 个算子各造一份最坏负载（60 列宽帧 / 20 类混淆 / 20 折 / 深树 / 60 列载荷 / 366 天时间轴），逐个断言 `report` 序列化后 < `REPORT_MAX_BYTES` 且 `preview` < `PREVIEW_MAX_BYTES`。
   > 这是三份提案全缺的一条。没有它，下一个人往块里加一个字段，§1.6 的洞会以「有的运行有图、有的没有」的形式重新打开。

### 10.3 视觉验收（三份提案全缺）

整个项目的目标是**外观**，而三份提案的验证手段全是单测与闸门。用仓里的现成配方：临时 vitest spec 导 DOM + `npx sass` 编样式 + 无头 Chrome 按 **1100 / 1440 / 1600** 三档截图。

- **必截清单**：`clip_outlier`（定界表 + 分布图，公式代入的范例）、`classification_metrics`（混淆矩阵，热力对比度）、`split_dataset`（两端口页签 + 时间轴）、`linear_regression`（公式 + 三张诊断图）、`tree_regressor`（PDP + 代表树）、`ledger_source`（漏斗 + 时间轴 + 长列名）。
- **六套预设各截一遍**（评审 3 挑出的半透明色阶问题只能这么发现）。
- 每个 PR 的描述里贴改动前后的对比图。

### 10.4 闸门自检（本地必跑）

- `scripts/ci-local.sh --fast` **不跑 diff-cover**，增量覆盖 ≥85% 的红灯只在合进 main 之后出现 → **每个 PR 推之前单独跑一次 `diff-cover`**。
- `check_web_styles.py:164-178` 判的是朴素的 `"<table" in read(path)`——**规格里「matrix 用 HTML `<table>` 语义」这句话不许原样进注释**（本仓已有「注释里的 `<style>` 字面量骗过样式闸」「正则字面量骗过断言闸」两次前科）。
- `check_comments.py`：24 条 `report()` 里的说明文案按「注释只做四件事、禁变更史」写，长解释放 `docs/MODELING_DESIGN.md` 而不是代码注释。
- `check_ts_style.py`：SFC ≤500 行、`use*.ts` ≤200 行、props ≤10、**模板嵌套 ≤6 层**（`MatrixTable` 别用多层嵌套循环）。

---

## 11. 风险与已知坑（评审挑出的硬伤逐条处理）

| # | 硬伤（出处） | 处理 |
|---|---|---|
| R-1 | **B 把 `_stripped` 改成白名单会静默炸生产**：metrics 摘要只留 `kind` → `model_service._metrics_of` 取不到 `metrics["metrics"]` → 发布出去的模型版本 metrics 变空、页面空白、后端不报错、无用例守；model 摘要同样只剩 `kind`，`ModelView` 整块渲染不出（评审 1） | **已规避**：§4.6 明令 `_stripped` **保持黑名单只扩充**。且新增内容全部走独立的 `report_json`，根本不经过 `_stripped` |
| R-2 | **`cleaning.py` 577/600、`model.py` 580/600，B 与 C 都要往里加代码却没排拆分**（评审 1） | **已规避**：PR-0 是纯文件拆分、挂 `[机械]` 豁免、不改一行逻辑；且所有块算料外置到 `steps.py`/`modelstats.py`，算子侧只留几行调用 |
| R-3 | **A 的 PR 行数系统性少算约 2000 行**（评审 1） | **已规避**：§9 按「一个 PR 一个图元件 + 它的退化用例」重切成 24 个 PR，行数按 §8 的清单逐项加总；PR-0 走豁免 |
| R-4 | **A 的 24 条前端注册表与后端 24 个算子之间零契约**，加第 25 个算子时前端静默无讲解、全闸绿（评审 1） | **已规避**：§10.2 契约 #2 从后端算子花名册**反向遍历**，断言每个 code 至少产出一个 step 块 |
| R-5 | **A 押在上游摘要，但上游可能被 run 级预算换成 `{kind, note}` 桩（无 columns/shape），会把「上游没带回来」画成「上游行数 0 / 空值率 0」**（评审 1） | **已规避两层**：① 本规格的对比数据由**后端在算子里算准**并放进 `report`，不靠前端顺边推；② 仍需上游摘要的少数几处（PCA 的 pc1-pc2 散点等）走 §2-P5 的**第三档**空态「上游那份摘要被削了」 |
| R-6 | **B 把退化分支用例攒到最后一个 PR，diff-cover 会在合进 main 后红**（评审 1） | **已规避**：§9 每个图元件 PR **自带**它的退化用例；§10.4 要求每个 PR 推前单跑 diff-cover |
| R-7 | **C 的 `report()` 从算子实例取，而算子跑在子进程里，结果是 24 个算子全部安静地显示「这一步没有明细」**（评审 1、评审 2） | **已规避**：§4.4 走 `NodeResult.report`，与 `dump_fitted` 同一条缝（实测确认 `NodeResult` 今天已带 `outputs/fitted/artifact/io` 四样） |
| R-8 | **C 一边给 `NodeRunOut` 加两个顶层字段、一边写「不需要动 openapi.json」，会当场红在契约段**（评审 1） | **已规避**：§4.7 与 PR-9 明确要重导 `openapi.json` 并同步 `modeling-shapes.contract.spec.ts` 的键集 |
| R-9 | **C 的清单里一个测试文件都没有，行数全部不含测试**（评审 1） | **已规避**：§9 每个 PR 的行数已含用例；§10 逐期列出测试类型 |
| R-10 | **B 拒开 `fitted` 出口，把六个算子最要紧的数放进会被降档丢掉的块里**（评审 1） | **已规避**：§4.5 开 `NodeRunOut.fitted` 只读出口（零迁移，列已在库） |
| R-11 | **B/C 把重要性搬出 `metrics` 会动到发布链**：`_metrics_of` 取**第一个** kind=='metrics' 的记录，而 5 个评估算子端口全叫 `metrics`（评审 1） | **部分规避 + 显式承认**：搬走后 `feature_importance` 的 `metrics` 为空字典 → `_metrics_of` 会跳过它继续找（`metrics.get("kind")` 仍是 `"metrics"`，但取到的 `metrics` 是 `{}`——**这会返回空字典而不是继续找**）。**决策**：PR-22 同批把 `_metrics_of` 的判据收紧成「`metrics` 非空 **且** 该节点的 operator code 在 `{regression_metrics, classification_metrics}` 白名单里」，并加一条用例。这同时修掉 R-19 |
| R-12 | **A 的 `select_feature` 静默退化告警方向写反**（往上游判），真条件是下游 `len(splits) != 1`（评审 2，实测已核） | **已规避**：§5-11 由**后端**出 `degraded_reason` 布尔 + 原因文案，覆盖「下游零个」与「下游两个」两种；量纲告警写成提示不写成断言 |
| R-13 | **A 的 `one_hot`「一个类目都没命中」把锅算错**：`_flags` 对 `value is None` 也返回全零，那个数是「未见过的类目」+「本来就是空」之和（评审 2） | **已规避**：§5-10 后端分成 `unseen_rows` 与 `blank_rows` 两项分别报 |
| R-14 | **A 的 `filter_rows`「因空值被丢 = 上游空值率 × 行数是精确值」缺一道守**：`PREVIEW_COLS=60` 截断时读不到那一列，会把「读不到」画成「0 行」（评审 2） | **已规避**：§5-5 由后端出 `dropped_blank` |
| R-15 | **三份都以为改 D-4 会红掉 `preview.test.ts:111-117`，实际不会**（夹具 `serving_channel:'json'`，实测已核）→ 通道 B 语义会零覆盖上线（评审 2） | **已规避**：PR-3 明确要**新增**两条用例，不依赖旧用例守 |
| R-16 | **B 的「裁后 min/max 恰好等于 lo/hi」是无条件假陈述**：只有真有行越界时才相等（评审 2） | **已规避**：§5-8 界由后端给，且不做这条前端推断 |
| R-17 | **B 的 tier 顺序会先斩掉自己放在主体位的图**，在最需要解释的宽/长运行上旗舰图 100% 不出现（评审 2、评审 3） | **已规避**：§4.6 的降档按 **zone 优先级 + isPrimary**，主体图最后丢 |
| R-18 | **C 的 `filter_rows` 直方图与同屏行数差对不上账**（因空值被丢的行在数轴上没位置）（评审 2） | **已规避**：§5-5 强制画一根离轴柱「空值：N 行（不在这条轴上）」 |
| R-19 | **`_metrics_of` 今天就已经任意选**：一条图里同时挂 `regression_metrics` 与 `residual_analysis` 时，冻进模型版本的可能是残差五统计量而不是 R²/RMSE（评审 1、评审 2 各自发现） | **已规避**：并进 R-11 的 PR-22 修法（operator code 白名单） |
| R-20 | **正类类型不匹配**：config 是 `float`、labels 是 `str`；且正类可能根本不在 labels 里（评审 2，实测已核） | **已规避**：§5-21 后端出 `positive_label_text`；正类不在 labels 时不画徽标、出 danger note |
| R-21 | **`clip_outlier` 的界在训练行上拟合却裁整帧**，「本步 max = hi」同时是「有测试行超出训练分布」的证据，三份都没要（评审 2） | **已采纳为新增内容**：§5-8 加一条免费告警（比较 split 两侧 min/max） |
| R-22 | **B 说「改弹窗宽度是全局动作」是事实错误**，用错事实否掉了唯一零成本的密度改良（评审 3，实测已核） | **已规避**：§3.1 改 `min(72rem, 92vw)`，并给出实测依据（`ResultDialog.vue:30` → `DtModal.vue:129`） |
| R-23 | **B 的 `lead|detail` 只有两档，它自己 perOperator 有七条画不出来**（六个预处理算子的核心证据会排在 200 行明细表之后）（评审 3） | **已规避**：§3.2 是**六区** + `ZONE_ORDER` 常量；且「完整数据」区默认折叠 |
| R-24 | **A 的「诚实标注天花板」没给版面预算**，每屏 2–4 条灰色口径条压在一列上（评审 3） | **已规避两层**：① 本规格把「近似 + 标注」的场景基本消灭——数据由后端算准（§2-P4），需要标注的只剩 §5 里点名的少数几处；② 剩下的口径说明进 `DtHelpTip`（图/卡片旁的小问号）而不是占一整行的 `DtNotice`，只有**会导致错误结论**的那几条（`filter_rows` 丢空值、`rolling` 分母逐行不同、`resample` 时区、`lag/rolling` 不可上线）才用 `DtNotice` |
| R-25 | **A 承诺放大散点但不改弹窗宽度**，53rem 里排不下（评审 3） | **已规避**：§3.1 改宽 + §3.2 给了每一区的具体尺寸 |
| R-26 | **A 的 24 条注册表分四批写、无位置契约，机制上允许 24 张脸**（评审 3） | **已规避**：`zone` 由块自带、顺序由 `ZONE_ORDER` 常量锁死；§10.2 契约 #2 遍历全部算子 |
| R-27 | **C 只算宽度没算高度**，十几处默认展开会把一屏拉到十几屏（评审 3） | **已规避**：§3.1 的三条高度规则 + §6 的「默认展开只有 6 处」规则 |
| R-28 | **C 的 `StepFits` 把代入式公式塞进表格 td**，是它自己版式规矩的唯一破口且恰好破在旗舰位（评审 3） | **已规避**：§5-8 明令公式移到表格下方一段，一列一行等宽起排 |
| R-29 | **三份都没验算半透明主题下的热力对比度**（评审 3） | **已规避**：§7 的 `color-mix` 实底方案 + α 区间 + §10.3 的六套预设截图核对 |
| R-30 | **长中文列名没有截断口径**（评审 3） | **已规避**：§7 末尾的三条统一口径 |
| R-31 | **两端口节点的重复无人处理**（评审 3） | **已规避**：§3.4 页签 + 出处只印一次 |
| R-32 | **结果带不走**（评审 3） | **部分规避**：公式复制成 ASCII（§6）、指标卡数值可选中、混淆矩阵走 `DtTable` 天然可选中复制。**图存不成图片本批不做**——`<a download>` 类能力与仓内既有的「下载全量结果」链路是另一件事，不在本次范围 |
| R-33 | **加载态三份全缺**（评审 3） | **已规避**：`ReportBlocks` 在 `report === undefined`（详情尚未拉回）时渲染 `DtSkeleton` 占位，占位高度按 zone 固定（step 3rem / stats 6rem / charts 14rem），避免回来之后跳版 |
| R-34 | **`MetricsView` 的「单位」冲突**：`${niceNumber(v)}${unitOf(key)}`，一列叫 `mape` 时无量纲的 ΔR²=0.12 会印成「0.12%」；一列叫 `r2` 时画布卡片会印「R² 0.12」（评审 2 独家发现） | **已规避**：`breakdown` 把列名彻底搬出 `metrics` 字典（§4.3），键空间冲突随之消失。PR-7 同批在 `metricBands` 加一条「动态键语境不查 SPECS/UNITS」的开关兜底 |
| R-35 | **`report_json` 迁移与运行明细保留期的关系** | **已确认无碍**：节点级明细本就有保留期（`services/retention.py:39-40,79`，每流水线保留 N 次 + 90 天），新列跟着一起清 |

### 接受而不规避的三条

| # | 项 | 为什么接受 |
|---|---|---|
| N-1 | **一次扩展步迁移的成本** | §4.2 已论证：塞进 `preview_json` 会让界面长相取决于数据宽度，代价更大。且 `fitted_json` 是同一张表上的现成先例 |
| N-2 | **24 个 PR、约三到四周的合并窗口** | main 并发组只留一个 pending run，节奏本就受限；且阶段一二（7 个 PR）就能交付分类评估这一屏，不必等全部做完 |
| N-3 | **`report` 会跟着 24 份预取一起下载** | 已用 `REPORT_MAX_BYTES = 64KB` 定死上限（24 × 64KB ≈ 1.5MB 最坏值，且实际块基本在几 KB）。若日后发现首次打开画布变慢，正解是给 `NodeRunSummaryOut` 加 `has_report` 布尔、按需拉，而不是调大上限 |

---

## 12. 已拍板的五条

| # | 问题 | 决定 |
|---|---|---|
| Q1 | 结果弹窗宽度 | **改成 `min(72rem, 92vw)`**。它是 `ResultDialog` 自己的 prop，只影响这一个弹窗；而 `FrameView` 的两张表写死 `min-width:52rem`，56rem 下今天就在横滚 |
| Q2 | 新增的块存哪儿 | **新增 `modeling_node_runs.report_json` 列**，一次扩展步迁移（可空 JSONB、无回填、`lock_timeout`）。不塞进 `preview_json`——那会让界面长相取决于数据宽度 |
| Q3 | 验收节奏 | **27 个 PR 全部做完再验收**，不设中途验收点 |
| Q4 | `_metrics_of` 取第一个 metrics 节点的既有缺陷 | **本批修掉**（PR-22）：判据收紧成「operator code 在 `{regression_metrics, classification_metrics}` 白名单里且 metrics 非空」。存量模型版本的 `metrics_json` **不回填**，只影响新发布的版本 |
| Q5 | 逻辑回归的概率列与 ROC / PR / 校准 / 可拖阈值 | **本批就做**，单列阶段六（PR-24～PR-26） |

---

## 13. 阶段六 · 逻辑回归的概率列（Q5 拍板后新增）

### 13.1 病症

`operators/model.py` 的逻辑回归对每一行都算出了正类概率，比完一个**私有常量 0.5**（`model.py:50`）就把概率扔掉，只留硬标签。后果三条：

1. **ROC / PR / 校准曲线 / 可拖阈值四张图全部画不出来**——它们全都要每行的概率，不是硬标签。
2. **判正类的 0.5 既不是超参也不进摘要**，类不平衡时用户既改不了也看不见。
3. 分类评估的全部指标（准确率 / P / R / F1）都**只是 0.5 这一个阈值上的切片**，而界面上一个字都没说。

### 13.2 决策

**打分帧增加一列概率**，走列声明契约的正规改法，不走旁路。

- 新列 key 为 `<target_key>__proba`，`role='prediction_proba'`，`dtype='float'`，`unit=''`。
- **`describe_columns` 必须同步声明**（`docs/MODELING_PLATFORM_DESIGN.md` D2：算子声明自己怎么改列集，声明是纯函数，训练与推理共用；D3：声明是约定、真值是实测，两者不一致时发布失败）。这是本阶段唯一的契约变更，也是它必须单列一期的原因。
- **判正类的阈值升为超参** `positive_threshold: float = 0.5`（`ge=0`、`le=1`、带 title/description），进 `hyper_params` 因而进 `serving_json`，推理侧照用同一个值。
- **只有二分类产概率列**。多分类时不产，并在结果面上明说「多分类不产概率列，ROC / PR / 校准曲线需要二分类」。

### 13.3 图与块

| 图 | 组件 | 数据 | 说明 |
|---|---|---|---|
| ROC 曲线 + AUC | `ScatterPlot`（新 `mode: 'curve'`） | 后端按 ≤200 个阈值网格算好 `(fpr, tpr)` 点列，**不在前端从 pairs 现算** | 对角线是随机基准；AUC 进关键数字区 |
| PR 曲线 + AP | 同上 | `(recall, precision)` 点列 + 正类占比基线 | 类不平衡时它比 ROC 诚实，两张都要 |
| 校准曲线 | 同上 | 十等分箱的 `(平均预测概率, 实际正类率)` + 每箱样本数 | 对角线是完美校准；箱内样本 <10 的点画空心 |
| 阈值滑杆 | `ThresholdSlider.vue`（新） | 后端给 ≤200 个阈值上的 `(threshold, tp, fp, tn, fn)` 网格，前端**查表**不重算 | 拖动即时联动混淆矩阵与四个指标卡；默认停在训练时的 `positive_threshold` 并标一条竖线 |

**为什么阈值网格由后端给**：前端只有截断过的 `pairs`（默认上限 500 行），拿它现算的曲线与指标卡对不上账——同一屏两个数打架是比没有这张图更坏的结果。网格 200 × 5 个整数约 4KB，在 `REPORT_MAX_BYTES` 里毫无压力。

### 13.4 PR 切分

| PR | 范围 | 行 | 服务 | 依赖 |
|---|---|---|---|---|
| **PR-24** | `feat(platform-server)`：逻辑回归产概率列 + `positive_threshold` 超参 + `describe_columns` 同步 + 推理侧照用 + 契约用例（声明与实测一致 / 多分类不产列 / 阈值进 `serving_json`） | 320 / 7 | platform-server | PR-19 |
| **PR-25** | `feat(platform-server)`：`classification_metrics` 出 ROC / PR / 校准三条曲线与阈值网格的块 + 逐算子最坏字节用例 | 300 / 5 | platform-server | PR-24, PR-22 |
| **PR-26** | `feat(web)`：`ScatterPlot` 加 `curve` mode + `ThresholdSlider.vue` + 三条曲线与滑杆接线 + 退化用例（单类 / 全同概率 / 空网格 / 多分类无概率列） | 390 / 6 | web | PR-25, PR-23 |

### 13.5 风险

| # | 风险 | 处理 |
|---|---|---|
| R-36 | 打分帧加列是**契约变更**，会动到 `describe_columns` 与列声明契约测试、`serving_json` 的逐步列集（`docs/MODELING_PLATFORM_DESIGN.md` D4 的 `2.0` 形状） | PR-24 单列一期，只做这一件事；契约用例先红后绿 |
| R-37 | 存量已发布的逻辑回归模型版本，其 `serving_json` 里没有 `positive_threshold` | 推理侧读不到时回落 0.5（与今天的行为一字不差），**不回填**存量版本 |
| R-38 | 下游算子（残差分析、特征重要性）拿到多出来的一列会不会串味 | 概率列 `role='prediction_proba'`，与 `truth`/`prediction` 都不同；`scored_columns_of` 按 role 取，不按位置取——实施时必须逐个核实这一点，不能假定 |
