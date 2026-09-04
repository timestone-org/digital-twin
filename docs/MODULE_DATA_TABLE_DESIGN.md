# 数据表格 `data-table` —— 架构设计

> 关联：[`DASHBOARD_CHART_MODULES_DESIGN.md`](DASHBOARD_CHART_MODULES_DESIGN.md) §7 / §12 / §14 / §15 Q4、
> [`DASHBOARD_DESIGN.md`](DASHBOARD_DESIGN.md) §4–§7、[`MODULE_INFO_CARD_DESIGN.md`](MODULE_INFO_CARD_DESIGN.md)（模块落地流程的蓝本）、
> [`MODULE_PIE_CHART_DESIGN.md`](MODULE_PIE_CHART_DESIGN.md)（新模块落地的六份花名册与测试组织）。

列头 + N 行 × M 列的矩阵，回答「这一批对象的这几项分别是多少」。
`DASHBOARD_CHART_MODULES_DESIGN.md` §15 Q4 把它判为「本次盘点里唯一一个**不需要任何铺路**
就能落、且现有 15 个模块真凑不出来」的缺口——本文档是它的落地设计。

⚠ **它不是 ECharts 模块**：不套 `ChartShell`、不碰 `shared/chart/`，是一块纯 DOM 模块。
写法照 `info-list`（`rows.ts` 取值层 / `look.ts` 观感 / `rules.ts` 阈值 / `_variants.scss`），
而清单字段、逐槽状态、六份花名册与测试组织照 `pie-chart`。

---

## 0. 三句话说清它与现有 15 个模块的关系

| | 已有的画法 | 本模块 |
|---|---|---|
| 一个对象的几个数 | `info-card` 摆 6 个 KPI、`data-card` 摆可组合卡 | 不重复做 |
| 一列对象各一个数 | `info-list` 的行清单（含进度件、徽章、告警） | 不重复做 |
| **一批对象 × 几列数** | **没有**：`info-list` 凑出来没有列头、没有列对齐 | ✅ 这一块 |
| 各占多少 | `pie-chart` | 不重复做 |
| 谁比谁高（共享值轴） | 还没有，留给后续的 `bar-chart` | 不重复做 |

「12 台逆变器 × 5 列」这类矩阵今天只能用 `info-list` 的扩展指标行凑：
凑出来**没有列头**（看的人不知道第三个数是什么）、**没有列对齐**（每行的第三个数
各自居右，列与列之间不成线）。这两条正是表格这个形态存在的全部理由。

---

## 1. 数据接入：一个数组槽，行钉在配置上，列是八个固定子槽

```
bindings: [{ key: 'cellValues', dataType: 'number',
             isArray: true, isEntityPinned: true,
             arrayFields: [ c1, c2, c3, c4, c5, c6, c7, c8 ] }]
```

第 i 行第 c 列那一格喂 `cellValues[i].c`。行数跟着 `config.rows` 走
（`bindingRowCounts`），行名跟着 `config.rows[i].name` 走（`bindingRowLabels`）。
列名、单位、小数位、对齐与列宽是逐列的**配置**（`config.columns`），不从点位来。

`isEntityPinned` + `bindingRowCounts` 是同一档口径的两半，缺一不可：
漏 `bindingRowCounts` → 绑点面板摆出「新增一行」，加出来的行永远喂不到东西；
漏 `isEntityPinned` → 服务端套「索引连续且从 0 起」的校验，而错误文案说的是
「索引不连续」，跟真正的原因八竿子打不着。

### 1.1 为什么列是**固定**八个子槽，而不是跟着 `config.columns` 走

这是本模块唯一一处真正的取舍，也是它比其他数组槽模块多一层结构的原因。

`BindingSpec.arrayFields` 是**清单里的静态声明**——`defineModule({...})` 在模块注册时
求值一次，那时手上没有任何一个大屏节点，读不到某个节点的 `configJson`。
于是「列数跟着用户配了几列走」这条路根本走不通：清单是全局的，config 是逐节点的。

三条候选：

| 方案 | 结论 |
|---|---|
| 甲：`arrayFields` 由 `config.columns` 派生 | ❌ 做不到。清单是静态的，见上 |
| 乙：一列一个数组槽（`col1Values`…`col8Values`） | ❌ 八个槽 × 每槽 N 行，绑点面板要翻八次；且「第 3 行」在八个槽里各出现一次，行与实体的对应关系散了 |
| **丙：一个槽 + 八个固定子槽 `c1`…`c8`，没启用的列不渲染** | ✅ 本方案 |

八列够用：本仓真实场景里最宽的是「设备 × 功率/电压/电流/温度/效率」五列。
真要第九列时，加 `c9` 是清单里一行的事，且**不动任何存量绑定**（见 §1.2）。

代价写在这里，不藏着：属性面板上「列」这个数组项里必须挑一个**列键**，
这是用户要多理解的一个概念。用两处 `help` 与表头回落（列名留空时显示列键本身）
把它顶住。

### 1.2 两条不对称：列按**列键**认，行按**下标**认

| | 绑定的 `fieldKey` | 改配置会怎样 |
|---|---|---|
| 列 | `cellValues[i].c3` 的 **`c3`** | 调顺序、改列名、改单位、删这一列——**绑定一条都不动** |
| 行 | `cellValues[**2**].c3` 的 **2** | 删掉中间一行，它之后每一行的绑定都改喂前一行 |

这不是疏忽，是两边各自最自然的形状：列有一个用户显式挑的标识（列键），
行没有——行的身份就是它在 `rows` 里的位置。

⚠ 所以「删掉 `rows` 中间一项」是本模块唯一那条**会让绑定错位**的操作，
清单的 `help` 里逐字写着「删完请核对绑点面板」，与 `info-list` / `pie-chart` 同款。
反过来，**调列顺序是完全安全的**——这一条值得单独告诉用户，因为在别的数组槽模块里
调顺序恰恰是危险动作。

### 1.3 重复列键：只画先声明的那一条，并在表下说出来

两列挑了同一个列键，它们读的是同一个子槽，并排画两条一模一样的数比丢掉更难懂。
故只留先声明的那一条。**但丢了必须说出来**：表下面出一句
「有 N 列的列键重复，只画了先声明的那一条」。

⚠ 「列键认不出」（脏配置里写了 `c9`）那几条**不计进这个数**——它们本来就不是一列。

### 1.4 一个子槽都不给 `isRequired`

配了 8 列先接 2 列是常态。给了 `isRequired` 会让整块被判 `unbound` 并盖上状态浮层，
逐格四档白画。全仓至今零个模块用 `isRequired: true`。

---

## 2. 逐格四档：表格有格子，四档各画各的

图表族的逐槽状态只能挤在图例上（`DASHBOARD_CHART_MODULES_DESIGN.md` §8.1），
表格族有的是地方——每一档在自己那一格里画一个不同的记号：

| 档 | 记号 | 颜色 | 悬停提示 |
|---|---|---|---|
| 没配来源（`slots` 里没这个键） | `—` | `--text-disabled` | 「这一格还没绑定数据来源」 |
| `pending`（配了没首帧） | `⋯` | `--text-secondary` + 七成不透明 | 「已绑定，还没收到第一帧」 |
| `error`（取不到） | `✕` | `--state-danger` | 「取不到：<取数侧给的原因>」 |
| `ok` | 读数 + 单位 | 整表读数色，命中规则时用规则的颜色 | 命中规则时是规则的文案 |

⚠ **三个记号必须互不相同**。`info-list` 那边三档共用一个 `—`、只靠颜色分开，
是因为一行只有一格的宽度摆不下别的；表格没有这个限制，而只靠颜色分开对
色觉障碍与低对比屏是不可读的。有一条用例逐字钉着「三个记号互不相同」。

⚠ **非 `ok` 档一律不带单位**：「— kV」看着像是有读数的。

⚠ **状态按清单声明的子槽逐一去问**，不按 `slots` 的键遍历：设计态（模块库缩略图）
走 `previewBindings.ts` 那条路，`slots` 里会多出模块自己不认识的键。

⚠ **「每一格都还没绑」不算空态**：那时照画整张表，逐格四档才有地方交代。
空态只有两种，见 §4。

---

## 3. 表头与数据行共用同一份列宽模板

表格最容易出、也最难发现的错是**表头与内容错列**。根因永远是同一个：
列宽算了两遍。

本模块把它压成一条：

- 列宽只有 `cells.ts` 的 `columnsTemplateOf(columns)` 这**一个来源**；
- 它落在根节点的 `--dtb-cols-tpl` 这**一个 CSS 变量**上；
- 样式表里 `grid-template-columns` 只出现**一次**，选择器同时是 `.dtb-head` 与 `.dtb-row`。

```scss
// ⚠ 表头与数据行共用的**唯一**一份列宽模板
.dtb-head,
.dtb-row {
  display: grid;
  grid-template-columns: var(--dtb-cols-tpl, minmax(0, 1fr));
}
```

⚠ 这一条 typecheck 与 lint 都看不出问题。故 `tests/modules/data-table/look.test.ts`
里有三条源码级断言逐字守着它：整份样式表里 `grid-template-columns` 只出现一次、
那唯一一条规则的选择器列表同时含 `.dtb-head` 与 `.dtb-row`、它读的是变量而不是字面量。

模板形状：行名列打头（`minmax(0, 1.6fr)`），其后逐列——
定宽的写 `minmax(0, <width>px)`，不定宽的写 `minmax(0, 1fr)` 平分剩下的地方。
`minmax(0, …)` 的 `0` 不能省：省了之后长文本会把格子撑破，整行溢出而不是省略号。

### 3.1 `--dtb-*` 这套变量落在全局闸的盲区里

全局那道 `app/tests/contract/css-var-names.contract.spec.ts` **确实**扫
`packages/modules/src`（`info-list/look.ts` 里写着「扫不到」的那句注释是错的，
本模块落地时被它当场逮到了一个 `--bg-elevated`——本仓没有这个 token）。
但它只查**不带回落值**的 `var(--x)`，而本模块给每个 `--dtb-*` 都写了回落值
（不带回落的那条，名字一拼错整条声明直接作废，屏上表现为「这一项配了没反应」）。
两件事合起来的结果是：`--dtb-*` 的名字全局闸一个都不管。

故 `look.test.ts` 自己补两条：「联合 ⟷ scss 引用集合双向吻合」，
以及「每个 `var(--dtb-…)` 都带回落值」。

---

## 4. 滚动、钉住表头与截断

- 行多时 `.dtb-scroll` 自己滚（`overflow: auto`），表头 `position: sticky; top: 0`。
  ⚠ 钉住的表头必须给背景色，否则数据行会从表头的字底下穿过去。
- **不复用 `shared/ScrollList.vue`**：它是 `overflow: hidden` + 双副本做无缝走马灯，
  与 `position: sticky` 互斥（sticky 在 hidden 容器里没有可滚的祖先），
  且真滚起来时会把表头连同 `role` 一起复制出第二份。表格要的是「读得清」而不是「自己动」。
- `headerSticky` 与 `showHeader` 相与：表头不画时钉住谁都没有意义。
  面板上 `headerSticky` 也用 `when` 挂在 `showHeader` 下面。
- `maxRows` 截断时表下面出一句「已截断：共 N 行，只显示前 M 行。」
  ⚠ **不许静默少画**——少画几行而不吭声，看的人会把它当成现场就这么多行。
- ⚠ `bindingRowCounts` 按**全量**行给，不按截断后的行给：截断只是屏上少画几行，
  那几行的绑定还在，面板上少摆几行等于让它们再也改不了。

### 4.1 空态只有两种，各说各的

| 情形 | 文案 |
|---|---|
| 一列都没启用 | 「一列都没启用，先在「列」里挑一个列键」（写死，不可配） |
| 一行都没配 | `config.emptyText`，出厂「暂无数据」 |

合成一句「暂无数据」的代价是：看的人对着一块空白猜是哪一头没配。

---

## 5. 值规则：判据复用共用那一份，多一件事——挑列

阈值上色的口径整份复用 `shared/valueRules.ts`（`info-list` 与卡片族读的是同一份），
本模块的 `rules.ts` 只在 `itemSchema` 最前面插一格「管哪一列」。

⚠ **挑列不是装饰**：一张表里各列的量纲互不相干（温度 / 电量 / 达标率），
一条 `> 80` 套到所有列上就是给别的列乱上色，而上出来的色完全合法、没有任何报错。
默认值是空串 = 全部列，`help` 里明写了它的风险。

⚠ **规整时逐行单独过一次 `normalizeValueRules`**，而不是先整表规整再配对列号：
整表规整会把脏行滤掉、剩下的规则与原始行号错位，于是**每条规则都改判了前一条挑的列**，
而两边都不报错。`rules.test.ts` 里有一条用例逐字钉着这一点。

规则命中后只改**单元格文字颜色**（与 `blink`），不改单位与小数位。
规则的文案挂在这一格的 `title` 上——摆进格子里会把列宽撑破、逐行对不齐。

`rules` 算**内容键**：它是数据判据（哪一档算告警），不是观感。
套预设时绝不能把用户配好的阈值抹掉。

---

## 6. 配置面

| 分段 | 键 | 说明 |
|---|---|---|
| 数据 | `title` / `nameHeader` / `rows` / `precision` / `grouping` / `emptyText` | `nameHeader` 是行名那一列的列头，出厂「名称」 |
| 列 | `columns`（`key` / `name` / `unit` / `precision` / `align` / `width`） | `key` 是绑定认的那一半 |
| 样式 | `density` / `striped` / `gridLines` / `showHeader` / `headerSticky` / `maxRows` / `nameTone` / `headSize` / `nameSize` / `valueSize` / `valueColor` | |
| 规则 | `rules` | |

内容键：`title` / `nameHeader` / `columns` / `rows` / `emptyText` / `rules`。
不声明的话它们会被 `styleKeysOf` 当成观感键，别人套预设时把用户配好的列与行整片抹掉。

几处刻意的取舍：

- **列内 `precision` 是数字框且没有 `default`**：留空 = 跟随整块那一档。
  滑杆没有空态，没配时面板显示 0 而渲染按整块那一档走，两边对不上，
  而且拖过一次就再也回不到「跟随整块」。
- **列内 `unit` 不去首尾空格**：`'° C'` 这类带空格是用户显式的排版意图。
- **`width` 出厂 0 = 不定宽**，不给一个像模像样的默认宽度：给了之后
  「我没配过列宽」与「我配的正好是这个数」就分不开了。
- **行与列都出厂给一项**：空列表时模块是一块什么都没有的白板，
  而属性面板上「新增一行」不在最显眼的位置，看着像模块坏了。

---

## 7. 四套预设

`密集矩阵` / `台账清单` / `大屏看板` / `前十行`。

⚠ 每套都把观感键写全，且顺序与 `configSchema` 的书写序一致。应用预设是**浅合并**：
少写一个键，上一套留在 `configJson` 里的那个值原样残留，而点亮判定做的是子集比较、
照样把按钮点亮——既错了又没有任何提示。

⚠ `precision` 与 `grouping` 两个键**一套都不写**：它们摆在「数据」分段里，
语义却是这块屏的数值口径（三位小数就是三位小数），一套观感把它们抹掉等于让用户
配好的精度在换个样子时消失。这与 `pie-chart` 不写 `unit` / `precision` 是同一条理由。

⚠ `前十行` 那一套在 `hint` 里写清了代价：第 11 行起在屏上看不见。

---

## 8. 交互与无障碍

- 点一行上抛这一行配置里的**名称**；没起名的行点了不上抛，也不挂可点的样子。
- 吞冒泡是**有条件**的：配了行名就吞（否则同一次点击会再被「整块可点」兜底抛一个
  没有 value 的 click，toggle 类动作当场自我抵消）；没配就放它上去。
- `ownsStatusDisplay: true` —— 一格坏掉不该让整张表被浮层盖住。
  ⚠ `unbound`（整个槽一条都没绑）与 `stale` 两档仍归整格浮层，这是运行时的口径，模块管不着。
- `emitsInteractions` 与 `hostClickable` 两者都开：表格没有缩放滑块也没有拖拽手势。
- 结构走 ARIA 角色（`table` / `row` / `columnheader` / `rowheader` / `cell`）而不是
  `<table>` 元素：`display: grid` 打在 `<tr>` 上会打断表格的内建布局算法，
  而共用一份列宽模板正是本模块的核心约束。
- 闪烁在 `prefers-reduced-motion: reduce` 下退回不闪，颜色仍在——信息一点不少。

---

## 9. 目录与文件

```
web/packages/modules/src/modules/data-table/
├── manifest.ts        唯一 export default defineModule({...})
├── Component.vue      薄壳：读一次形态与表，摆表头 + N 行
├── cells.ts           取值层：槽键 / fieldKey / 列与行归一化 / 逐格四档 / 列宽模板 / 截断 / 空态
├── look.ts            观感 → CSS 变量与修饰类
├── options.ts         枚举取值表（as const satisfies readonly ConfigOption[]）
├── rules.ts           值规则：复用 shared/valueRules，多一格「管哪一列」
├── presets.ts         ConfigPreset[]，每套写全全部观感键
└── _variants.scss     样式（由 Component.vue 的 scoped 块 @use 进来）
```

⚠ 入口文件名必须是 `manifest.ts`。叫 `index.ts` 会让模块**从模块库消失且不报错**。
⚠ `manifest.ts` 里绝不静态 import `Component.vue`：注册用的 glob 是 `eager: true`。

---

## 10. 落地要改的六份花名册

| # | 路径 | 改什么 |
|---|---|---|
| 1 | `web/packages/modules/tests/manifests.contract.spec.ts` | 目录数组加 `data-table`（字典序），并把 `CELL_SLOT_KEY` / `TABLE_COLUMNS_KEY` / `TABLE_ROWS_KEY` / `TABLE_RULES_KEY` 登进 `KEY_CONSTANTS` |
| 2 | `web/packages/modules/tests/registerBuiltins.test.ts` | `BUILTIN_TYPES` 加一项 |
| 3 | `server/…/apps/dashboard/module_types.json` | `pnpm vitest run packages/modules/tests/catalog.contract.spec.ts -u` 重生成，**不许手改** |
| 4 | `server/services/platform-server/tests/contract/test_dashboard_module_catalog.py` | `EXPECTED_TYPES` 加一项 |
| 5 | `server/services/platform-server/tests/unit/test_dashboard_module_catalog.py` | `known_types()` 断言集合加一项 |
| 6 | `server/services/platform-server/tests/integration/test_dashboard_module_types_api.py` | 断言集合加一项 |

⚠ #4 与 #5 同名不同目录，只改一份的表现是另一份当场红。
⚠ `module_types.json` 是烤进 platform-server 镜像的，改了要重建镜像。

---

## 11. 一期不做的

| 不做 | 理由 |
|---|---|
| 列排序（点表头排序） | 行序就是 `rows` 的文档序，也就是绑定的下标序。点一下把第 3 行换到第 1 行，绑点面板上的「第 3 行」还在原位——屏上与面板上从此对不上。真要排序，得先给行一个与下标无关的身份 |
| 分页 | 大屏上没有翻页的手；行多用滚动，再多用 `maxRows` 截断加一句说明 |
| 单元格合并 / 分组表头 | 两者都要第二层列结构，而列已经被「八个固定子槽」钉死了。真有需求时另开议题 |
| 逐列独立的值规则**样式**（背景块、角标） | 规则现在只改文字颜色。背景块会和斑马纹、命中行的悬停底色叠三层，先看有没有人真要 |
| 历史序列列（某一列画迷你趋势） | 要接 `DASHBOARD_CHART_MODULES_DESIGN.md` §4 那条序列取数链路，本模块整块的卖点是「不需要任何铺路」，不把它拖进来 |
| 导出 CSV | 大屏是只读展示面；导出属于数据台账那条路 |
