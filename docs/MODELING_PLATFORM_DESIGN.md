# 分析建模平台化 —— 模型契约、产物、对外服务与公式接缝

> [MODELING_DESIGN.md](./MODELING_DESIGN.md) 的续篇。那份文档定的是「一条最小闭环」：
> 五类环节各一个算子、模型当公式配进台账。本文档定的是**把它做完整**——
> 模型有说得清的输入契约、产物有存放处、每个上线的模型有一个第三方能调的接口、
> 算子多到能搭出真实的分析。
>
> **只写新增与修正，不重复上一份。** 与上一份冲突的地方逐条标注「修正 §x」。
> 跨层契约变更**先改本文档、再改代码**。
>
> 涉及 **platform-server**（`apps/modeling` 扩容 + `apps/dataset` 一处公开面）、
> **web**（建模四面）、**auth-server**（权限码与闸 1 规则）、**docker/nginx**（一条免认证 location）。

---

## 0. 起因：四条诉求

| 用户说 | 工程语言 | 落在哪 |
| --- | --- | --- |
| 工作流跑完能把模型保存到 OSS，模型作为公式进公式库，台账能调它算数 | 模型产物有独立存放处（不再寄生在结果摘要里）；公式接缝从「两页手工对接」收成一步 | §2 §5 §7 |
| 现在的建模模块规划得不好 | 算子只有 6 个、结果只能看 200 行、模型库页只有一张表；信息架构与算子清单都要补 | §8 §9 |
| 每个部署完成的模型有一个接口供第三方系统调用 | 新的领域概念「部署」+ API 密钥 + 限流 + 一条免认证 location | §6 |
| 每个模型要有 schema，告诉用户配哪些参数；有特征工程时输入应该是**特征工程之前**的数据 | 推理入口契约从「建模节点的特征列」改成「推理子图入口的真实列集」，并另出一份面向人的模型签名 | §3 §4 |

第四条是四条里最深的一条，也是其它三条的地基：**没有一份说得清的输入契约，
公式绑定按位置猜、第三方接口没有文档、产物存下来也不知道怎么喂。** 故本文档从它写起。

---

## 1. 现状盘点：已经有什么、缺什么

### 1.1 已经落地的（第 1–4 期，`main` 上可跑）

- `apps/modeling`：5 张表、算子注册表、图校验、Redis Stream + 进程池执行引擎、
  节点级记录与结果摘要、保留期清理；
- 六个算子：`ledger_source` / `fill_missing` / `standardize` / `split_dataset` /
  `linear_regression` / `regression_metrics`；
- 模型版本发布 + `servable` 判定 + `serving_json` 编译成纯计算对象；
- 台账公式接缝**整条打通**：公式库条目写 `PREDICT('标识', {形参}…)`、台账列写
  `@标识(实参…)`、`ModelingAnalysisProvider` 在 api 与 worker 两个角色注册；
- 前端三页：流水线列表 / 画布 / 模型版本与绑定；
- 后端 136 条建模用例。

⚠ **「模型当公式用」这条诉求在代码上已经存在**，本轮不是从零做，是把它做得能用（§7）。

### 1.2 两条已实测的缺陷（不是推断，跑出来的）

#### 缺陷 A · 除建模算子外，**所有拟合参数从来没有被保存过**

`fill_missing` 与 `standardize` 在训练时确实算出了拟合参数
（`dump_fitted()` 返回真实的填充值与尺度），但这份返回值**没有任何一处调用点**：

- 子进程侧 `services/node_task.py:37` 只 `return operator.run(payload.inputs)`
  ——算子实例连同它学到的东西留在子进程里，随进程回收；
- 执行器 `services/run_executor.py` 落库的 `preview` 是**严格按输出端口建键**的
  `{端口名: 摘要}`；
- 发布时 `services/publish_service.py:169` 去读
  `previews[node_id]["fitted"]` —— 一个**没有任何写入方**的键。

于是每一个发布出来的版本，`serving_json.steps[*].fitted` 对非建模算子恒为 `{}`。
而 `services/serving.py:_apply` 只在 `step.fitted` 非空时才 `load_fitted`，
`FillMissing.run` / `Standardize.run` 又用 `if not self._fills` / `if not self._scales`
判「是不是回灌模式」——**空 fitted = 推理期拿请求里的那一行重新拟合**。

实测（脚本复现，六个算子的真实代码路径）：

```
节点 f (fill_missing)  dump_fitted() = {'温度': 27.75, '负荷': 446.5}
节点 z (standardize)   dump_fitted() = {'温度': {'center': 27.75, 'scale': 4.6165…}, …}
preview_json 的顶层键：  f: ['frame']   z: ['frame']   m: ['model', 'scored']
                        ^^^^^^^^^^^^^^^^^ 没有 fitted 这个键

serving_json.steps：
  fill_missing         fitted={}
  standardize          fitted={}
  linear_regression    fitted={'coef': {…}, 'intercept': 1400.0}

servable=True   ← 发布时判定为「可上线」
predict([25.0, 430.0]) 抛了：
  OperatorError: 列「温度」在训练行上只有一个取值，标准化会除以 0
```

**后果分两档**：

| 算子 | 推理时的表现 | 严重度 |
| --- | --- | --- |
| `standardize` | 单行重新拟合 → 尺度为 0 → 抛错 → 台账那一格空 + 一句看不懂的原因 | **凡是带标准化的模型，上线即不可用** |
| `fill_missing` | 单行重新拟合 → 填充值 = 这一行自己的值 → 没有缺失时无害，**有缺失时静默算错** | 无异常、无告警的错值 |

**为什么两期用例全绿**：唯一一条端到端验收
（`tests/integration/test_modeling_formula_seam.py`）的 `_no_scaling()` 辅助函数
**主动把 `standardize` 节点从图里删掉**，注释写的是「让系数留在原始尺度上便于手算核对」。
剩下的 `fill_missing` 因为种的数据没有缺失，重新拟合出来的填充值一次都用不上。
**唯一能逮到这条的用例，恰好把要逮的那个算子摘掉了。**

#### 缺陷 B · 建模算子自己的拟合参数**会被结果摘要的字节预算悄悄削掉**

模型的 `fitted` 寄生在 `model` 端口的摘要里（`services/preview.py:136`），
而摘要有两层预算：

- 单份摘要超 256 KiB → `fit_budget` 对非帧类摘要直接走 `_stripped`，
  而 `_stripped`（`preview.py:174`）明写 **丢掉 `fitted`**；
- 一次运行合计超 8 MiB → `_Budget.take` 把整份摘要换成 `{"kind", "note"}`。
  ⚠ 预算是**按端口固定扣 256 KiB**的，不按实际大小，故 32 个输出端口就用满
  ——一张 200 节点上限的图轻易越过。

被削之后发布仍然判 `servable=True`，推理时 `predict_rows` 抛「模型还没有拟合参数」。

#### 这两条的同一个根因

**拟合参数被当成「给人看的结果摘要」的一部分存着，而摘要是有预算、会被截断、
有保留期会被清理的。** 拟合参数是**发布件的原料**，生命周期与摘要完全不同。

### D1 · 拟合参数独立成列，与结果摘要彻底分家

`modeling_node_runs` 加一列 `fitted_json JSONB NULL`（扩展迁移，加列可空、不回填）。
子进程返回 `{"outputs": …, "fitted": …, "io": …}`，执行器把 `fitted` 直接落这一列，
发布时从这一列读。

**不复用 `preview_json`**，三条理由，每条都对应上面一条实测：

1. 摘要有字节预算且**会被静默削**，发布件的原料不能有「有时候在有时候不在」这种性质；
2. 摘要按端口建键，而拟合参数是**节点级**的一份（一个算子实例只有一份拟合状态），
   塞进端口命名空间会与真实端口名撞车；
3. 摘要有保留期（`services/retention.py`），拟合参数在发布那一刻起就被冻进
   `serving_json`，但**发布之前**它必须一直在。

配套两条闸：

- 契约测试：每个 `REQUIRES_FIT=True` 的算子，跑一遍训练 → 发布 → `compile_model` →
  `predict` 一行，断言算出来的数与训练期用同一份参数手算的一致。
  ⚠ **这条测试必须用带 `standardize` 的图**——缺陷 A 就是被「把它摘掉」放过去的；
- 发布期实跑：`inspect_run` 除了 `compile_model`（只编译）之外，再拿训练集的**第一行**
  跑一次 `predict`，与训练期打分帧上同一行的预测值比对，不一致即拒绝发布。
  这一条把「训出来了、上线才炸」在发布那一刻挡住。

---

## 2. 领域词表（新增）

> 与 [MODELING_DESIGN.md](./MODELING_DESIGN.md) §2 同风格，只列新词。

| 词 | 指什么 | 不叫什么 |
| --- | --- | --- |
| **入口契约** `entry contract` | 推理时**调用方必须提供**的那组列：推理子链上第一个算子的输入列集。它在特征工程**之前** | 不叫特征列（`feature_keys` 是建模算子看到的列，在特征工程**之后**，两者只在「所有算子都不改列集」时才恰好相等） |
| **派生列** `derived column` | 推理子链自己造出来的列（时间特征、独热、滞后…）。调用方不提供、也不该提供 | —— |
| **模型签名** `signature` | 一份面向**人与第三方系统**的输入输出说明：每个入口列的标签、单位、类型、是否必填、训练取值域；输出是什么。它是 `serving_json` 的**人话投影**，不参与任何计算。界面文案里也叫「模型 schema」 | 代码与库里**不叫 `schema`**：那个名字在出参模型上会与 `BaseModel.schema` 撞并当场告警。也不叫接口文档（它是数据不是文字；文档由它生成） |
| **产物** `artifact` | 一个模型版本的二进制可服务件（本服务自己训练、自己序列化、自己写入对象存储的字节）。只有通道 B 的算法有 | 不叫模型文件（「文件」暗示可上传可替换；这里只可由本服务写、按摘要校验后读） |
| **部署** `deployment` | 一个模型版本的**对外服务实例**：一个 URL 段、一组 API 密钥、一份配额。有了它「部署」这个词才名副其实 | 与**绑定**（binding）分家：绑定是「进台账公式」，部署是「出系统给第三方」。同一个版本可以只绑不部署、只部署不绑、两者都有 |
| **API 密钥** `api key` | 第三方调用部署时出示的凭据。明文只在创建回执里出现一次，库里只存哈希 | 不叫 token（本仓 token 已指会话令牌，两者生命周期与撤销语义都不同） |

⚠ **「部署」这个词在 [MODELING_DESIGN.md](./MODELING_DESIGN.md) §2 里被明确排除过**
（「绑定不叫部署，那暗示起了一个服务进程」）。本轮**修正**那一条：现在真的有了对外端点、
凭据与配额，这个词名副其实了。绑定仍然不叫部署——两者是两个概念、两张表、两个页面。

---

## 3. 推理入口契约（诉求 4 · 上半）

### 3.1 问题的精确陈述

一条流水线是一张 DAG，训练时整张图都跑；推理时只跑一条**子链**。今天这条子链被定义成
「拓扑序里 `ENABLED_IN_SERVING=True` 的节点」，且 `services/publish_service.py:_steps_of`
把**每一步**的 `expected_input_columns` 都写成同一份 `feature_keys`（建模节点看到的列）。

这里有两个没写下来的假设：

1. 推理子链是一条**链**（每步一进一出、都是 `frame`）；
2. 每一步**不改列集**。

今天两条都成立，因为三个可服务算子（`fill_missing` / `standardize` / `linear_regression`）
都不增删列。**只要加进第一个改列集的算子，第二条当场破**：

| 算子 | 列集怎么变 | 破在哪 |
| --- | --- | --- |
| `time_feature` | 从时间索引造出 `hour` / `dow` 等新列 | 入口契约会把 `hour` 列进去，要求调用方提供一个管线自己会造的列 |
| `one_hot` | 1 列 → N 列，原列消失 | 入口契约给的是编码后的列名，调用方手上只有原始类目 |
| `lag_feature` / `rolling_feature` | 加列，且需要历史窗口 | 已由 `SERVING_NEEDS_WINDOW` 整条判不可服务，不受影响 |
| `select_feature` / `pca` | 减列 / 换列 | 入口契约变成主成分名，调用方无从提供 |

而 `serving.py:_apply` 的断言 `frame.keys != step.expected` 会**在推理期**抛错
——又是一次「训出来了、上线才炸」。

同一个假设还有第二处受害者：`services/graph_walk.py:82`

```python
outputs[node_id] = _source_keys(node) if not upstream else inherited
```

**「有上游就原样继承上游的列集」**——即图校验眼里没有任何算子会改列集。
前端 `pages/Modeling/Canvas/scripts/upstream.ts` 是同一口径的第二份实现
（只按取数节点收窄）。两份都要跟着改。

### D2 · 算子必须声明自己怎么改列集，声明是**纯函数**，训练与推理共用

`OperatorBase` 加一个类方法：

```python
@classmethod
def describe_columns(
    cls, config: OperatorConfig, inputs: Mapping[str, tuple[str, ...]]
) -> Mapping[str, tuple[str, ...]]:
    """给定各输入端口的列 key，答各输出端口的列 key。默认恒等。"""
```

- 默认实现：单输入单输出、原样透传（今天六个算子里有五个就是这样）；
- `ledger_source` 覆盖它（列来自 `columns` 配置，空表示未知 → 返回 `None` 语义）；
- `split_dataset` 覆盖它（`train` / `test` 两个输出，列集相同）；
- 将来每个改列集的算子各覆盖一次。

**四个消费者，一份声明**：

| 消费者 | 用它干什么 | 今天是什么状况 |
| --- | --- | --- |
| `graph_walk.known_keys_by_node` | 保存期校验「这一列在上游存在吗」 | 假设列集不变（`graph_walk.py:82`） |
| 前端列选择器 | 下游节点能勾哪些列 | 只按取数节点收窄，第二份口径（`upstream.ts`） |
| 发布 | 算入口契约与逐步的 `expected_input_columns` | 一律写成 `feature_keys` |
| 模型签名 | 区分「入口列」与「派生列」 | 不存在 |

⚠ **前端那一份必须删掉、改成读后端算好的结果**（`POST …:validate` 的回执里带
`known_keys_by_node`）。两份口径就是[单向契约留下盲区](../CLAUDE.md)那一类：
两边各自自洽，只有真跑起来才对不上。

### D3 · 声明是**约定**，真值是**实测**；两者不一致时发布失败

`describe_columns` 是静态声明，可能与算子的实际行为不符（写错了、改了 `run` 忘了改声明）。
所以训练期要把**每一步真实的输入输出列**记下来，发布时拿它当真值，同时与声明比对：

```jsonc
// modeling_node_runs.io_json（新列，与 fitted_json 同一批加）
{
  "inputs":  { "frame": ["温度", "负荷", "能耗"] },
  "outputs": { "frame": ["温度", "负荷", "能耗", "hour"] }
}
```

- 落点与 `fitted_json` 同一处（子进程返回 → 执行器落库），理由同 D1：
  它是发布件的原料，不能被摘要预算削掉；
- 发布时逐步比对「声明推出来的」与「实跑记下来的」，不一致 → **拒绝发布**并指名哪一步、
  哪些列对不上。这条契约测试比任何文档都管用：加算子时忘了覆盖 `describe_columns`，
  第一次发布就红。

⚠ **不做数据迁移**：`io_json` 与 `fitted_json` 对历史运行是 `NULL`。
历史运行**不可再发布**（发布时读不到就给一句人话：「这次运行早于本次升级，请重跑一遍再发布」）。
已经发布出去的历史版本按 `serving_json` 的 `format_version` 走老路径，
一个字节都不改——模型版本不可变（D8），历史版本按当初的口径继续算才是对的。

### D4 · `serving_json` 升到 `2.0`：入口契约与逐步列集都说清

```jsonc
{
  "format_version": "2.0",
  "task": "regression",
  "entry_columns": [                              // ← 推理入口契约（特征工程之前）
    { "key": "温度", "dtype": "number" },
    { "key": "负荷", "dtype": "number" }
  ],
  "steps": [
    { "node_id": "t1", "operator": "time_feature",
      "config": { "parts": ["hour"] }, "fitted": {},
      "expected_input_columns": ["温度", "负荷"],            // ← 这一步真实的输入
      "produced_columns":       ["温度", "负荷", "hour"] },  // ← 这一步真实的输出
    { "node_id": "z", "operator": "standardize",
      "config": { "method": "zscore" },
      "fitted": { "温度": {"center": 27.75, "scale": 4.62}, … },   // ← D1 修好之后真的有值了
      "expected_input_columns": ["温度", "负荷", "hour"],
      "produced_columns":       ["温度", "负荷", "hour"] },
    { "node_id": "m", "operator": "linear_regression",
      "config": { "use_intercept": true },
      "fitted": { "coef": { … }, "intercept": 1400.0 },
      "expected_input_columns": ["温度", "负荷", "hour"],
      "produced_columns": ["__prediction__"] }
  ]
}
```

- `entry_columns` = `steps[0].expected_input_columns`（推理子链为空时 = 建模节点的输入列）；
- 每一步的 `expected_input_columns` 是**那一步训练时真实看到的列**，不再是全局同一份；
- `dtype` 从帧的列定义带过来，供第三方接口做入参类型校验。

**加载期双版本分派**（`services/serving.py`）：

| `format_version` | 入口契约取自 | 每步断言 |
| --- | --- | --- |
| `"1.0"`（历史版本） | `input_columns` | 与今天完全一致 |
| `"2.0"` | `entry_columns` | 逐步各自的 `expected_input_columns` |

⚠ **1.0 的加载路径一行都不许改**，且要有一条钉住它的用例：改动加载器时把老版本算出不同的数，
是这一类系统里最难发现的回归——没有任何报错，只是从某一天起某几列的历史值与新值口径不同。

### D5 · 入口契约的顺序是**稳定的**，且与绑定的位置映射对齐

`entry_columns` 的顺序 = 取数算子 `columns` 配置里的顺序（用户挑列时的顺序），
经过每一步的 `describe_columns` 保持。**不排序、不去重后重排**。

理由：公式绑定是**按位置**把形参映射到特征上的（[MODELING_DESIGN.md](./MODELING_DESIGN.md) §7.4）。
顺序一变，所有存量绑定就静默错位——温度喂进了负荷那一格，算出来的还是个数，
没有任何一处会报错。所以顺序是契约的一部分，要有契约测试钉住。

---

## 4. 模型签名（诉求 4 · 下半）

### D6 · 模型签名是 `serving_json` 的人话投影，独立成列，**不参与任何计算**

`modeling_model_versions` 加一列 `signature_json JSONB NOT NULL DEFAULT '{}'::jsonb`。

⚠ **叫签名不叫 schema**：出参模型上那个字段名会与 `BaseModel.schema` 撞，pydantic
当场告警，而本仓 CI 是零告警。签名（signature）是同一件东西的标准叫法，库、出参、
前端契约、文档统一用它；界面文案仍可以说「模型 schema」。

```jsonc
{
  "format_version": "1.0",
  "inputs": [
    {
      "key": "温度",
      "label": "环境温度",                  // 取数时台账列定义上的显示名
      "unit": "℃",                          // 同上
      "dtype": "number",
      "is_required": true,                  // 见 D7
      "default_on_missing": null,           // 可缺省时，填进去的那个值
      "training_stats": {                   // 见 D8：只在内部面给
        "min": -5.2, "max": 41.0, "p50": 22.0, "null_ratio": 0.012
      }
    }
  ],
  "derived": [                              // 管线自己造的，调用方不必给，只做展示
    { "key": "hour", "by": "time_feature", "label": "小时" }
  ],
  "output": {
    "key": "能耗", "label": "小时能耗", "unit": "kWh",
    "dtype": "number", "task": "regression"
  },
}
```

⚠ **训练规模与来源不重复放进签名**：它们已经在 `fingerprint_json` 里（行数、台账编码、
python / numpy / sklearn 版本）。两处各存一份的下场是其中一处会先过时。

⚠ **`requires_timestamp` 这一格现在没有**：本轮六个算子里没有需要时刻的（D19 的
`time_feature` 在第四期）。留到那时候连同它的真分支一起加——现在加进来它恒为 `false`，
真分支一条用例都写不出来。签名带 `format_version`，加字段不是破坏性变更。

三个消费者：

1. **发布确认页与模型详情**——用户第一次看清「这个模型上线之后要喂什么」；
2. **绑定 / 一键注册为公式**（§7）——形参名、顺序、标签直接从这里生成，
   用户不必再理解「按位置映射」；
3. **第三方接口**（§6）——`GET …/schema` 就是对外的接口文档。

⚠ **签名不参与计算。** 推理只读 `serving_json`。两份东西不同步时，
错的是签名（展示会不准），而不是预测值（会算错）。这条分界要写进注释，
免得后人图省事从签名里读列名。

### D7 · `is_required` 由推理链算出来，不由人填

某个入口列 `K` 可缺省，当且仅当：推理子链上存在一个 `fill_missing` 步骤，
它的 `fitted` 里有 `K` 的填充值，且它排在任何会消费 `K` 的步骤**之前**。
否则必填。

这是 schema 里最有用的一格：第三方系统据此知道哪些字段可以不传。
配套单测三条：有填充 → 可缺省且给出填充值；无填充 → 必填；
填充在标准化**之后** → 仍然必填（顺序错了不算数）。

### D8 · 训练取值域**只在内部面给**，对外的 schema 剥掉

`training_stats` 描述的是业务数据的分布——它对内是「合理输入范围」的提示，
对外是**一次业务数据泄漏**。所以：

| 面 | 带 `training_stats` / `training` | 谁能看 |
| --- | --- | --- |
| `GET /modeling-model-versions/{id}` | 带 | `modeling:view` |
| `GET /open-models/{code}`（对外） | **剥掉** | 持 API 密钥的第三方 |

对外面仍然保留 `is_required` / `default_on_missing` / `dtype` / `label` / `unit`
——这些是用接口必须知道的。

**但超域告警仍然给**：`:predict` 的回执带 `warnings`，入参落在
`[p1, p99]` 之外时明说「这一路输入超出训练区间，属于外推」。
⚠ **只告警不拒绝**：拒绝会让第三方系统在边界数据上直接炸；而工业时序模型被拿去外推
是头号误用，不说一句的话没人会发现。告警文案里**不带区间的具体数值**（那就等于把
`training_stats` 又漏出去了），只说「超出训练区间」。

---

## 5. 模型产物与对象存储（诉求 1 · 上半）

### 5.1 为什么需要它

今天所有拟合参数都必须能用纯 JSON 表达（通道 A），做不到的算法在发布时被判不可上线：
「这个算法的拟合参数没法用纯数据表达，暂不可上线」。这一句话挡住的是**树模型这一整类**
——随机森林、梯度提升、孤立森林，恰好是工业数据上最常用的那几个。

所以「模型保存到 OSS」不是换个地方存 JSON，而是**开一条通道**：
让拟合结果是一堆对象的算法也能上线。

### D9 · 产物走对象存储，版本表里只留引用与摘要

`modeling_model_artifacts` 新表（一个版本至多一份产物，一对一）：

| 列 | 说明 |
| --- | --- |
| `model_version_id` | 唯一，`ON DELETE CASCADE`（版本退役即连带删记录，对象由清理任务延后删） |
| `object_key` | 对象键，**由服务端按 `modeling/models/{version_id}/model.joblib` 生成** |
| `digest` | 内容 sha256（十六进制），加载前必校 |
| `size_bytes` | 供列表页与配额展示 |
| `serializer` | `joblib`，闭合取值 |
| `runtime_json` | `{python, numpy, sklearn}`，加载前必比对 |

**为什么不放数据库的 bytea**：版本表要被列表页全量读；而随机森林 100 棵树的 joblib
可以到几十 MB，进库会连着把备份与 WAL 一起撑大。
`apps/hvac` 的 `ac_model_artifacts` 是把二进制存进库的先例，那是给单个小模型用的，
不适合按流水线无限增长的这一类。

### D10 · 四条护栏，一条都不能少

[MODELING_DESIGN.md](./MODELING_DESIGN.md) §9.3 的九道防线继续有效。本节兑现其中第 ⑦ 条
（「产物路径不取用户输入」），并把它扩成四条：

| # | 护栏 | 破了会怎样 |
| --- | --- | --- |
| 1 | **只加载本服务自己写的字节。** 没有任何上传端点，路由函数上不出现 `UploadFile`（源码扫描锁死）；对象键由服务端生成，请求里的任何字符串都不进键 | `joblib.load` 等价于任意代码执行 |
| 2 | **摘要校验先于反序列化。** 取回字节 → 算 sha256 → 与 `digest` 比 → 不等即拒，不解析 | 对象存储被旁路写入就等于 RCE |
| 3 | **受限反序列化。** 自定义 `Unpickler.find_class`，只放行 `numpy` / `scipy` / `sklearn` 三棵树里的具体类名单，其余一律抛 | 纵深防御：护栏 1、2 都被绕过时还有一层 |
| 4 | **运行时版本必须一致。** `runtime_json` 与当前进程的 numpy / sklearn 版本不同即**拒绝加载并给人话**，不是 warning | 跨版本反序列化行为未定义，静默降级的表现是「同一个模型换个环境算出不同的数」 |

⚠ 护栏 4 的代价是**升级依赖会让存量的通道 B 版本全部失效**。这是有意的：宁可让用户看见
「这个版本是用 sklearn 1.7 训的，当前环境是 1.9，请重新训练」，也不要让它悄悄算出别的数。
界面上要能一眼看出哪些版本因此失效，并给「按同一份流水线重跑」的入口。

### D11 · 通道 B **也要进台账**，为此给重算加一条批量预测相位

| 通道 | 拟合参数 | 台账 `PREDICT` | 对外部署 `:predict` |
| --- | --- | --- | --- |
| A（纯 JSON） | 进 `serving_json` | ✅ | ✅ |
| B（二进制产物） | 进对象存储 | ✅ **经批量相位** | ✅ |

**问题**：台账重算今天是**逐行**求值的
（[MODELING_DESIGN.md](./MODELING_DESIGN.md) D26：模型以已编译的可调用对象进求值上下文，
每行一次点乘）。通道 A 的一次调用是几次乘加，逐行完全够；通道 B 的一次调用是一趟
Python → C 的往返 + 一次数组构造，20 万行 × 一次往返是另一个量级。
[MODELING_DESIGN.md](./MODELING_DESIGN.md) §13.2 早就把这条标成不确定项。

**决定**（用户拍板）：不绕开，直接把批量相位做进去。做完之后所有重算路径都受益，
且「哪些算法能进台账」这个问题从此消失——不再需要 `is_servable_in_ledger` 这一档区分。

### D11b · 批量相位落在 `record_compute` 的异步层，**求值器仍然纯同步**

台账公式子系统最值钱的性质是「求值器纯同步、零 fixture 可单测」
（[DATASET_DESIGN.md](./DATASET_DESIGN.md)）。批量相位**不许破坏它**。
做法是把批量做在求值器**外面**一层：

**1 · 按「模型调用深度」给公式列分层。**
`PREDICT` 的实参可以是任意表达式，含别的公式列
（[MODELING_DESIGN.md](./MODELING_DESIGN.md) D26 第 2 条把这当成相对参考仓的优势）。
所以不能一趟把所有 `PREDICT` 收齐。给 `plan.order` 里的每一列算一个深度：

```
depth(列) = max(depth(它依赖的公式列), 默认 0) + (这一列自己含 PREDICT ? 1 : 0)
```

深度相同的列可以在同一轮里整批预测。绝大多数真实台账只有 1 层。

**2 · 每一层两趟：收集趟 + 回填趟。**

```
for level in 0 .. max_depth:                     # 分层
    for row in batch:                            # 趟 1：收集（同步）
        evaluate(level 的列, sink=收集模式)       #   PREDICT 登记实参后抛内部哨兵
    for code, calls in sink:                     # 整批（异步层，可 to_thread）
        sink.results[code] = model.predict_batch(calls)
    for row in batch:                            # 趟 2：回填（同步）
        evaluate(level 的列, sink=回放模式)       #   PREDICT 按 (行号, 调用序号) 取已算好的
```

- 求值器只多认一个 `EvalContext.model_sink`，`PREDICT` 分支两种模式各三行；
- **趟 1 抛哨兵而不是返回占位**：占位会被下游算术吃掉变成脏数，且没有任何症状。
  哨兵由 `evaluate_row` 捕获，那一列这一轮不写值也不写错；
- **按 `(行号, 调用序号)` 取结果，不按实参值**：同一行同一列里可以有多次 `PREDICT`，
  实参也可能恰好相同。求值顺序是确定的，故调用序号稳定；
- 趟 2 重算一遍这一层的纯算术。这比一次 sklearn 往返便宜两个数量级。

**3 · `AnalysisModel` 协议加 `predict_batch`，通道 A 的默认实现就是逐行调 `predict`。**
于是**只有一条代码路径**——通道 A 与 B 走同一条相位，不做「小批量走老路」这种分叉
（分叉的表现是两条路算出的数在边界上不一致，且只有跨过阈值时才出现）。

⚠ **加载与预测都是阻塞调用，必须在异步层用 `asyncio.to_thread`。**
`async` 里禁任何阻塞调用是本仓的硬规矩；joblib 反序列化一个几十 MB 的森林是几百毫秒。
批量相位天生就在 `record_compute` 的 async 层，这一条顺理成章——**而这正是为什么
批量必须做在求值器外面**：求值器是同步的，它里面没有任何地方能 `await`。

⚠ 加载有进程内 LRU（版本不可变，无需失效机制），但**第一次**加载仍然要走线程池；
缓存要有条数上限，不然几十个大模型会把 API 副本的内存吃光。

⚠ 单行写（人工修正、逐行录入）的批量大小恒为 1，两趟 + 一次 batch 的开销与今天几乎一样。

**这条要一份 ADR**：它改的是台账公式引擎的求值形状，影响面超出建模模块。

### D12 · 全量产物下载是另一件事，且要另一个权限码

「跑完把处理好的数据拿走」是真实需求，但它与模型产物是两码事：

- 模型产物 = 一个版本的可服务件，随版本走；
- 全量帧 = 一次运行里某个端口的完整数据，随运行走，**含台账原始数据**。

[MODELING_DESIGN.md](./MODELING_DESIGN.md) §9.4 已经写死：
「将来加了导出全量帧那个端点，必须同时要求 `dataset:record:export`」。本轮兑现：

- 运行参数加一档「保留全量产物」（默认关）。开启时执行器把每个端口的帧写成 CSV 到对象存储，
  带保留期（与运行记录同一个清理循环）；
- `POST /modeling-runs/{id}/exports`（`modeling:view` **且** `dataset:record:export`）
  换一个短时预签名 URL；
- ⚠ 默认关是刻意的：默认开会让每次运行都往对象存储写几十 MB，
  而绝大多数运行只是在调参数。

---

## 6. 对外服务端点（诉求 3）

### D13 · 「部署」是新的一等概念，与「绑定」并列而不是替代

```
模型版本 ──┬── 绑定 binding ─────▶ 公式库条目 ──▶ 台账列        （进系统内）
           └── 部署 deployment ──▶ 一个 URL + 一组 API 密钥      （出系统外）
```

两者都钉一个**不可变的版本**，换版本都是显式动作、都带影响面回执。
两者互不依赖：可以只绑不部署（内部分析）、只部署不绑（给 MES / EMS 调）、也可以都有。

### 6.1 三张新表

**`modeling_deployments`**

| 列 | 说明 |
| --- | --- |
| `code` | URL 段，全局唯一，`^[a-z0-9][a-z0-9-]{1,62}$`。⚠ 不拿版本 id 做 URL：换版本时第三方不必改代码 |
| `model_version_id` | 钉住的版本，`ON DELETE RESTRICT` |
| `name` / `description` | 展示 |
| `is_enabled` | 停用后立刻 403，不是静默返回旧值 |
| `max_rows_per_call` | 单次请求行数上限，默认 200，硬上限 1000 |
| `rate_limit_per_minute` | 每分钟调用次数上限，默认 60 |

**`modeling_api_keys`**

| 列 | 说明 |
| --- | --- |
| `deployment_id` | 一把密钥属于一个部署。⚠ 不做「一把钥匙开全部部署」：那把撤销的爆炸半径会放大到所有对接方 |
| `name` | 给人看的用途标记（「MES 生产系统」） |
| `key_prefix` | 明文的前 12 位，**可见**，用于在列表里认出是哪一把 |
| `key_hash` | `sha256(明文)` 的十六进制。⚠ 明文是高熵随机串不是口令，不需要慢哈希；比对必须 `hmac.compare_digest` |
| `expires_at` / `revoked_at` / `last_used_at` | 有效期与撤销。`last_used_at` **异步**更新，不进请求事务 |

⚠ **明文只在创建回执里出现一次**，之后任何接口都取不回来。丢了只能重发一把。
这条要在界面上说清楚，并给「复制」按钮。

**`modeling_call_logs`**（轻量，带保留期）

`deployment_id` / `api_key_id` / `created_at` / `row_count` / `duration_ms` /
`status` / `error_code`。

⚠ **不记入参与出参**：那是业务数据，可能含敏感值，且体积会压垮这张表。
需要排查具体一次调用时靠 `trace_id` 去结构化日志里找——日志里同样不记入参。

### 6.2 两个面，两套鉴权

| 面 | 路径 | 谁能进 |
| --- | --- | --- |
| 管理面 | `/api/v1/platform/modeling-deployments…` | 会话 + `modeling:view` / `modeling:publish`，走既有闸 1 |
| 对外面 | `/api/v1/platform/open-models/{code}…` | **API 密钥**，边缘免认证 location，platform-server 自己校验 |

**对外面只有两个端点**：

```
GET  /api/v1/platform/open-models/{code}          → 模型签名（剥掉训练统计，见 D8）
POST /api/v1/platform/open-models/{code}:predict  → 预测
```

请求：

```jsonc
POST /api/v1/platform/open-models/energy-forecast:predict
X-Api-Key: dtmk_a1b2c3d4e5f6_<32 位随机>
{ "rows": [ { "温度": 25.0, "负荷": 430.0 },
            { "温度": 26.5, "负荷": 455.0, "__ts__": "2026-09-03T10:00:00Z" } ] }
```

回执（统一信封，HTTP 状态码真实）：

```jsonc
{ "code": 0, "message": "ok", "trace_id": "…",
  "data": {
    "model": { "code": "energy-forecast", "version": 3 },
    "predictions": [ 1345.0, 1421.5 ],
    "warnings": [ { "row": 1, "column": "温度", "kind": "out_of_training_range",
                    "message": "这一路输入超出训练区间，属于外推" } ] } }
```

### D14 · 对外面照 `public-dashboards` 的先例：边缘一条免认证 location + 服务自己校验密钥

本仓已有的先例（`docker/nginx/nginx.conf.template`）：
`location ^~ /api/v1/platform/public-dashboards/` 是一条**免认证** location，
配一个自己的 `limit_req_zone`；auth-server 的规则表里单列一段并写明
「真正的匿名可达性由边缘那条免认证 location 保证」。

对外面照同一形状：

```nginx
limit_req_zone $binary_remote_addr zone=open_model:10m rate=120r/m;

# 模型对外推理面。⚠ 这是一条**免认证** location，不是漏了 auth-inject：
# 调用方是第三方系统，持的是 API 密钥不是会话；挂上 auth_request 一律 401。
# ⚠ `^~` 不能省：存在正则 location 时短前缀会重新参与竞争。
location ^~ /api/v1/platform/open-models/ {
  limit_req zone=open_model burst=40 nodelay;
  client_max_body_size 256k;
  proxy_pass http://$platform_upstream$request_uri;
}
```

**为什么不让 auth-server 认 API 密钥**：密钥是**业务资源**（挂在部署上、由建模模块的
`modeling:publish` 管、跟着部署一起删）。放进 auth-server 就要在两个服务之间同步一张表的生死，
而 `/verify` 是全站每个请求都要过的热路径——为一个低频端点给它加一条分支不划算。

**为什么服务自己校验是安全的**：这条 location 之下**只有两个端点**，都在
`api/open_models.py` 一个文件里，都以 `require_api_key` 依赖开头。
配一条契约测试扫描：`open-models` 前缀下的每一个路由函数都必须挂那个依赖。

### D15 · 对外面的五条额外防线

[MODELING_DESIGN.md](./MODELING_DESIGN.md) §9.3 的九道防线针对的是「算子参数」；
对外面是本模块第一次出现**匿名可达的入口**，另加五条：

| # | 防线 |
| --- | --- |
| ⑩ | **对外面只回预测值与告警**，不回图、不回列统计、不回训练区间的具体数值（D8）、不回任何台账编码 |
| ⑪ | **密钥不进日志、不进 URL、不进错误信息**。校验失败一律 401 + 「密钥无效」，不区分「不存在」「已撤销」「已过期」——区分等于送一个枚举接口 |
| ⑫ | **入参不进日志**（业务数据）。排查靠 `trace_id` + 行数 + 耗时 |
| ⑬ | **三层配额**：边缘 `limit_req`（按来源 IP）、服务侧按密钥的令牌桶、单次请求行数上限。⚠ 三层缺一不可：只有边缘那层的话，一把密钥换台机器就绕过去了 |
| ⑭ | **停用 / 退役立刻生效**：部署 `is_enabled=false` → 403；版本被退役 → 410 + 一句人话。绝不静默用旧值 |

### D16 · 一期跑在 `api` 角色，不新开部署单元

推理在通道 A 上是几次乘加，通道 B 上是一次 sklearn 往返，配额已经把量级压住了。
新开一个 `ROLE=serving` 是第 10 个部署单元，代价大于收益。

**触发条件现在就写下来**（免得以后凭感觉拍）：出现下面任一条时另开 `ROLE=serving`——
①对外调用的 P99 开始影响同副本上的业务接口；②单个部署的配额需要超过 600 次/分钟；
③需要给对外面单独的伸缩策略或单独的网络入口。

---

## 7. 公式接缝（诉求 1 · 下半）

### 7.1 现状：链路是通的，流程是断的

台账那一格真的能出模型算的数（`tests/integration/test_modeling_formula_seam.py`
逐系数手算核对）。断的是**用户流程**：

1. 去公式库页手建一条条目，公式体要**自己敲** `PREDICT('能耗预测', {温度}, {负荷})`，
   形参要**自己列**且顺序要与模型特征顺序一致；
2. 回建模页，选那条条目建绑定；
3. 绑定按**位置**把形参映射到特征上——顺序错了不报错，只是算出别的数。

用户要同时理解「公式库条目」「形参」「按位置映射」三个概念，
而这三个概念没有一个是他想要的——他想要的是「把这个模型当公式用」。

### D17 · 一键「注册为公式」：一步建条目 + 建绑定，形参从模型签名生成

模型详情页一个按钮，入参只有一个「公式标识」（默认填模型名）：

```
POST /api/v1/platform/modeling-model-versions/{id}:register-formula
     { "fx_code": "能耗预测" }
  →  { "formula": { "code": "能耗预测",
                    "expression": "PREDICT('能耗预测', {环境温度}, {瞬时负荷})",
                    "params": [ { "name": "环境温度", "kind": "column" }, … ] },
       "binding": { "id": "…",
                    "param_map": [ { "param": "环境温度", "feature": "温度" }, … ] } }
```

- 形参名取模型签名的 `label`（台账列的显示名），重名时退回 `key`；
- 顺序 = `entry_columns` 的顺序（D5），于是位置映射**天然对齐**，用户不必理解它；
- 事务里一次做完两件事：建条目、建绑定。任一步失败整体回滚
  ——半成品（有条目没绑定）的表现是台账列报「模型未绑定」，比什么都没建更难排查。

⚠ **权限必须同时要两个码**：`modeling:publish`（建绑定）**且** `dataset:manage`
（建公式库条目）。绝不能让 `modeling:publish` 顺带获得往公式库写的能力
——那两个码分家正是因为爆炸半径不同。没有 `dataset:manage` 时按钮禁用并说明原因。

⚠ **`fx_code` 已存在时不覆盖**，409 + 一句「公式库里已经有这个标识了，
换一个，或者去公式库页手工绑定」。静默覆盖一条别人在用的公式是不可逆的。

### D18 · 入口契约变了 = 存量绑定要重新确认，不静默续用

换绑版本时，若新版本的 `entry_columns` 与旧版本**不同**（个数、顺序或 key 变了），
`PATCH /modeling-bindings/{id}` 返回 409 + 逐条列出差异，要求用户带
`confirm_param_remap: true` 再来一次并给出新的映射。

**为什么不自动重映射**：按名字自动映射会在「两个版本恰好都有两个特征、名字不同」时
悄悄配错；按位置自动映射会在「新版本多了一个特征」时把所有实参错位一格。
两种错都算得出一个数、都不报错。

---

## 8. 算子扩容（诉求 2 · 上半）

「感觉规划得不好」最直接的来源：画布上只有 **6 块积木**，搭不出一次真实的分析。
[MODELING_DESIGN.md](./MODELING_DESIGN.md) §5.5 已经列好扩容位，本轮按下表落地。

`fit?` = 有拟合参数（必须走 D1 的 `fitted_json`）；`列变?` = 需要覆盖 `describe_columns`（D2）；
`serving?` = `ENABLED_IN_SERVING`。

### 8.1 数据源 `source`

| code | 名称 | 关键参数 | 列变? | 备注 |
| --- | --- | --- | --- | --- |
| `ledger_join` | 多台账按时间对齐 | `how`(inner/outer/left) / `tolerance_ms` / 列前缀 | **是** | 两个 `frame` 输入。⚠ 列名会撞，必须带来源前缀 |

### 8.2 预处理 `preprocess`

| code | 名称 | 关键参数 | fit? | 列变? | serving? |
| --- | --- | --- | --- | --- | --- |
| `cast_type` | 类型归一 | `columns[]` / `to`(number/bool/string) / `on_error`(coerce/error) | 否 | 否 | 是 |
| `drop_missing` | 丢缺失 | `axis`(row/col) / `how`(any/all) / `subset[]` / `max_null_ratio` | 否 | **col 档是** | **否**（改行数） |
| `clip_outlier` | 离群处理 | `method`(zscore/iqr) / `threshold` / `action`(clip/drop/mark) | **是** | mark 档是 | clip/mark 是，drop 否 |
| `resample` | 时间重采样 | `bucket`(1h/1d/…) / 每列聚合口径 | 否 | 否 | **否**（改行数） |
| `filter_rows` | 条件过滤 | `column` + `op ∈ Literal[…]` + `value`（**闭合三元组，不是表达式**，§9.3 防线②） | 否 | 否 | **否** |

⚠ `resample` 的聚合口径**复用台账的八档**（[DATASET_DESIGN.md](./DATASET_DESIGN.md)），
不另写一份。两份聚合口径的表现是「台账里按小时看是一个数、建模里按小时取是另一个数」。

### 8.3 特征工程 `feature`

| code | 名称 | 关键参数 | fit? | 列变? | serving? |
| --- | --- | --- | --- | --- | --- |
| `time_feature` | 时间特征 | `parts[]`(hour/dayofweek/month/is_weekend/…) | 否 | **是** | 是，**但要时刻**（D19） |
| `one_hot` | 独热编码 | `columns[]` / `max_categories` / 未知类目落全零 | **是** | **是** | 是 |
| `lag_feature` | 滞后特征 | `columns[]` / `lags[]` | 否 | **是** | 否（需窗口 → 整条不可服务） |
| `rolling_feature` | 滚动统计 | `columns[]` / `window` / `stats[]` | 否 | **是** | 否（同上） |
| `select_feature` | 特征筛选 | `method`(variance/correlation/mutual_info) / `top_k` | **是** | **是**（减列） | 是 |
| `pca` | 主成分降维 | `n_components` / `whiten` | **是** | **是**（换列） | 是 |

⚠ **`time_feature` 是第一个改列集的算子**，它必须排在 §3 §4 的地基之后。
在地基落地之前加它，等于给存量模型埋一颗「入口契约要求调用方提供 `hour` 列」的雷。

### D19 · 需要时刻的推理：入口契约里除了列，还有一个「时刻」

`time_feature` 从帧的时间索引造列。推理时只有一行，**这一行的时刻必须由调用方给**。
所以入口契约多一格：

```jsonc
"requires_timestamp": true    // schema 与 serving_json 都带
```

| 调用路径 | 时刻从哪来 |
| --- | --- |
| 对外 `:predict` | 请求行里的 `__ts__`（RFC3339 UTC）。`requires_timestamp` 为真而没给 → 422 |
| 台账 `PREDICT` | **当前行的 `ts`**，见下 |
| 公式试算（`formula_service` 的预览面） | 没有行，故没有时刻 → 该条公式在试算里显式报「这个模型要一个时刻，试算给不了」 |

**台账侧要加的那一格**（已查证，比预想的小）：`evaluate_row(scope, ts, values, cache)`
手上**本来就握着这一行的 `ts`**（`services/record_compute.py:107`，同一个函数里已经
拿它构造 `RowSnapshot`），只是没往 `EvalContext` 里传。所以：

- `formula/evaluator.py` 的 `EvalContext` 加一格 `row_ts: datetime | None = None`；
- `record_compute.evaluate_row` 构造时把 `ts` 传进去（**一处**，批量与单行两条路径
  都汇到这一个函数，不会漏）；
- `formula_service` 的试算面传 `None`；
- `_call` 的 `PREDICT` 分支把它交给编译好的对象。

⚠ 这是本轮**第二处**改动台账的地方（第一处是 D17 的建条目）。`EvalContext` 是公式子系统
最核心的那个结构，加字段要带默认值——不然全仓几十处构造点一起红，而那些点大多与模型无关。

⚠ 时区：时间特征按**业务聚合时区**算，不按 UTC
（[MODELING_DESIGN.md](./MODELING_DESIGN.md) §3.3 末尾那条 ⚠）。
时区偏移由引擎经 `bind_runtime` 注入，且要**冻进 `serving_json` 那一步的 config**
——否则换个部署环境同一个模型会算出偏 8 小时的特征。

### 8.4 建模 `model`

| code | 名称 | 任务 | 通道 | 备注 |
| --- | --- | --- | --- | --- |
| `logistic_regression` | 逻辑回归 | 分类 | **A** | 系数是纯数，进得了台账 |
| `kmeans` | K 均值 | 聚类 | **A** | 拟合参数是质心矩阵，纯数。⚠ 输出是簇号不是连续值，台账列的语义要说清 |
| `random_forest_regressor` | 随机森林回归 | 回归 | B | 要 §5 的产物通道 |
| `gbdt_regressor` | 梯度提升回归 | 回归 | B | 同上 |
| `random_forest_classifier` | 随机森林分类 | 分类 | B | 同上 |
| `isolation_forest` | 孤立森林 | 异常检测 | B | 输出是异常分，不是概率 |

⚠ 岭 / 套索仍然**是 `linear_regression` 的参数**而不是新算子
（[MODELING_DESIGN.md](./MODELING_DESIGN.md) §5.5 的理由继续成立）。

### 8.5 评估 `evaluate`

| code | 名称 | 输出 |
| --- | --- | --- |
| `classification_metrics` | 分类评估 | accuracy / precision / recall / F1 + 混淆矩阵 |
| `residual_analysis` | 残差分析 | 残差直方图 + 统计量（含 Q-Q 分位点） |
| `feature_importance` | 特征重要性 | 有序重要性表（线性模型取标准化系数绝对值，树模型取内建重要性） |
| `cross_validate` | 交叉验证 | 每折指标 + 汇总。⚠ 时序数据默认用**前向链**折法，不是随机 K 折 |

### 8.6 依赖

**仍然不引 pandas。** 新增算子里唯一像是需要它的 `resample` 走台账那份聚合实现；
`one_hot` / `select_feature` / `pca` / 树模型全部由已有的 numpy + scikit-learn 覆盖。
`joblib` 随 scikit-learn 一起进来，但要在 `pyproject.toml` 里**显式声明**
——§5 直接用它，靠传递依赖会在上游改依赖时静默失败。

---

## 9. 前端信息架构（诉求 2 · 下半）

### 9.1 现状与病症

三个页面：流水线列表 / 画布 / 模型（版本表 + 绑定表）。三条病症：

| 病症 | 表现 |
| --- | --- |
| 没有「运行」这个面 | 跑过的运行只能从画布里的历史抽屉看，跨流水线的运行找不着 |
| 模型面只有一张表 | 看不到输入契约、看不到指纹、看不到不可服务的原因、两个版本没法比 |
| 起步是一张白纸 | 新建流水线之后画布空空，用户得自己从 6 个算子里想出一条链 |

### D20 · 四个面，一条导航

```
分析建模
├── 流水线   列表 → 画布（编辑 / 只读回看）
├── 运行     跨流水线的运行记录，按状态 / 时间筛，点进去只读回看那张图
├── 模型     版本库：指标、schema、指纹、产物、对比；注册为公式；发布部署
└── 服务     部署与 API 密钥、调用量、示例代码
```

「运行」与「服务」是新面；「模型」由一张表扩成「列表 + 详情」。

### D21 · 新建流水线给模板，不给白纸

三套开箱模板，选完直接落一张**能跑**的图（选一张台账、挑列、点运行）：

| 模板 | 图 |
| --- | --- |
| 回归预测 | 取数 → 填缺失 → 标准化 → 切分 → 线性回归 → 回归评估 |
| 分类判别 | 取数 → 填缺失 → 独热 → 切分 → 逻辑回归 → 分类评估 |
| 异常检测 | 取数 → 填缺失 → 标准化 → 孤立森林 |

⚠ 模板是**前端的一份常量**，不是后端的一张表：它只是「往画布上摆几个节点」的快捷方式，
落库之后与手搭的图没有任何区别。做成后端资源会长出「模板版本」「模板权限」一整套东西。

### 9.2 模型详情要有的六块

指标卡 / **输入契约表**（schema，逐列列出标签、单位、必填、训练区间）/ 指纹与依赖版本 /
可服务性（两档：台账、对外，各自给原因）/ 产物（大小、摘要、下载）/
关联（绑定与部署各几个）。

### 9.3 服务面要有的四块

部署列表（钉的版本、状态、今日调用量）/ 密钥管理（创建时**只显示一次**、撤销、有效期）/
调用记录（按天聚合的量与错误率）/ **示例代码**（curl 与 Python，把 schema 直接渲染成一份可粘的请求）。

---

## 10. 数据模型变更汇总

全部是**扩展步**（加表、加可空列或带默认值的列），无删列、无改名、无原地改类型、无数据回填。

| 迁移 | 内容 | 期 |
| --- | --- | --- |
| 1 | `modeling_node_runs` 加 `fitted_json JSONB NULL`、`io_json JSONB NULL` | 一 |
| 2 | `modeling_model_versions` 加 `signature_json JSONB NOT NULL DEFAULT '{}'::jsonb` | 二 |
| 3 | 新表 `modeling_model_artifacts` | 五 |
| 4 | 新表 `modeling_deployments` / `modeling_api_keys` / `modeling_call_logs` | 六 |

⚠ 迁移 2 的两列都给默认值，故「新结构 + 旧代码」可用（旧代码不读这两列）。
⚠ 迁移 1 之后、代码更新之前，`fitted_json` 全是 `NULL`，与今天的行为一致（今天就是没有）。

---

## 11. 分期与 PR 切分

每期可独立交付、独立验收。PR ≤400 行、只碰一个服务，锁文件单独成 PR。
迁移、鉴权、并发、对外契约逐行评审。

| 期 | 名字 | 交付 | 依赖 |
| --- | --- | --- | --- |
| **一** ✅ | **拟合参数归位**（缺陷 A/B） | 迁移 1；子进程返回 `fitted`/`io`；执行器落库；发布读新列；发布期实跑一行核对；带 `standardize` 的端到端用例 | —— |
| 二 ✅ | 入口契约与模型签名 | `describe_columns`；`known_keys_by_node` 改用它；`serving_json` 2.0 + 双版本分派；`signature_json` 生成器；前端删掉第二份收窄口径 | 一 |
| 三 | 算子扩容 A（不改列集的） | `cast_type` / `drop_missing` / `clip_outlier` / `filter_rows` / `resample` / `logistic_regression` / `kmeans` / `classification_metrics` / `residual_analysis` / `feature_importance` | 一 |
| 四 | 算子扩容 B（改列集的） | `time_feature` / `one_hot` / `select_feature` / `pca` / `lag_feature` / `rolling_feature` / `ledger_join` / `cross_validate` | 二 |
| **五** | **台账批量预测相位**（D11b） | 公式列分层；收集 / 回填两趟；`AnalysisModel.predict_batch`；`EvalContext.model_sink` 与 `row_ts`；ADR。**只碰 `apps/dataset`** | 二 |
| 六 | 产物与通道 B | 迁移 3；对象存储写读；四条护栏；树模型三个；全量帧导出；ADR | 五 |
| 七 | 对外服务 | 迁移 4；管理面 + 对外面；边缘 location + 限流；auth 规则与种子；ADR | 二（schema 就是接口文档） |
| 八 | 公式一键化 | `:register-formula`；换绑的入口契约比对；台账列显示「由哪个模型算」 | 二 |
| 九 | 前端四面 | 运行面、模型详情、服务面、模板、结果导出入口 | 六 / 七 / 八 |

⚠ **第一期必须最先**：它修的是一条已经在线上的静默错值缺陷，且后面每一期都压在它上面。
⚠ **第五期排在第六期前面**：批量相位是通道 B 进台账的前提，先把相位铺好，
树模型落地时只是「多一个实现了 `predict_batch` 的模型」，不必两件事一起改。
⚠ 三、四两期内部可高度并行（每 2–3 个算子一个 PR，互不相干）。

### 需要的 ADR

| 题 | 期 |
| --- | --- |
| 台账公式重算加批量预测相位，求值器保持纯同步 | 五 |
| 模型二进制产物走对象存储且只加载自产字节 | 六 |
| 对外推理面走 API 密钥并由边缘免认证 location 承载 | 七 |

⚠ 编号取当前未占用的下一个。`docs/adr/` 在 `main` 上到 0044，
但另有分支正在占 0045——开写前先看一眼。

---

## 12. 待确认与待拍板

**U1 · ~~台账求值上下文里拿不拿得到当前行的 `ts`~~ —— 已查证：拿得到。**
`evaluate_row` 的形参上就有 `ts`，加一格带默认值的 `EvalContext.row_ts` 即可，
改动落在一个函数上。详见 D19。

**U2 · ~~通道 B 进不进台账~~ —— 已拍板：进，且直接给求值器加批量相位。**
见 D11 / D11b，单独成第五期。⚠ 相位落地后要补
[MODELING_DESIGN.md](./MODELING_DESIGN.md) §13.2 那条「没量过」：
用 20 万行 × 3 个模型压一次，把两趟求值的额外开销与批量预测的收益都记下来。

**U3 · 对外面的资源名。** 本文用 `open-models`（照 `public-dashboards` 的构词）。
备选 `served-models` / `model-endpoints`。定下来之后不好改（第三方已经在用）。

**U4 · 「运行」面要不要跨流水线。** 做成跨流水线的全局列表更好找，
但那意味着一个只有某几条流水线权限的用户会看到别人的运行——本仓的建模权限**不分资源**
（`modeling:view` 是全量读），所以今天不成问题，但要写下来。

**U5 · 产物保留策略。** 版本退役之后对象什么时候删？建议：退役即标记，
由保留期清理循环延迟 7 天真删（给「退役错了想撤回」留一个窗口）。
