# 空调达标时长模型页 —— 界面设计规格

本文是 [`AC_MODEL_DESIGN.md`](AC_MODEL_DESIGN.md) §6「页面」的实现级细化，
覆盖 `/hvac/models` 与 `/hvac/models/:modelId` 的整体重构。领域口径不在这里
重复，只标节号；本文只定**呈现与交互**，且定到不需要再做设计决策。

写给照着实现的前端：凡本文写「⚠」的地方都是踩过或必然会踩的坑，不要顺手改掉。

---

## 0. 三条贯穿全文的口径

1. **热行是主口径。** 五到八成开机「一开机就已达标」（实际时长 0），整体 MAE
   被这些零误差行灌水。凡页面上不带限定词的「MAE / 覆盖率 / R² / 中位误差」
   一律指**热行**（实际 > 0）；整体口径必须带「含零行」字样且视觉上退居次要。
   反过来摆是本次重构要修掉的问题之一。
2. **缺席不是零。** `null` 一律渲染占位符或专门文案，绝不渲染 `0` / `0%` /
   `0.0`。R² 为 null 写「重训后可见」，读数为 null 写「无数据」，无样本的组合
   写「无样本」。
3. **陈旧要标注。** 训练中显示上一次评估、推荐用上一次工件、EMS 读数超过阈值，
   三处都必须在界面上说出来，不许静默端上来。

---

## 1. 信息架构与路由

### 1.1 两条路由（不新增）

| 路径 | 名称 | 角色 |
|---|---|---|
| `/hvac/models` | `hvac-models` | 主从列表：左房间 / 右该房间的模型 |
| `/hvac/models/:modelId` | `hvac-model-detail` | 单模型详情 |

`router/index.ts` 不动。权限沿用 `ac:view` 进页面、`ac:manage` 管写操作。

### 1.2 `?room=` 记忆

左栏选中的房间写进 query，**用 `router.replace` 不用 `push`**。

```ts
// 选中房间时
void router.replace({ query: { ...route.query, room: id } })
```

⚠ 必须是 `replace`：房间是页内筛选不是导航步骤，用 `push` 的话浏览器后退键
会把用户一个一个倒着走过点过的每个房间，而不是回到上一个页面。

**读取与校验（挂载时，房间列表回来之后）**：

1. `route.query.room` 归一成 `string`（`string[]` 取第 0 项，`undefined` → `''`）。
2. 在已加载的房间列表里查；查不到（房间被删/id 手改乱了）→ 当作没给。
3. 没给或查不到时的兜底次序：**第一个有模型的房间** → 若全都没模型则**列表第一个房间** → 列表为空则 `''`（渲染空态）。
4. 兜底选出的房间也要写回 query（同样 `replace`），保证地址栏与界面一致。

⚠ 校验要等房间列表到手再做，不能在 `onMounted` 里立刻判空就清掉 query——
那会把用户带着 `?room=` 直接打开的链接洗掉。

### 1.3 从详情返回后选中态保持

详情页的 `AppShell` `back-to` 由静态串改成**带 query 的计算属性**：

```ts
const backTo = computed(() =>
  model.value === null
    ? '/hvac/models'
    : `/hvac/models?room=${model.value.room.id}`,
)
```

`AppTopbar` 里 `back-to` 走的是 `<RouterLink :to>`，字符串里带 query 能正确解析，
也不影响中键新标签打开。模型还没加载回来时退回不带 query 的路径，此时 §1.2 的
兜底会选第一个有模型的房间——可接受，因为那一瞬间根本不知道该选谁。

---

## 2. 列表页 `/hvac/models`

### 2.1 页面骨架

```
AppShell  title="达标预测"  subtitle="给定当前条件与一个运行组合，预测多久达标"
  #actions —— 空（新建入口下沉到右区头部，见 §2.3）
┌ div.flex.h-full.min-h-0.gap-4.flex-col   lg:flex-row ──────────────────────┐
│ ┌ RoomSidebar ─────────┐ ┌ 右区 div.flex.min-h-0.min-w-0.flex-1.flex-col ┐ │
│ │ max-h-64 shrink-0    │ │ ┌ 头部（房间名 / 车间 · 台数 · 模型数 / 新建）┐ │ │
│ │ lg:max-h-none        │ │ └────────────────────────────────────────────┘ │ │
│ │ lg:w-72              │ │ ┌ ModelTable（DtDataView，min-h-0 flex-1）───┐ │ │
│ │                      │ │ │                                            │ │ │
│ │                      │ │ └────────────────────────────────────────────┘ │ │
│ └──────────────────────┘ └────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

布局纪律（照抄 `Startups/index.vue` 的先例，那套在生产里已经站住）：

- 页面根：`flex h-full min-h-0 flex-col gap-4 lg:flex-row`
- 左栏：`max-h-64 shrink-0 lg:max-h-none lg:w-72`
- 右区：`flex min-h-0 min-w-0 flex-1 flex-col gap-3`

⚠ 两侧都要 `min-h-0`，右区还要 `min-w-0`。少 `min-h-0` 不是滚动而是把整页撑长，
而 AppShell 的 `<main>` 是 `overflow-hidden`，撑出去的部分够不着；少 `min-w-0`
则宽表格顶破页面横滚，而不是在表格自己的滚动容器里滚。

### 2.2 左栏 `RoomSidebar.vue`

沿用 `Startups/components/CoverageSidebar.vue` 的外观骨架：
`<aside class="flex min-h-0 flex-col gap-2 rounded-lg border border-border-subtle bg-surface-panel p-3">`。

#### 内容

```
┌─────────────────────────────┐
│ 房间                 12 个  │  ← 栏头，text-xs tracking-widest text-text-secondary
│ [🔍 筛房间            ]     │  ← DtInput type="search" size="sm"，见「筛选框」
├─────────────────────────────┤
│ 卷包车间                    │  ← 车间分组头（<h3>），text-2xs text-text-disabled
│  ▎生产线            [3]     │  ← 选中：左侧 2px 竖条 + bg-accent-primary/10
│   加香间            [1] ●   │  ← ● = 该房间有模型正在训练
│   备料间            [0]     │  ← 0 个模型：房间名 text-text-secondary（淡化）
│ 制丝车间                    │
│   一号线            [2]     │
├─────────────────────────────┤
│ 另有 3 个房间没有空调，不能建模 │  ← 有被过滤掉的房间时才出现
└─────────────────────────────┘
```

#### 收哪些房间

`listRooms({ size: 200 })` 全量，然后：

```
显示条件 = room.ac_unit_count > 0 || 该房间的模型数 > 0
```

⚠ 第二个条件不能省：机组被挪走之后房间的 `ac_unit_count` 会掉到 0，但它历史上
训出来的模型还在，藏掉房间等于让那些模型从界面上消失且无法删除。

被过滤掉的房间数 > 0 时，栏底给一行 `text-2xs text-text-disabled`：
「另有 N 个房间没有空调，不能建模」。⚠ 这一行必须有——静默少列几个房间，用户
只会以为房间没配好，而不会想到是没有空调。

#### 分组与排序

- **按车间分组**，车间之间按车间名 `localeCompare('zh-CN')` 升序；组内房间同样按名称升序。
- ⚠ **不按模型数排序**：数量会随建模/删除变化，排序跟着跳，用户刚记住的位置就没了。物理归属（车间·房间）是稳定的心智模型。
- 全场只有一个车间时**不渲染分组头**（`workshopGroups.length === 1`），省掉一行噪声。

#### 计数

`[n]` 用 `DtTag size="sm"`：

| 情况 | intent | 文案 | 房间名样式 |
|---|---|---|---|
| n ≥ 1 | `neutral` | `n` | `text-text-primary` |
| n = 0 | `neutral` | `0` | `text-text-secondary`（淡化） |
| 该房间有 `queued`/`training` 的模型 | 计数标签照旧 | 额外一枚 `DtBadge dot intent="info" aria-label="有模型正在训练"` | — |

计数从 `listAcModels()` 返回的全量数组客户端数出来，不额外请求。

#### 筛选框

房间总数 > `ROOM_FILTER_MIN`（= 8）时才渲染。匹配「房间名 或 车间名」的
**大小写无关子串**，实时过滤。

```html
<DtInput
  v-model="keyword" type="search" size="sm"
  placeholder="筛房间" aria-label="筛房间"
>
  <template #leading><DtIcon name="search" :size="14" /></template>
</DtInput>
```

⚠ `DtInput` **不会**因为 `type="search"` 自己长出放大镜——图标要自己塞进
`#leading` 插槽。`placeholder` 与 `aria-label` 走 `$attrs` 透传到 `<input>` 上；
没有可见 label 时 `aria-label` 不能省。
⚠ 过滤只影响显示，不动 `?room=`：当前选中的房间被过滤掉时它仍然是选中的，右区
照常显示它的模型；栏内此时补一行 `text-2xs text-text-disabled`「当前选中的
房间不在筛选结果里」。

#### 选中态

```html
<button
  type="button"
  class="flex w-full items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-left"
  :class="isSelected
    ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
    : 'border-transparent text-text-primary hover:bg-surface-raised'"
  :aria-pressed="isSelected"
  :title="`${workshopName} · ${roomName}`"
>
```

⚠ 竖条 `border-l-2` 不是装饰：选中态不能只靠颜色，`aria-pressed` 管读屏，
竖条管色觉障碍。与 CoverageSidebar 不同的是这里**不做「再点一次取消」**——
主从布局必须始终有一个选中项，取消了右区就没东西可显示。

#### 空态

房间一个都没有（或全被过滤条件挡掉）：

```html
<DtEmpty icon="building" title="还没有配置房间"
         hint="先在空间配置页建车间与房间，并把空调挂到房间上。" />
```

右区同时渲染一份对应的 `DtEmpty`（标题「先配置房间」，hint 同上），不要留白。

### 2.3 右区头部

```
┌──────────────────────────────────────────────────────────────┐
│ 生产线                                      [ 新建模型 ]      │
│ 卷包车间 · 6 台空调 · 3 个模型                                 │
└──────────────────────────────────────────────────────────────┘
```

- 房间名 `<h2 class="text-sm font-semibold text-text-primary">`；副行 `text-xs text-text-secondary`。
- 「新建模型」`DtButton intent="primary" size="sm"`，包在 `PermGuard :codes="[PERMISSION_CODES.acManage]"` 里。

**新建入口只此一处**，AppShell 的 `#actions` 留空。理由：建模永远是针对某个
房间的，入口贴着房间上下文最不容易选错；页面级按钮反而逼用户在弹窗里再选一次
房间。房间列表为空时本来也无从建模，此时右区是空态，没有入口是正确的。

`CreateModelDialog` 需要一处改动：新增 `roomId?: string` prop 做预填。

⚠ 现有 `watch(() => props.open)` 在打开时把 `roomId.value` 重置为 `''`，
要改成重置为 `props.roomId ?? ''`，否则预填会被这段 reset 立刻抹掉。
预填后房间选择器**仍可改**（不锁定），改了照常走覆盖度取数。

创建成功后仍 `router.push('/hvac/models/' + id)` 进详情——训练是异步的，
详情页有进度与提示，是最有信息的落点。

### 2.4 右区表格 `ModelTable.vue`

#### 为什么是表格不是卡片

**结论：表格（`DtDataView view="table"`，开启内置视图切换）。**

同一房间的多个模型只在几个数字上有差别（R²、MAE、覆盖率、样本量、窗口），
判断「哪个更好」是**逐列比大小**的活儿。表格把同一个指标钉在同一条竖线上，
眼睛沿列往下扫一遍就有答案；卡片网格里同一个数字落在每张卡的不同高度，
对比要来回跳视线。卡片赢在「每条记录是一个独立对象」的场景，这里恰恰相反。

保险起见 `layout.toggle: true`（不像旧代码那样关掉），窄屏用户可以自己切到
卡片视图；`cell-<key>` 插槽同时喂两种视图，不用写第二套标记。

#### 列定义

```ts
const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name',     label: '名称',     width: '16rem',  card: 'title' },
  { key: 'status',   label: '状态',     width: '6rem' },
  { key: 'sets',     label: '服务组合', width: '10rem',  card: 'meta' },
  { key: 'sample',   label: '样本',     width: '7.5rem', align: 'right', sortable: true },
  { key: 'r2',       label: '热行 R²',  width: '6rem',   align: 'right', sortable: true },
  { key: 'mae',      label: '热行 MAE', width: '8rem',   align: 'right', sortable: true },
  { key: 'training', label: '训练',     width: '10rem',  sortable: true },
  { key: 'actions',  label: '操作',     width: '9rem',   align: 'right', card: 'actions' },
]
```

`layout = { minWidth: '72rem', cardColumns: 2, cardMinWidth: '20rem' }`（`fill` 用默认 true）。

每格的内容：

| 列 | 主行 | 副行（`text-2xs`） |
|---|---|---|
| `name` | 模型名，`<button>` 链接样式 `text-accent-primary hover:underline`，点开详情 | **提示优先于描述**：有 `notice` 就渲染 notice（`text-state-warning`，`truncate` + `:title` 全文），否则渲染 `description`（`text-text-secondary`），都没有就不渲染副行 |
| `status` | `DtTag size="sm"`，走 `MODEL_STATUS_VIEW` | — |
| `sets` | 前两个组合键，`font-mono text-xs`，多出来的写 `+n`；`:title` 给全部组合键换行拼接 | — |
| `sample` | `sample_count`（null → `—`） | `热 402 · 零 383`（`zero_count` 为 null 时不渲染副行） |
| `r2` | 见下「R² 的呈现」 | — |
| `mae` | 热行 MAE，`formatMinutes` | `覆盖 62%`；`coverage < 0.7` 时 `text-state-warning`，否则 `text-text-disabled` |
| `training` | 相对训练时间「3 天前」，`:title` 给绝对时刻；`trained_at` 为 null → `未训练` | 数据窗口 `06-01 → 08-10`（`window_start`/`window_end` 取 `MM-DD`），任一为 null 则不渲染 |
| `actions` | `详情` / `重训` / `删除`，见下 | — |

`actions`：`详情` 是 `DtButton variant="ghost" intent="neutral" size="sm"`；
`重训`（`queued`/`training` 时 `disabled`）与 `删除`（`intent="danger"`）包在
`PermGuard :codes="[PERMISSION_CODES.acManage]"` 里。行为沿用现有实现
（重训 toast「重训已排队」；删除走 `useConfirm` 危险确认）。

**列出去了什么，为什么**：MedAE / RMSE / 区间宽度 / 判零率 / 判出率 / 可靠性
一律不进列表。列表回答的是「哪个模型好、哪个新、哪个该重训」，三个数字
（R² · MAE · 覆盖率）足够排序；细分口径是诊断，属于详情页。覆盖率之所以留下，
是因为 §2.3 明写「覆盖率显著低于 80% 要在页面上标出来」——它比 MAE 高更危险。

#### R² 的呈现

```
r2 === null          → <span class="text-text-disabled">—</span>
r2 <  0              → text-state-danger，值照实显示（如 -0.14）
0 ≤ r2 < R2_WEAK(0.3)→ text-state-warning
r2 ≥ 0.3             → text-text-primary
```

格式：`value.toFixed(2)`，无单位。⚠ **负数要照实显示**，它的含义是「比永远猜
平均值还差」，是真信号，不能夹到 0。

⚠ **null 的占位符是 `—`，不要写「重训后可见」**。后端 `ErrorStatsOut.r2` 的
null 有两种成因：老评估没算过（重训能补），以及**热行实际值没有离散度**
（例如只有一条热行，R² 数学上无定义——重训多少次都还是 null）。写死「重训后
可见」在第二种情况下是错误建议。成因由 help tip 一次讲清（§3.3），单元格保持
与 `formatMinutes` / `formatRate` 一致的 `—`。

R² 的解释挂在表格 `#toolbar` 插槽里（`DtDataView` 没有表头插槽），一枚
`DtHelpTip label="热行指标" text="…"`，内容见 §3.3 的同一段文案，两处共用一个常量。

#### 排序

`sortable` 的四列走 `DtDataView` 的 `:sort` + `@update:sort`（组件只抛事件，
排序由页面做）。默认序：**`created_at` 降序**（最新建的在最上）。

⚠ 三条排序纪律：

1. **null 恒排末尾**，与 `desc` 无关。否则「按 R² 排序」会把一堆老评估
   （r2 = null）顶到最前，正好挡住用户想看的东西。
2. **不给训练中的行置顶**。状态标签 + 轮询刷新已经够醒目，置顶会让行在训练
   结束的那一刻跳位置。
3. 排序是纯客户端的（整个数组在手），不发请求。

#### 三态与轮询

- `loading` / `error` / `empty` 交给 `DtDataView` 内建三态。
- 房间已选但没有模型：`empty = { title: '这个房间还没有模型', hint: '用右上角的「新建模型」，拿它已抽出的开机事件训练一个。' }`。
- 轮询沿用现有实现：`listAcModels()` 全量，5s 一次，**有 `queued`/`training` 的行才轮**，全部到终态即停，`onBeforeUnmount` 清定时器。
  ⚠ 轮询刷新的是整个数组，左栏计数与训练中圆点跟着更新，这正是要的；但
  **不能顺带重置左栏选中或表格排序态**——那两个状态住在页面自己的 ref 里，
  取数只替换 `models.value`。
- 训练中的行照常显示上一次的评估数字（`failed` 也一样），不要清空。

---

## 3. 详情页 `/hvac/models/:modelId`

### 3.1 区块布局

```
┌ AppShell ────────────────────────────────────────────────────────────────┐
│ ← 达标预测                                                                │
│ 生产线-主模型                        [实时测试] [重训] [删除]              │
│ 卷包车间 · 生产线                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ 页面根 div.flex.h-full.min-h-0.flex-col.gap-3.overflow-y-auto             │
│                                                                          │
│ ① 状态条   [就绪]  数据已更新，可重训取最新                                │
│    （failed 时另起一条 DtNotice danger 显示 error 全文）                   │
├──────────────────────────────────────────────────────────────────────────┤
│ ② 出处条 ProvenanceStrip                                                  │
│    数据窗口 2026-06-01 → 2026-08-10（71 天） · 样本 785（热 402 · 零 383） │
│    · 半衰期 180 天 · 特征 v2 · 训练于 2026-08-11 09:14（2 天前）          │
├──────────────────────────────────────────────────────────────────────────┤
│ ③ 评估摘要 MetricsSummary   grid gap-3 sm:grid-cols-2 lg:grid-cols-4      │
│  ┌────────┬────────┬────────┬────────┐                                   │
│  │训练样本│热行 R² │热行 MAE│热行中位│                                   │
│  ├────────┼────────┼────────┼────────┤                                   │
│  │热行覆盖│区间宽度│判零/判出│整体口径│  ← 第 8 格明确标「含零行」          │
│  └────────┴────────┴────────┴────────┘                                   │
├──────────────────────────────────────────────────────────────────────────┤
│ ④ 折外总览 OutOfFoldCard（DtCard，全宽）                                   │
│  ┌ 折外总览  全部来自折外预测：模型没见过答案的那次                       │
│  │                             [组合过滤 ▾] [线性|压缩]                  │
│  │ ● 热行命中  ● 热行漏盖  ● 零行  ▬ ±MAE 带           ← 图例            │
│  ├──────────────────────┬───────────────────────────────────────────────┤
│  │                      │  误差分布（热行，p50 − 实际）                  │
│  │   预测-实际散点       │   ▁▂▅█▇▃▁▁                                    │
│  │   384×384 SVG        │   中位偏差 −1.4 分钟（预测偏短）               │
│  │                      ├───────────────────────────────────────────────┤
│  │                      │  按折稳定性（热行 MAE）                        │
│  │                      │   折1 ▇ 12.1  折2 ▆ 10.4  折3 █ 15.8 …        │
│  ├──────────────────────┴───────────────────────────────────────────────┤
│  │ 误差最大的 5 次   [卡][卡][卡][卡][卡]                                 │
│  ├────────────────────────────────────────────────────────────────────── │
│  │ 共 785 条折外预测，图上画了 785 条                    ← 脚注          │
│  └──────────────────────────────────────────────────────────────────────┤
├──────────────────────────────────────────────────────────────────────────┤
│ ⑤ 按服务组合 SetMetricsTable（点一行 = 把 ④⑥ 过滤到该组合）                │
├──────────────────────────────────────────────────────────────────────────┤
│ ⑥ 折外逐条 PredictionTable（页码分页 + 每页条数）                          │
└──────────────────────────────────────────────────────────────────────────┘
```

优先级：③ > ④ > ⑤ > ⑥ > ② > ①。①② 是窄条不占垂直预算；③ 是「这模型能不能
信」的一句话答案；④ 是「它错在哪」；⑤⑥ 是下钻。

页面根保持现有的 `flex h-full min-h-0 flex-col gap-3 overflow-y-auto`
（整页在自己的容器里滚，AppShell 的 main 不滚）。

### 3.2 ① 状态条 与 ② 出处条

**① 状态条**：沿用现有实现，一行 `flex flex-wrap items-center gap-2`：
状态 `DtTag` + 训练中小字「训练大约几十秒；期间显示的是上一次训练的评估。」+
`staleNotice` 小字（`text-state-warning`）。`failed` 且有 `error` 时下面接一条
`DtNotice intent="danger"` 显示全文。

**② 出处条 `ProvenanceStrip.vue`（新）**：把散落各处的训练出处收进一条。
`<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">`，
每项 `<span>`：

| 项 | 内容 | null 时 |
|---|---|---|
| 数据窗口 | `2026-06-01 → 2026-08-10（71 天）` | `数据窗口 —` |
| 样本 | `785（热 402 · 零 383）` | `样本 —` |
| 半衰期 | `半衰期 180 天` | 总是有 |
| 特征版本 | `特征 v2`，`is_feature_stale` 时值加 `text-state-warning` | `特征 —` |
| 训练时间 | `训练于 2026-08-11 09:14（2 天前）` | `尚未训练` |

⚠ 出处条与 ① 的 stale 提示不重复：① 说**该做什么**（「建议重训」），
② 说**是什么**（「特征 v2」）。两者语气不同，都要有。

### 3.3 ③ 评估摘要 `MetricsSummary.vue`（改）

八格，`grid gap-3 sm:grid-cols-2 lg:grid-cols-4`。取值口径：
`graded = overall.hot ?? overall`（老评估没有热行拆分时退回整体，照旧渲染）。

| # | 标题 | 值 | 备注 |
|---|---|---|---|
| 1 | 训练样本 | `热 402 / 零 383`；`zero_count` 为 null 时退回 `sample_count` | — |
| 2 | 热行 R² | `graded.r2`，格式与配色同 §2.4 | 标题后挂 `DtHelpTip` |
| 3 | 热行 MAE | `formatMinutes(graded.mae)` | — |
| 4 | 热行中位误差 | `formatMinutes(graded.medae)` | — |
| 5 | 热行覆盖率<br/>`（标称 80%）` | `formatCoverage(graded.coverage)`，`< 0.7` 标 `text-state-warning` | — |
| 6 | 平均区间宽度 | `formatMinutes(graded.mean_width)` + `DtTag` 可靠性 | 走 `RELIABILITY_VIEW` |
| 7 | 判零 / 判出 | `formatRate(zero_hit_rate) / formatRate(hot_hit_rate)` | 标题后挂 `DtHelpTip` |
| 8 | 整体口径<br/>`（含零行，仅供对照）` | 一格里两个小数字：`R² 0.81` `MAE 3.2 分钟`，字号降到 `text-sm` | 见下 |

第 8 格是整个页面上唯一出现整体口径的地方，且必须带「含零行，仅供对照」。
它的存在是为了让人看见「整体 3.2 分钟 vs 热行 14 分钟」这个落差本身——
那正是零膨胀的证据。⚠ 不许把它做得和前七格一样大一样亮。

`DtHelpTip` 文案（抽成常量，与 §2.4 列表页共用）：

- **热行**：`只统计「实际达标时长 > 0」的那些开机。半数以上的开机一开机就已达标，把它们算进来会让误差看起来比真实情况小得多。`
- **R²**：`决定系数：1 = 完美，0 = 与「永远猜平均值」一样，负数 = 比猜平均值还差。这里只用热行算。显示「—」有两种可能：这次评估是旧口径算的（重训后补齐），或者热行的实际时长没有差异（只有一条热行时就会这样），后者算不出 R²。`
- **判零 / 判出**：`判零率 = 零行里被判成 0 的占比；判出率 = 热行里被判成非零的占比。判出率低意味着模型在漏报「这次要等」。`

`metrics` 为 null 且非训练中时，整块换成 `DtNotice intent="info"`「还没有一次成功的训练。」（现状即如此，保留）。

### 3.4 ④ 折外总览 `OutOfFoldCard.vue`（新）

这是本次重构的重心。旧实现把散点和逐条表塞在一张卡里**共用同一页 20 条数据**
——一张 20 个点的散点根本不是这个模型的画像，用户会以为折外预测只有 20 条。

#### 4a. 全量折外取数 `useOutOfFold.ts`（新 composable）

图表用的数据与逐条表**分开取**：

```
挂载时 / 换模型时 / 训练由 busy 转终态时：
  page = 1
  loop:
    resp = listModelPredictions(modelId, { page, size: 200 })   // 200 = 后端 MAX_PAGE_SIZE
    追加 resp.items 到 rows（渐进渲染：每页回来就重画）
    if page * 200 >= resp.total  或  rows.length >= SCATTER_MAX_ROWS(2000): break
    page += 1
```

- **不带 `running_set` 过滤**：整份取回来，组合过滤在客户端做（每行自带
  `running_set`）。这样切组合是零请求的瞬时操作，也避免每换一次过滤就重跑
  4–10 次请求。
- **渐进渲染**：每拉回一页就把点补进图里，用户先看到轮廓；加载中脚注显示
  `已载入 400 / 785`。
- **上限 `SCATTER_MAX_ROWS = 2000`**（约 10 次请求）。现网实测单房间 785 / 975
  条，这是护栏不是常态。命中上限时脚注改成
  `共 M 条折外预测，图上画了 2000 条（超出部分未画）`。
- ⚠ **必须防竞态**：换模型或重训完成会重新拉，慢的那次后返回会把上一个模型的
  点混进来。用一个自增的 `token`，每页回来先比对 token 再追加；`onBeforeUnmount`
  把 token 作废，让在途的循环自己退出。
- 出错：整块图区换成 `DtNotice intent="danger"` + 「重试」按钮，不要只画半份点。

composable 对外暴露（全部已按当前组合过滤过的派生值）：

```ts
interface OutOfFold {
  rows: Ref<ModelPrediction[]>          // 原始全量（未过滤）
  total: Ref<number>                    // 后端报的总数
  loading: Ref<boolean>
  error: Ref<string | null>
  filtered: ComputedRef<ModelPrediction[]>   // 按 setFilter 过滤后
  hotRows: ComputedRef<ModelPrediction[]>    // filtered 里 actual_minutes > 0
  hotMae: ComputedRef<number | null>         // hotRows 的 MAE，空集为 null
  missedCount: ComputedRef<number>           // filtered 里区间没盖住实际值的条数
  foldStats: ComputedRef<{ fold: number; hotMae: number; count: number }[]>
  topErrors: ComputedRef<ModelPrediction[]>  // |p50 − actual| 降序前 5
  reload: () => void
}
```

`topErrors` **不排除零行**：一条实际 0 分钟却被预测成 40 分钟的记录是严重错误，
藏起来说不过去。列表里给这类行标一枚 `DtTag size="sm"`「零行」。

#### 4b. 工具行与图例

```
折外总览   全部来自折外预测：模型没见过答案的那次        [全部组合 ▾] [线性|压缩]
● 热行命中   ● 热行漏盖   ● 零行   ▬ ±MAE 带
```

- 组合过滤 `DtSelect size="sm" class="w-44"`，选项 = `全部组合` + `model.serving_sets` 各一项，`aria-label="按组合过滤"`。
  ⚠ **这是全页唯一的组合筛选控件**。⑤ 表的行点击写回同一个 ref，⑥ 表也读它
  （见 §3.5 / §3.6）。两个控件各记各的，界面就会出现「表已筛过、下拉却显示全部」。
- 刻度 `DtSegmented size="sm"`，选项 `[{value:'linear',label:'线性'},{value:'sqrt',label:'压缩'}]`，`aria-label="坐标刻度"`，默认 `linear`。
- 图例是一行 `flex flex-wrap gap-x-4 gap-y-1 text-2xs text-text-secondary`，
  每项一个 8px 色块 + 文字。⚠ **图例必须有**：现在四种着色的含义只能靠悬停
  `<title>` 猜，色觉障碍用户完全读不到。

#### 4c. 散点 `PredictionScatter.vue`（改）

在现有 SVG 上做五处增强，**不引入 echarts**（理由见 §3.7）：

1. **画全量**：`rows` 改接 `outOfFold.filtered`，不再是当前页。
2. **画布放大到 `SIZE = 384`**（`h-96 w-96`），点半径 `r=2.5`；零行 `r=2` 且更淡。
   点数多时靠 `fill-*/70` 的半透明叠加自然显出密度，不做额外的抖动或聚合。
3. **刻度可切换**。两轴用**同一个**变换函数：
   ```
   linear: t(v) = v / limit
   sqrt:   t(v) = Math.sqrt(v) / Math.sqrt(limit)
   ```
   ⚠ 两轴同变换是关键性质——它保证 `y = x` 那条理想对角线在两种刻度下**都还是
   那条对角线**，语义不损。sqrt 天然吃得下 0（不像 log 要 +1 偏移），正好适配
   零膨胀 + 长尾的分布。刻度标签的位置跟着 `t()` 走，标注的值仍是 `0 / ¼ / ½ / ¾ / 1` 倍 `limit` 的整十数。
4. **±MAE 参考带**：沿对角线两侧各偏 `hotMae` 分钟画一条浅色带
   （`fill-accent-primary/8`）。非线性刻度下带宽不是常数，所以用 32 个采样点
   算出上下沿再拼成一个 `<polygon>`：上沿 `(t(x), t(x + mae))`，下沿
   `(t(x), t(max(0, x − mae)))`。`hotMae` 为 null（无热行）时不画。
   这条带把「典型误差」变成可看的东西：带外的点就是超出平均水平的失手。
5. **空态**：`filtered.length === 0` 时不画空坐标系，换成
   `<DtEmpty title="这个组合没有折外预测" hint="换一个组合，或先重训模型。" />`。

着色规则不变（现有 `paintOf` 已经对）：区间没盖住实际值 → `fill-state-warning`；
零行且判对 → `fill-text-disabled/40`；其余 → `fill-accent-primary/70`。

无障碍：`role="img"` + `aria-label` 保留，另在 SVG **下方**给一行可见文字摘要
（不是 `sr-only`，这句话对所有人都有用）：
`共 785 点，其中 96 点的 80% 区间未盖住实际值（12%）。`

#### 4d. 误差分布直方图 `ErrorHistogram.vue`（新）

- **画什么**：热行的**有符号**误差 `p50 − actual_minutes` 的分布。
  ⚠ 有符号而不是绝对值：**偏差方向是行动信息**。系统性低估（预测比实际短）
  会让人按不足的提前量开机，比「误差大」更要命；绝对值直方图把这件事抹平了。
- **分箱**：`w = Math.max(1, Math.ceil(hotMae / 2))` 分钟，11 个箱 `i ∈ [-5, 5]`，
  箱 `i` 覆盖 `[(i - 0.5)w, (i + 0.5)w)`；`i = -5` 吸收所有 `≤ -4.5w`，
  `i = 5` 吸收所有 `≥ +4.5w`。
- **配色**：`i < 0`（低估）`fill-state-warning`；`i = 0` `fill-accent-primary`；
  `i > 0`（高估）`fill-accent-primary/50`。
- **轴标签**只标三个：最左 `≤ -{4.5w}`、中间 `0`、最右 `≥ +{4.5w}`（分钟）。
  每根条挂 `<title>`：`误差 +3 ~ +5 分钟：47 条`。
- **下方一行**：`中位偏差 −1.4 分钟（预测偏短，提前量会不够）` /
  `中位偏差 +0.8 分钟（预测偏长）` / `|中位偏差| < 0.1 时写「基本无系统偏差」`。
  取 `median(p50 − actual)` over `hotRows`。
- 手写 SVG，`viewBox="0 0 320 176"` + `class="h-44 w-full"`（宽度自适应），
  `preserveAspectRatio="none"` **不要用**——会把条压变形；用 `xMidYMid meet`。
- `hotRows` 为空 → 整块换成一句 `text-xs text-text-secondary`
  「这个组合没有热行（全部开机都是一开机就已达标），画不出误差分布。」

#### 4e. 按折稳定性 `FoldStabilityBar.vue`（新）

一行 5 根（K 折数按数据里实际出现的 `fold` 去重排序，不写死 5）横向小条：

```
按折稳定性（热行 MAE）  ⓘ
折1 ▇▇▇▇      12.1     折2 ▇▇▇       10.4     折3 ▇▇▇▇▇▇   15.8  …
```

- 条长按各折 `hotMae` 对最大值归一，`DtProgress size="sm"` 即可（`:value` `:max`）。
- 某折的热行数为 0 → 该折显示 `—` 并 `opacity-50`，不画条。
- 挂一枚 `DtHelpTip`：`评估按开机时间切成连续的几段，每段轮流当「模型没见过」的那一折。某一折明显更差，说明那段时间的运行模式和其它时候不一样。`

**为什么做这个而不是按折分面小图**：分面小图要 5 张各自带坐标系的散点，占掉
半屏，而它回答的问题只有一个——「模型在时间上稳不稳」。一行 5 个数字加 5 根条
把同一个问题答完了，成本是它的十分之一。真要下钻某一折，⑥ 表有 `fold` 列。

#### 4f. 误差最大的 5 次 `TopErrorList.vue`（新）

`grid gap-2 sm:grid-cols-2 xl:grid-cols-5`，每张小卡：

```
┌────────────────────────┐
│ 08-03 14:22   [零行]   │  ← 起始时刻 + 零行标（actual === 0 时才有）
│ K01+K03                │  ← font-mono text-2xs
│ 实际 0 → 预测 41.2     │
│ 误差 +41.2 分钟        │  ← text-state-warning
└────────────────────────┘
```

只读，不可点。它回答的是「这模型错得最离谱的是哪几次」——一个不动分页、
数据已经在手里的问题。⚠ 不要给它做成「点一下跳到 ⑥ 表对应行」：那条记录多半
不在当前页，跳过去要重算页码，而 `/predictions` 端点不支持按 `started_at` 定位。

#### 4g. 脚注

一行 `text-2xs text-text-disabled`：

- 加载中：`已载入 400 / 785 条…`（`DtSpinner :size="12"` 前缀）
- 完成：`共 785 条折外预测，图上画了 785 条`
- 命中上限：`共 3120 条折外预测，图上画了 2000 条（超出部分未画）` + 一枚 `DtHelpTip` 说明上限存在的原因

### 3.5 ⑤ 按服务组合 `SetMetricsTable.vue`（改）

列（`minWidth: '60rem'`，`layout.fill: false`——它是页面里的一张小表，按内容高度渲染）：

```ts
[
  { key: 'set',         label: '组合',       width: '14rem',  card: 'title' },
  { key: 'count',       label: '样本',       width: '8rem',   align: 'right' },
  { key: 'r2',          label: '热行 R²',    width: '6.5rem', align: 'right' },
  { key: 'mae',         label: '热行 MAE',   width: '8rem',   align: 'right' },
  { key: 'coverage',    label: '热行覆盖率', width: '7rem',   align: 'right' },
  { key: 'width',       label: '区间宽度',   width: '8rem',   align: 'right' },
  { key: 'zeroHit',     label: '判零率',     width: '6rem',   align: 'right' },
  { key: 'hotHit',      label: '判出率',     width: '6rem',   align: 'right' },
  { key: 'reliability', label: '可靠性',     width: '8rem' },
]
```

相对现状加了 `r2` 与 `hotHit` 两列（判出率是 §2.3 明列的指标，现在漏了）。

**行点击 = 过滤**：整行做成可点（`cell-set` 里包一个 `<button class="w-full text-left">`），
点一下把该组合写进 §3.4b 的同一个 `setFilter`，再点一次回「全部组合」。
选中行 `bg-accent-primary/10 text-accent-primary` + `aria-pressed`。
⚠ 不另开第二个筛选器——同 `CoverageSidebar` 的教训。

无样本的组合（`by_set[key] === null`）照旧列出并标「无样本」、`opacity-50`，
**不可点**（`disabled`，`:title="这个组合还没有可用事件"`）。⚠ 藏起来的话，
用户不知道自己勾的组合根本没攒到事件，也就无从解释推荐里那个宽得离谱的区间。

### 3.6 ⑥ 折外逐条 `PredictionTable.vue`（改）

在现有基础上加一列 `fold`：

```ts
[
  { key: 'started',  label: '起始时刻', width: '12rem', card: 'title' },
  { key: 'set',      label: '组合',     width: '12rem', card: 'meta' },
  { key: 'fold',     label: '折',       width: '4rem',  align: 'right' },
  { key: 'actual',   label: '实际',     width: '7rem',  align: 'right' },
  { key: 'p50',      label: '预测 p50', width: '8rem',  align: 'right' },
  { key: 'interval', label: '80% 区间', width: '10rem', align: 'right' },
  { key: 'error',    label: '误差',     width: '7rem',  align: 'right' },
]
```

`fold` 列的存在理由：它是这条预测的**出处**——「这一折训练时模型没见过它」
正是折外预测可信的原因，也让 §3.4e 的按折结论能被逐条核对。
表头 `label` 只有一个「折」字，含义靠卡片头部的 `DtHelpTip` 统一解释。

其余不变：页码分页（`DtPaginationState`，页码直选 + 每页条数）、
组合过滤走服务端（`running_set` 逗号分隔）、区间没盖住实际值时
`interval` 单元格 `text-state-warning`。

**过滤只有组合这一个维度**。不做「只看热行」「只看漏盖」：
⚠ 服务端不支持这两个条件，客户端过滤会撕裂分页——当前页 20 条里筛剩 3 条，
分页器却仍显示总数 785、共 40 页，用户点第 2 页看到的是另一批被筛过的残页。
「找出错得最离谱的几条」这个真实需求由 §3.4f 的 Top 5 满足。

换过滤条件必须 `reloadFromFirstPage()`（现状已有，保留）。

### 3.7 为什么不引入 echarts 散点

**结论：继续手写 SVG，不加 echarts 的 ScatterChart。**

- **代价**：echarts 现在只注册了折线图，bundle 预算闸卡着。加散点要引入
  `ScatterChart` + `GridComponent` 一系列坐标系模块，量级在百 KB 上下（gzip 前），
  而这条闸门是全站共享的预算。
- **换不到什么**：这两张图要的全部能力是「画点、画一条线、画一个多边形带、
  画几根条」。echarts 的价值在缩放、刷选、大数据量 canvas 渲染与丰富的
  tooltip——这里一个都不需要（2000 点以内 SVG 完全撑得住）。
- **反而会失去**：现有 SVG 用语义 class（`fill-accent-primary/70`、
  `stroke-border-strong`）着色，六套主题换肤是白拿的；echarts 要在 JS 里读
  CSS 变量并在换肤时手动 `setOption`，还得记得在卸载时 `dispose`
  （项目里已经为此吃过资源泄漏的亏）。
- **什么情况下才该重议**：单模型折外预测常态超过 5000 条、且用户明确需要
  框选下钻。那时的正解也未必是 echarts，可能是 canvas。

---

## 4. 实时测试弹窗 `LiveTestDialog.vue`

替换掉详情页现有的 `RecommendPanel.vue`（连同 `ComparisonCard.vue` 一起删）。
`RecommendEntryCard.vue` **保留并复用**——结果卡的样式与语义完全对得上。

### 4.1 入口

详情页头部 `#actions` 第一颗按钮：

```html
<DtButton intent="primary" size="sm" icon="activity"
          :disabled="model === null || model.trained_at === null"
          @click="isLiveTestOpen = true">
  实时测试
</DtButton>
```

不需要 `ac:manage`——`:recommend` 是纯计算读操作，auth catalog 的窄规则
（priority 906）已经放给 `ac:view`（§5.4）。所以**不包 `PermGuard`**。

`trained_at === null`（从来没成功训练过）时 `disabled`，外面套
`<DtTooltip content="还没有一次成功的训练，训练完成后可用">`。
⚠ 门槛是 `trained_at` 不是 `status`：`status === 'failed'` 的模型可能带着
上一次成功训练的工件，那种情况下推荐是能算的（见 §4.5）。

**列表行不给快捷入口。** 理由：(a) 操作列已有三颗键，第四颗把列挤爆；
(b) 推荐结果必须配合该模型的评估质量一起读（可靠性、组合覆盖、是否专属），
脱离详情页容易被当成权威结论；(c) 一个房间有多个模型时「用哪个测」本身是个
判断，先进详情选定模型再测，这条路径更诚实。

### 4.2 交互流

```
点「实时测试」
      │
      ▼
DtModal 打开，立刻发 GET /rooms/{room_id}/live-readings
      │
      ├─ 503 ────────────────► 状态 E1：数据源不可达（不出旧数据）
      ├─ units 为空数组 ─────► 状态 E2：房间没绑机组（终止）
      ├─ 其它错误 ───────────► 状态 E3：取数失败 + 重试
      │
      ▼ 成功
把读数转成 recommend 入参（null 字段**省略**不发）
      │
      ├─ 全部机组都无读数 ──► 状态 W1：窗内无数据（不自动推荐，给「仍要按未知条件试算」）
      │
      ▼ 至少一台有读数
自动发 POST /ac-models/{id}:recommend
      │
      ├─ 422 ───────────────► 状态 E4：工件不认识这些机组，提示重训
      ├─ 其它错误 ──────────► 状态 E5：推荐失败 + 重试
      ▼
状态 R：出结果（组合建议 + 依据与调整）
```

**打开即自动出结果，用户不用点第二次**——这是这个弹窗存在的全部意义。

### 4.3 弹窗布局

`DtModal width="48rem" title="实时测试" description="按房间当前的实时工况，比较各个开机组合要等多久"`。
Modal 自带焦点陷阱、Esc 关闭、body 内滚（`__body` 是 `overflow-y-auto`），
header/footer 不跟着滚——长内容不用自己做滚动容器。

```
┌ 实时测试 ──────────────────────────────────────────────────── ✕ ┐
│ 按房间当前的实时工况，比较各个开机组合要等多久                     │
├──────────────────────────────────────────────────────────────────┤
│ [DtNotice 警告区：陈旧 / 部分缺数 / 用的是上一次工件 / 已手动调整]  │
│                                                                  │
│ 组合建议                                                          │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ K01+K03            [推荐]                                    │ │
│ │ 12.4 分钟   80% 区间 6.1 – 24.8                              │ │
│ │ 开机即达标 18%  [可靠]  [组合专属模型]                        │ │
│ └──────────────────────────────────────────────────────────────┘ │
│ ┌ K01+K03+K04   11.8 分钟 …                                    ┐ │
│ └──────────────────────────────────────────────────────────────┘ │
│ ⚠ 有 2 个服务组合没有出数：K05+K06、K05 —— 模型工件里没有这些机组   │
│                                                                  │
│ ── 依据与调整 ─────────────────────────────────────────────────  │
│ 取数于 12:31:05 · 回看 15 分钟                                    │
│ ┌ 机组读数表 ───────────────────────────────────────────────────┐ │
│ │ 机组  采样      运行  房间温/湿   新风温/湿   冷冻水供水        │ │
│ │ K01   2 分钟前  运行  24.1 / 58   31.2 / 71   8.4             │ │
│ │ K03   2 分钟前  停机  24.3 / 59   —  /  —     —               │ │
│ │ K04   —         未知  无数据                                  │ │
│ └───────────────────────────────────────────────────────────────┘ │
│ 全停时长（分钟，可空） [        ]  开机前房间停了多久；不知道就留空  │
│ ☐ 手动微调读数                                                    │
│                                      [ 按调整后条件重算 ]         │
├──────────────────────────────────────────────────────────────────┤
│                          [ 关闭 ]   [ 重新取数并推荐 ]            │
└──────────────────────────────────────────────────────────────────┘
```

**为什么结论在上、依据在下**：用户打开这个弹窗是为了拿一个答案。但读数的
新鲜度是答案的**有效性前提**而不只是佐证，所以把「陈旧 / 缺数 / 用的是旧工件」
提成顶部的 `DtNotice`，把逐台读数留在下面供核对。`全停时长` 与 `手动微调` 是
可选的二次调整，紧挨着它们要修改的读数放，配一颗就地重算的键。

**两颗动作键语义不同，不许合并**：

| 按钮 | 位置 | 干什么 | 何时可用 |
|---|---|---|---|
| `按调整后条件重算` | 「依据与调整」区右下，`variant="outline" size="sm"` | **不重新取数**，用屏幕上当前的读数 + 用户的改动重新推荐 | 仅当 `idle_minutes` 或任一读数被改动过；否则 `disabled` + `:title="改动全停时长或读数后可用"` |
| `重新取数并推荐` | footer 主键，`intent="primary"` | 丢弃手动改动，重新拉 live-readings 再推荐 | 除取数中/推荐中外总是可用 |

⚠ 图标注册表里**没有 refresh / rotate / reload**，刷新键只用文字，不要臆造图标名
——未登记的名字 `DtIcon` 静默不渲染，typecheck 和 lint 都不会报。

### 4.4 机组读数表 `LiveReadingsTable.vue`

`DtDataView view="table"`，`layout = { toggle: false, minWidth: '40rem', fill: false }`。

```ts
[
  { key: 'serial',   label: '机组',       width: '6rem',  card: 'title' },
  { key: 'sampled',  label: '采样',       width: '7rem' },
  { key: 'running',  label: '运行',       width: '5rem' },
  { key: 'room',     label: '房间温/湿',  width: '9rem',  align: 'right' },
  { key: 'fresh',    label: '新风温/湿',  width: '9rem',  align: 'right' },
  { key: 'chilled',  label: '冷冻水供水', width: '8rem',  align: 'right' },
]
```

- `serial`：`font-mono text-xs`。
- `sampled`：`formatSince(sampled_at, now)` → `刚刚` / `2 分钟前` / `3 小时前` / `2 天前`，
  `:title` 给绝对时刻。`sampled_at === null` → `—`。
  **陈旧**（`as_of − sampled_at > LIVE_STALE_MINUTES`，= 5）→ `text-state-warning`。
  ⚠ 相对时间不会自己走：弹窗打开期间挂一个 30s 的 `setInterval` 刷新 `now` ref，
  **关闭与卸载都要清掉**。
- `running`：三态，`DtTag size="sm"`
  | `is_running` | intent | 文案 |
  |---|---|---|
  | `true` | `neutral` | 运行 |
  | `false` | `neutral` | 停机 |
  | `null` | `warning` | 未知 |

  表头「运行」旁挂 `DtHelpTip`：`窗内没有这台的任何一行数据时是「未知」，不代表它一定停着。运行状态只供你判断读数可不可信，不参与推荐计算。`
  ⚠ 最后半句必须写：`is_running` 确实不在 `:recommend` 的五个入参字段里，不说清楚用户会以为它影响结果。
- 数值列：`24.1 / 58` 形式，任一为 null 写 `—`。**整台都没读数**（五个字段全 null）
  时，三列合并语义上不成立（DtDataView 不支持跨列），改为每列都渲染
  `<span class="text-text-disabled">无数据</span>`，并给整行加 `opacity-60`。

**手动微调**（`DtCheckbox` 勾上后）：三个数值列换成成对的 `DtNumberInput size="sm" :steppers="false"`
（房间温 / 房间湿 / 新风温 / 新风湿 / 冷冻水供水，共 5 个），预填实时值，
**清空 = 缺测**。

- **为什么默认收起**：读数是自动来的，微调是 power-user 的「如果新风再热 3 度会
  怎样」。默认展开就把一个「读当前」的弹窗变成一张 5×N 的表单，喧宾夺主。
- ⚠ **一旦有任何手动改动，顶部必须挂一条 `DtNotice intent="warning"`
  「结果基于手动调整过的读数，不是当前实时工况」，且结果区标题旁挂一枚
  `DtTag intent="warning"`「已手动调整」。** 不标的话用户会把假想结果当成实时结论
  拿去开机。
- 取消勾选 → 丢弃全部改动，恢复实时值，并把「已手动调整」标记清掉。

**全停时长**：`DtNumberInput label="全停时长（分钟，可空）" hint="开机前房间停了多久；不知道就留空——留空按未知处理，不会当成刚停就开" :range="{ min: 0, max: 100000 }" :steppers="false"`。
默认空。**不做自动推断**：`live-readings` 里没有这个信息，`is_running` 只说明
此刻，不说明停了多久；编一个值出来会把「不知道」伪装成「知道」。

### 4.5 全部状态清单

| 代号 | 触发 | 呈现 | 可继续？ |
|---|---|---|---|
| **L1** 取数中 | 打开弹窗后 | body 里 `DtSkeleton :lines="6"`，顶部一行 `DtSpinner :size="14"` + `正在读取实时工况…`；footer 主键 `:loading="true"` | — |
| **L2** 推荐中 | 读数到手后自动发起 | 读数表已渲染（依据先出来），结果区 `DtSpinner` + `正在比较 N 个组合…`（N = `serving_sets.length`） | — |
| **R** 出结果 | 推荐成功 | 结果卡列表（`RecommendEntryCard`）+ 未出数组合提示 | 是 |
| **E1** 数据源不可达 | live-readings 返回 503 | `DtNotice intent="danger"`：`实时数据源现在读不到，没有可用的当前工况。这里不会拿旧数据顶上。` + `[重试]` + 次要键 `[仍要按未知条件试算]` | 见下 |
| **E2** 房间没绑机组 | `units` 为空数组 | `DtNotice intent="warning"`：`这个房间还没有绑定空调机组，取不到工况。先在台账页把空调挂到这个房间上。` | **否**，隐藏结果区与调整区，footer 只留「关闭」 |
| **E3** 取数失败（其它） | 非 503 的错误 | `DtNotice intent="danger"` + `describeError` 全文 + `[重试]` | 重试 |
| **W1** 窗内全无数据 | 所有机组 `sampled_at` 均为 null | `DtNotice intent="warning"`：`回看 15 分钟内没有任何读数——机组可能已停，也可能是采集中断。` **不自动推荐**，给一颗 `[仍要按未知条件试算]` | 手动继续 |
| **W2** 部分机组缺数 | 部分 `sampled_at` 为 null 或读数全空 | 照常自动推荐；`DtNotice intent="info"`：`N 台机组窗内没有读数，它们的条件按未知处理。` 表里对应行标「无数据」 | 是 |
| **W3** 读数陈旧 | 任一台 `as_of − sampled_at > 5 分钟` | `DtNotice intent="warning"`：`有 N 台的最新读数已经是 X 分钟前的了，结果可能反映不了当下。` 表里该行采样列标警示色 | 是 |
| **E4** 组合全被跳过 | recommend 返回 422 | `DtNotice intent="danger"`：`模型工件里没有这些机组（多半是训练之后新加的），所有服务组合都算不了。重训模型后即可使用。` + `PermGuard(ac:manage)` 包一颗 `[去重训]`（关弹窗 → 触发 `retrain()`） | 否 |
| **E5** 推荐失败（其它） | 非 422 的错误 | `DtNotice intent="danger"` + `describeError` + `[重试推荐]`（不重新取数） | 重试 |
| **M1** 模型在重训 | 打开时 `isModelBusy(model)` 且 `trained_at !== null` | 顶部 `DtNotice intent="info"`：`模型正在重训；这次用的是上一次训练的工件，与页面上的评估同源。` | 是 |
| **M2** 上次重训失败 | `status === 'failed'` 且 `trained_at !== null` | 顶部 `DtNotice intent="warning"`：`上一次重训失败了，这里用的是更早那一次成功训练的工件（{trained_at}）。` | 是 |
| **M3** 从未训练成功 | `trained_at === null` | **弹窗打不开**，按钮 `disabled` + `DtTooltip` | — |

**关于 E1/W1 的「仍要按未知条件试算」**：它发一个 `readings: {}` 的推荐请求
（森林原生吃 NaN，缺测不插值）。按钮是 `variant="ghost" size="sm"`，点了之后
结果区顶部挂 `DtNotice intent="warning"`：
`这次没有任何实时读数，结果只反映时段、季节与组合本身，不含当前温湿度。`
默认路径仍然是安全的（不给读数就不出数），这颗键只是不替 power user 挡路。

**未出数的组合**（`result.items.length < model.serving_sets.length`）：
在结果卡列表**下方**列出缺席的组合键，`DtNotice intent="warning"`：
`有 N 个服务组合没有出数：K05+K06、K05 —— 模型工件里没有这些机组，重训后可比。`
⚠ 必须列出来。静默少几行 = 用户以为那些组合不存在。

### 4.6 读数 → 推荐入参的转换

放在 `web/app/src/features/hvac/liveTest.ts`（新）：

```ts
/** 一台的实时读数 → 推荐入参。⚠ null 的字段**整个省略**，不发 null 也不填 0。 */
export function toPredictReadings(values: AcUnitReadingValues): ModelPredictReadings
```

⚠ 这是最容易出错的一处：`ModelPredictReadings` 的字段是**可选**的
（`workshop_temp_avg?: number`），语义是「省略 = 缺测」；而 live-readings
给的是 `number | null`。把 null 原样塞进去会变成 JSON 的 `null`，
和「没这个字段」不是一回事。转换后若一台的五个字段全都省了，那台**整个不进**
`readings` 字典（与现有 `RecommendPanel` 的做法一致）。

同文件里还有：

```ts
/** as_of 与 sampled_at 差多少分钟；sampled_at 为 null 返回 null。 */
export function stalenessMinutes(asOf: string, sampledAt: string | null): number | null
export const LIVE_STALE_MINUTES = 5
```

`LIVE_STALE_MINUTES = 5` 的依据：EMS 侧是秒级到分钟级的采集周期，5 分钟没有
新行说明这台的采集出了问题，而不是正常抖动。它小于后端 15 分钟的回看窗——
窗内有数据但已经很旧，正是最需要提醒的那种情况。

---

## 5. 组件映射表

### 5.1 列表页

| UI 元素 | 用什么 | 文件 |
|---|---|---|
| 页面外壳 / 返回 / #actions | `AppShell` | `web/app/src/components/layout/AppShell.vue` |
| 左栏容器 | 手写 `<aside>`（照抄 CoverageSidebar 骨架） | `pages/Hvac/Models/components/RoomSidebar.vue`（新） |
| 房间筛选框 | `DtInput type="search" size="sm"` + `#leading` 里 `DtIcon name="search"` | 同上 |
| 房间行 | 手写 `<button>` + `DtTag size="sm"`（计数）+ `DtBadge dot`（训练中） | 同上 |
| 左栏空态 | `DtEmpty icon="building"` | 同上 |
| 分组/排序/计数的纯函数 | — | `pages/Hvac/Models/roomGroups.ts`（新） |
| 右区头部 | 手写 `<h2>` + `DtButton`（`PermGuard` 包） | `pages/Hvac/Models/index.vue`（改） |
| 模型表 | `DtDataView view="table"` + `DtTag` + `DtButton` + `DtHelpTip`（在 `#toolbar`） | `pages/Hvac/Models/components/ModelTable.vue`（改） |
| 权限门 | `PermGuard :codes="[PERMISSION_CODES.acManage]"` | `components/PermGuard.vue` |
| 删除确认 | `useConfirm().ask({ danger: true })` | `@dt/ui` |
| 成功/失败提示 | `useToast()` | `@dt/ui` |
| 新建对话框 | `DtModal` + `DtSelect` + `DtInput` + `DtCheckbox` + `DtNumberInput` + `DtNotice` | `pages/Hvac/Models/components/CreateModelDialog.vue`（改：加 `roomId` 预填） |
| 行映射 / 格式化 | — | `features/hvac/modelView.ts`（改） |
| 取数防竞态 | `useRacedFetch()` | `composables/useRacedFetch.ts` |

### 5.2 详情页

| UI 元素 | 用什么 | 文件 |
|---|---|---|
| ① 状态条 | `DtTag` + `DtNotice` | `pages/Hvac/ModelDetail/index.vue`（改） |
| ② 出处条 | 手写 `<span>` 行 + `DtHelpTip` | `components/ProvenanceStrip.vue`（新） |
| ③ 评估摘要八格 | `DtCard`（每格一张）+ `DtTag` + `DtHelpTip` | `components/MetricsSummary.vue`（改） |
| ④ 折外总览卡 | `DtCard` + `DtSelect` + `DtSegmented` | `components/OutOfFoldCard.vue`（新） |
| ④ 散点 | 手写 SVG | `components/PredictionScatter.vue`（改） |
| ④ 误差直方图 | 手写 SVG | `components/ErrorHistogram.vue`（新） |
| ④ 按折稳定性 | `DtProgress size="sm"` + `DtHelpTip` | `components/FoldStabilityBar.vue`（新） |
| ④ Top 5 误差 | 手写小卡 grid + `DtTag` | `components/TopErrorList.vue`（新） |
| ④ 全量取数与派生 | — | `pages/Hvac/ModelDetail/useOutOfFold.ts`（新） |
| ⑤ 按组合表 | `DtDataView view="table"` + `DtTag` | `components/SetMetricsTable.vue`（改） |
| ⑥ 逐条表 | `DtDataView view="table"` + `DtPaginationState` | `components/PredictionTable.vue`（改） |
| ⑥ 分页取数 | `useAsyncList()` | `composables/useAsyncList.ts` |
| **删除** | — | `components/ComparisonCard.vue`、`components/RecommendPanel.vue` |

### 5.3 实时测试弹窗

| UI 元素 | 用什么 | 文件 |
|---|---|---|
| 弹窗外壳 | `DtModal width="48rem"` + `#footer` 插槽 | `components/LiveTestDialog.vue`（新） |
| 入口按钮 | `DtButton icon="activity"` + `DtTooltip`（禁用时） | `pages/Hvac/ModelDetail/index.vue` |
| 各类提示 | `DtNotice`（intent 见 §4.5） | `LiveTestDialog.vue` |
| 加载态 | `DtSkeleton :lines="6"` / `DtSpinner :size="14"` | `LiveTestDialog.vue` |
| 结果卡 | `RecommendEntryCard`（**复用，不改**） | `components/RecommendEntryCard.vue` |
| 机组读数表 | `DtDataView view="table"` + `DtTag` + `DtHelpTip` | `components/LiveReadingsTable.vue`（新） |
| 微调输入 | `DtCheckbox` + `DtNumberInput size="sm" :steppers="false"` | `LiveReadingsTable.vue` |
| 全停时长 | `DtNumberInput` | `LiveTestDialog.vue` |
| 状态机与取数 | — | `pages/Hvac/ModelDetail/useLiveTest.ts`（新） |
| 读数转换 / 陈旧判定 | — | `features/hvac/liveTest.ts`（新） |

### 5.4 需要新增/改动的非组件文件

| 文件 | 改什么 |
|---|---|
| `web/packages/contracts/src/hvac.ts` | `ModelErrorStats` 加 `r2: number \| null`（`hot` 是同一个类型，整体与热行因此各得一份）；新增 `AcUnitReadingValues` / `AcUnitLiveReading` / `RoomLiveReadings`；在 `index.ts` 导出 |
| `web/app/src/api/hvac.ts` | 新增 `getRoomLiveReadings(roomId): Promise<RoomLiveReadings>`，路径 `/rooms/${roomId}/live-readings`，`onPlatform()` |
| `web/app/src/features/hvac/modelView.ts` | 新增 `formatR2()` / `r2Intent()`；`toModelRows` 补 r2、覆盖率副行、相对训练时间、组合摘要；`toSetRows` 补 `r2` 与 `hotHit` |
| `web/app/src/utils/datetime.ts` | 新增 `formatSince(value: string, now?: Date): string` —— `刚刚`（<60s，含未来时刻的时钟偏差）/ `N 分钟前` / `N 小时前` / `N 天前` |

契约类型待补（与后端 openapi 对齐，CI 有一致性闸）。后端已落地，两侧类名对照
（前端名是手挑的、不是机械去掉 `Out`，跨仓 grep 时照这张表走）：

| 前端 `contracts/src/hvac.ts` | 后端 `schemas/ac_data.py` |
|---|---|
| `AcUnitReadingValues` | `LiveReadingValuesOut` |
| `AcUnitLiveReading` | `LiveUnitReadingOut` |
| `RoomLiveReadings` | `LiveReadingsOut` |

`r2` 后端已加在 `ErrorStatsOut` **与** `MetricsBlockOut` 两处，所以
`graded = overall.hot ?? overall` 之后 `graded.r2` 在两个分支上都存在，
前端不需要为「整体 / 热行」分叉。

```ts
/** 一台机组的五项实时读数。⚠ 全部可空，null = 窗内没读到，不是 0。 */
export interface AcUnitReadingValues {
  workshop_temp_avg: number | null
  workshop_humidity_avg: number | null
  fresh_air_temp: number | null
  fresh_air_humidity: number | null
  chilled_water_supply_temp: number | null
}

/** 回看窗内某台的最后一行。⚠ `is_running` 三态：null = 未知，不等于停机。 */
export interface AcUnitLiveReading {
  serial: string
  sampled_at: string | null
  is_running: boolean | null
  readings: AcUnitReadingValues
}

/** 房间的实时工况快照。⚠ 外库不可达时是 503，绝不返回旧数据。 */
export interface RoomLiveReadings {
  as_of: string
  lookback_minutes: number
  units: AcUnitLiveReading[]
}
```

---

## 6. 边界情况清单

| # | 情况 | 界面必须怎样 |
|---|---|---|
| 1 | **房间列表为空** | 左栏 `DtEmpty icon="building" title="还没有配置房间"`，右区同样一份空态；不渲染「新建模型」（没有房间可选） |
| 2 | **房间没有空调**（`ac_unit_count === 0` 且无模型） | 不进左栏；栏底一行「另有 N 个房间没有空调，不能建模」。⚠ 静默过滤是禁止的 |
| 3 | **房间没有空调但有历史模型** | 照常进左栏（`ac_unit_count > 0 \|\| 模型数 > 0`），否则那些模型无从查看与删除 |
| 4 | **选中房间无模型** | 右区 `DtDataView` 内建空态：「这个房间还没有模型」+ 指向右上角的新建键 |
| 5 | **`?room=` 指向不存在的房间** | 静默走 §1.2 的兜底并把兜底结果写回 query；不报错、不弹 toast |
| 6 | **训练中 / 排队中** | 列表：状态 Tag + 5s 轮询 + 左栏该房间一枚 info 圆点；行上的评估数字**照旧显示上一次的**。详情：状态条挂进度说明，③④⑤⑥ 全部继续显示上一次的评估。⚠ 半份/空数据比旧数据危险 |
| 7 | **训练由 busy 转终态** | 详情页要主动刷新 §3.4a 的全量折外与 §3.6 的分页表（折外预测在训练完成时被整体替换）。现有 `wasBusy && !isBusy` 的判断保留并扩展到 `useOutOfFold.reload()` |
| 8 | **`failed` 且带着上一次的评估** | 状态 Tag = 失败（danger）+ `DtNotice` 显示 `error` 全文；**指标区照常渲染**上一次的数字，不清空。⚠「失败」与「有指标」可以同时成立，不许写成互斥分支 |
| 9 | **`failed` 且从未训练成功** | `metrics === null` → ③ 位置换成 `DtNotice intent="info"`「还没有一次成功的训练。」；④⑤⑥ 不渲染；「实时测试」按钮 disabled |
| 10 | **`r2 === null`** | 渲染 `—`（`text-text-disabled`），**绝不渲染 0.00**；成因（老评估 / 热行无离散度）由 help tip 讲，不在单元格里猜；按 R² 排序时这些行恒排末尾 |
| 11 | **`r2` 为负数** | 照实显示（`-0.14`）并标 `text-state-danger`。它的含义是「比永远猜平均值还差」，是真信号 |
| 12 | **老评估没有热行拆分**（`hot === null`） | `graded = overall.hot ?? overall` 退回整体值照旧渲染；此时第 8 格「整体口径」与前几格同源，不做特殊处理（重训后自然分开） |
| 13 | **`is_batch_stale`** | 列表：名称副行「数据已更新，可重训」（warning）。详情：状态条同文案。⚠ 它**不是失效**——训练产物照常可用，措辞不能吓人 |
| 14 | **`is_feature_stale`** | 同上，文案「特征口径已更新，建议重训」。两者同时为真时**只显示 batch 那条**（一行只说最要紧的一件事，沿用现有 `noticeOf` 的优先级） |
| 15 | **`by_set` 里某组合是 null** | ⑤ 表照常列出该行、标「无样本」、`opacity-50`、行不可点。⚠ 藏起来 = 把「这个组合没数据」说成「这个组合没问题」 |
| 16 | **`serving_sets` 含工件不认识的机组** | 推荐时后端跳过该组合；前端在结果下方列出缺席的组合键并说明原因（§4.5）。全部被跳过 → 422 → 状态 E4 + 「去重训」 |
| 17 | **折外预测一条都没有** | ④ 整块换 `DtEmpty`；⑥ 走 `DtDataView` 空态「还没有折外预测」 |
| 18 | **某组合过滤后一条折外都没有** | ④ 散点区 `DtEmpty title="这个组合没有折外预测"`；⑥ 表空态 |
| 19 | **过滤后热行为空**（全是零行） | 直方图与按折稳定性各自换成一句说明，不画空图；散点照常画（零行也是点） |
| 20 | **折外条数超过 2000** | 图画前 2000 条，脚注写明「超出部分未画」+ `DtHelpTip`；⑥ 表不受影响（服务端分页，完整） |
| 21 | **live-readings 503** | 状态 E1：明说「不会拿旧数据顶上」，给重试与「仍要按未知条件试算」 |
| 22 | **房间没绑机组**（`units: []`） | 状态 E2：终止，指向台账页；隐藏结果区与调整区 |
| 23 | **某台 `sampled_at === null`** | 采样列 `—`、运行列 `未知`（warning Tag）、数值列「无数据」、整行 `opacity-60`；该台不进 `readings` 字典 |
| 24 | **读数陈旧（> 5 分钟）** | 该行采样列 `text-state-warning`；顶部 W3 提示 |
| 25 | **用户手动改过读数** | 顶部 warning `DtNotice` + 结果区标题旁 `DtTag`「已手动调整」。⚠ 两处都要，不许只标一处 |
| 26 | **弹窗开着时模型被重训完** | 不自动重算（用户可能正在看结果）；顶部挂 `DtNotice intent="info"`「模型已完成重训，点『重新取数并推荐』用新工件重算。」 |
| 27 | **只读账号（无 `ac:manage`）** | 列表：`重训`/`删除`/`新建模型` 都不渲染，`详情` 保留。详情：`重训`/`删除` 不渲染，**`实时测试` 保留**（它是纯计算读操作）。E4 里的「去重训」也包 `PermGuard` |

---

## 7. 无障碍与响应式

### 7.1 响应式断点

| 断点 | 列表页 | 详情页 ④ |
|---|---|---|
| `< lg`（< 1024px） | 左栏变成页面顶部一条 `max-h-64 shrink-0` 的可滚房间列表（沿用 `Startups/index.vue` 的先例），分组头照常渲染；右区在下 | 散点与右列上下堆叠 |
| `≥ lg` | 左右分栏，左栏 `lg:w-72 lg:max-h-none` | 仍堆叠 |
| `≥ xl`（≥ 1280px） | 同上 | `xl:grid-cols-[24rem_minmax(0,1fr)]` 左散点右（直方图 + 按折） |

- ③ 评估摘要：`grid gap-3 sm:grid-cols-2 lg:grid-cols-4`（8 格 → 4×2）。
- ④ Top 5：`grid gap-2 sm:grid-cols-2 xl:grid-cols-5`。
- 宽表格一律靠 `DtDataView` 的 `layout.minWidth` 在自己的容器里横滚；
  列表页额外开 `layout.toggle: true`，窄屏可切卡片视图。
- ⚠ 每个 grid/flex 子项都要 `min-w-0`，页面 body 永远不横滚。

### 7.2 无障碍

- 左栏根元素 `<nav aria-label="房间">`；车间分组头用 `<h3>`，每组一个 `<ul>`，
  房间是 `<li><button aria-pressed></button></li>`。
- 选中态**不只靠颜色**：`aria-pressed` + 左侧 `border-l-2` 竖条。
- 右区房间名是 `<h2>`；④⑤⑥ 各卡的标题是 `<h2>`（与现状一致）。
- `DtSegmented` 自带 `role="group"` + `aria-pressed`，必须给 `aria-label`
  （`坐标刻度`）。`DtSelect` 无可见 label 时必须给 `ariaLabel`（`按组合过滤`）。
- 两张 SVG：`role="img"` + 具体的 `aria-label`；散点下方那句可见文字摘要
  （`共 785 点，其中 96 点的 80% 区间未盖住实际值`）同时服务读屏与常人。
  单个数据点**不做键盘可达**——785 个 tabstop 是灾难；细节由 ⑥ 表承担。
- 图例是文本 + 色块，不是纯色块。
- `DtModal` 自带焦点陷阱 / Esc / 焦点归还，不要另做；打开后焦点自动落在
  header 的关闭键上（组件取 `focusables()[0]`）。
- 图标只用注册表里登记的 42 个名字（`packages/ui/src/components/DtIcon/registry.ts` 是唯一真源）：
  `user lock eye eye-off shield shield-check activity alert-circle circle-question
  more-horizontal alert-triangle arrow-right log-out users snowflake building close
  plus minus upload search pencil trash toggle-left toggle-right layout-grid
  list-checks route settings home check chevron-up chevron-down chevron-left
  chevron-right calendar table key-round palette sun moon sparkles`。
  ⚠ 未登记的名字 `DtIcon` **静默不渲染**，typecheck 与 lint 双双放行。本设计只用到三个：
  `activity`（实时测试入口）、`building`（房间空态）、`search`（左栏筛选框的 `#leading`）。
  注册表里**没有** refresh / rotate / reload / download / filter / chart 之类的名字，
  需要它们的地方一律用纯文字按钮。
- 颜色一律语义 token（`surface-* / border-* / text-* / accent-* / state-*`），
  六套主题含浅色，**禁任何硬编码色**，SVG 里也一样（用 `fill-*` / `stroke-*` 工具类）。

### 7.3 卸载清理（会静默泄漏的三处）

1. 列表页与详情页的 5s 轮询定时器 → `onBeforeUnmount` `clearInterval`。
2. 实时测试弹窗的 30s 相对时间 tick → **关闭弹窗时**和 `onBeforeUnmount` 都要清。
3. `useOutOfFold` 的分页循环 → 卸载时作废 token，让在途循环自己退出，
   不要在组件卸载后继续 `push` 到已销毁的 ref。

### 7.4 契约测试要补的几条

⚠ 模板里的 prop 名、插槽名、`DtIcon` 名写错，`vue-tsc` 与 ESLint **双双放行**。
本次重构新增的这些只能靠契约测试兜（`web/app/tests/pages/Hvac/Models/`、
`.../ModelDetail/`）：

1. `RoomSidebar` 渲染出 N 个 `aria-pressed` 按钮，选中的那个为 `true`。
2. `ModelTable` 的每个 `COLUMNS[].key` 都有对应的 `#cell-<key>` 插槽（反过来也要，多出来的插槽是死代码）。同样校验 `SetMetricsTable` / `PredictionTable` / `LiveReadingsTable`。
3. `r2 === null` 时渲染 `—` 而**不是** `0.00`；`r2 = -0.14` 时照实渲染负号而不是夹到 0。
4. `is_running === null` 渲染「未知」而**不是**「停机」。
5. 本设计用到的每个 `DtIcon` 名都在注册表里。
6. live-readings 503 时不渲染任何读数值（不出旧数据）。
