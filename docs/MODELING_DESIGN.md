# 分析建模（modeling）—— 设计与接口契约

> 权威设计文档，开发前必读。涉及 **platform-server**（新增 `apps/modeling`：5 张表 +
> 算子体系 + 执行引擎 + 一个台账求值扩展点的实现 + REST）、**web**（建模页）与
> **auth-server**（权限码与闸 1 规则）三处。任何跨层契约变更**先改本文档、再改代码**。
>
> 上游是[数据台账](./DATASET_DESIGN.md)（唯一数据源），下游还是数据台账（模型经公式库
> 条目回到台账列）。这两条缝的机制在台账文档里，本文只写**接缝**，不重复。
>
> 参考实现是兄弟仓 `../DigitalTwinBK/digitaltwin-server/apps/modeling`。**只参考功能，
> 不照抄代码**——那仓是单体、进程内后台协程、表名前缀不同，与本仓的微服务分层、
> 运行角色、结构闸门全都对不上。哪些判断值得继承、哪些必须反着做，见 §12。

---

## 1. 目标与非目标

### 1.1 用户诉求与它翻译成的工程语言

| 用户说 | 工程语言 |
| --- | --- |
| 用流水线搭分析模型 | 有向无环图 + 算子 + 执行引擎；五类环节：数据源 / 预处理 / 特征工程 / 建模 / 评估 |
| 数据源是数据台账 | 唯一取数入口是 `apps/dataset` 的公开面，且必须走台账既有的取值口径（§3.3） |
| 每个环节都能看到中间结果 | 节点级执行记录 + 每个输出端口一份**有硬上限**的结果摘要，刷新后可重建视图 |
| 建好的模型当公式配到台账里 | 台账公式引擎加一个 `MODEL(...)` 取数相位；模型版本编译成**纯计算的可调用对象**进求值上下文（§7） |
| 分析环节要能扩展 | 算子是**代码**，一个类一个算子，登记进注册表；加算子不改引擎、不改前端、不动数据库（§5） |
| 结果要能看 | 结果摘要按 `kind` 显式派发到不同视图：帧表格 + 列统计、指标卡、真实-预测散点、残差直方图（§8.4） |

### 1.2 本轮范围（一条最小闭环，五类环节各一个算子）

- 新 app `apps/modeling`，5 张表，REST + 算子注册表 + 图校验 + 执行引擎；
- 执行跑在 `ROLE=worker`，经 Redis Stream 领活，节点在进程池子进程里算；
- P0 算子六个，覆盖五类：`ledger_source`（源）/ `fill_missing`（预处理）/
  `standardize`（特征）/ `split_dataset` + `linear_regression`（建模）/
  `regression_metrics`（评估）；
- 节点级中间结果（摘要进库、按节点懒加载）；
- 模型版本发布 + **台账公式接缝打通**：台账列写 `@能耗预测({温度}, {负荷})` 真出数；
- 前端建模页：画布搭图、schema 驱动参数表单、逐节点看结果、运行历史只读回看。

### 1.3 明确不做

| 不做 | 为什么 |
| --- | --- |
| **任意用户代码算子**（自定义 Python / LLM 生成代码直接执行） | 这是一个任意代码执行面。参考仓有三个这类算子 + 一个 `/generate-code` 端点。配了 AST 沙箱也只是把 RCE 变成「需要绕过一道名单」。这条**永久**不做，不是"以后再说"（§9.3） |
| **导入外部模型二进制**（joblib / pickle） | `joblib.load` 等价于任意代码执行。便携性用「流水线可迁移可复现」满足（D10）。⚠ 与「本服务自己训练、自己写入的二进制产物」区分——那是允许的（本仓 `ac_model_artifacts` 已有先例），判据是**这份字节是谁写的** |
| **时序外推模型**（ARIMA / Prophet / LSTM） | 它们的推理语义是「给窗口，外推 N 步」，与台账列「一行一格」的求值契约根本不同。参考仓把它们训出来了却服务不了，推理时 warning 一句就跳过——训完看着成功、上线永远空 |
| **断点续跑 / 从某节点重跑** | 需要每个节点的输出落成可寻址产物 + 一套失效判定。本轮失败即停、重跑整条（D18） |
| **深度学习 / GPU** | 没有需求，且会把镜像与部署复杂度提升一个量级 |
| **自动重训 / 漂移闭环** | 参考仓的 monitoring 是个无状态 PSI 计算器，闭环没接上。不做半截 |
| **一键重算全部受影响台账** | 重算是 `dataset:backfill` 档位的权限，不该被 `modeling:publish` 顺带授予。换绑回执带**影响面**，重算由用户在台账页显式发起（§7.7） |
| **模型 A/B、灰度、影子流量** | 一个公式条目一个版本，切换是显式动作（D8） |
| **调参搜索**（网格 / 随机 / 贝叶斯） | 之后再看。参考仓的贝叶斯搜索在缺 optuna 时**静默降级**成随机搜索，用户看不出来——要做就得把降级说出来 |

---

## 2. 领域词表

> 与 `platform-server/CONTEXT.md` 同风格。术语定案后抄进那份词表，本节是定案处。
> 标「不叫」的同义词一律不用——它们各自暗示一种与本仓决策相反的语义。

| 词 | 指什么 | 不叫什么 |
| --- | --- | --- |
| **流水线** `pipeline` | 一张**有向无环图**：节点是算子实例，边是数据流。它是**定义**，不含任何一次运行的结果 | 不叫工作流（那个词暗示有人审批、有状态流转；这里从头到尾是数据变换，没有人参与其中任何一步） |
| **算子** `operator` | 图上的一类计算单元，代码里是一个类，用装饰器登记进注册表。算子是**代码**不是数据——用户不能新增算子，只能实例化已有算子并配参数 | 不叫模块（`module` 已被大屏组件系统占死，两套「模块注册表」并存会让这个词失去指向） |
| **节点** `node` | 图上的一个算子实例 `{id, operator, alias, config, position}`。**`id` 是服务端语义上的稳定键** | 不叫步骤 |
| **别名** `alias` | 节点上的展示名。**只做展示**——不进任何 map 的 key、不参与寻址（D5） | —— |
| **端口** `port` | 算子的具名输入 / 输出口。边**必须**同时指明两端的端口名（D4） | —— |
| **契约** `contract` | 端口上负载的类型标识，形如 `frame@v1`。两端契约不相等即不许连线。**这是唯一的类型判据**（D11） | 不叫数据类型 |
| **特征帧** `frame` | 流水线里流动的唯一表格载体：列定义（含**角色**）+ 行矩阵 + 时间索引。契约 `frame@v1` | 不叫数据集（「数据集」在本仓已指台账那一层，混用会让「数据集从数据集取数」这种句子无法解析） |
| **列角色** `role` | 帧上每一列的用途：`feature` / `target` / `ignored`。**目标列在切分算子上一次性指定**，下游从角色读（D13） | —— |
| **运行** `run` | 流水线的一次执行。有自己的图快照（D6）、状态机、节点级记录与结果摘要。运行是**过程记录**，有保留期 | 不叫任务 |
| **结果摘要** `preview` | 一个输出端口的**有上限**的可视表示：形状 + 列统计 + 前 N 行 / 指标全量。进数据库 | 不叫中间结果一个词打天下——界面文案可以那么说，代码与接口里必须区分 preview（摘要，进库，有上限）与全量产物 |
| **模型版本** `model version` | 一次成功运行产出的、**不可变**的可服务表示：算法 + 特征契约 + 拟合参数 + 指标 + 指纹。发布后只读，改要发新版本（D8） | —— |
| **可服务** `servable` | 一个模型版本能否被台账公式调用。判据是**拟合参数能否用纯 JSON 完整表达**（D9）以及**流水线里有没有推理期算不出来的算子**（§7.6） | —— |
| **绑定** `binding` | 一条公式库条目与一个模型版本的对应关系，外加**形参 → 特征列**的有序映射 | 不叫部署（那暗示起了一个服务进程；这里既没有独立进程也没有 endpoint，推理就发生在台账重算的那个协程里） |

---

## 3. 架构分层

### D1 · 落在 `platform-server/apps/modeling`，不新建服务、不扩展 `apps/dataset`

**为什么不新建代码单元**：模型当公式用时，求值发生在台账重算的那个协程里，必须是
**进程内**调用；跨服务意味着每一批分析值一次网络往返。而训练取数是台账整表扫描，
跨服务要么 HTTP 搬几十万行、要么两个服务连同一个库——后者直接违反
[ADR-0003](./adr/0003-一库多schema且写独占读放行.md) 的写独占。

**为什么不塞进 `apps/dataset`**：台账 app 已经有四个子域（表定义 / 数据行 / 公式引擎 /
采集与回填），`services/` 下 20 个模块。塞进去会让「改台账」与「改建模」在同一棵依赖树上
互相拖累。做成 `apps/dataset/modeling/` 子包也挡不住依赖倒挂——台账的求值层会很自然地开始
import 建模的东西，而结构闸只拦 **app 之间**的环，包内的环它看不见。分成两个 app，这条环在
第一次出现时就红。

**训练的 CPU 不进 API 进程**：执行跑在 `ROLE=worker`（D16），与 `ac_model` 训练消费者
同款范式。代码单元仍是一个（platform-server），部署单元照旧是 api / worker / publisher 三种
进程——这正是 [ADR-0002](./adr/0002-重任务用运行角色而非独立服务.md) 的适用面。

### 3.1 目录与依赖方向

```
apps/modeling/
├── __init__.py
├── api/                     # 每个文件一组端点，静态段必须排在 /{id} 之前
│   ├── __init__.py          # ROUTERS 聚合，供 app.py 装配
│   ├── modeling_operators.py    # 算子目录
│   ├── modeling_pipelines.py    # 流水线 CRUD / 校验 / 导出导入
│   ├── modeling_runs.py         # 发起 / 取消 / 进度 / 节点级结果
│   ├── modeling_models.py       # 模型版本
│   └── modeling_bindings.py     # 公式绑定
├── services/                # 事务边界在这一层
│   ├── __init__.py          # 公开面：跨 app 只许 import 这里
│   ├── frame_source.py      # 台账 → 特征帧（唯一跨 app 取数处）
│   ├── graph_check.py       # 图校验（环 / 端口 / 契约 / 必填 / 孤立 / 列存在）
│   ├── run_service.py       # 发起、取消、状态迁移
│   ├── run_executor.py      # 拓扑执行编排（worker 侧）
│   ├── run_worker.py        # Redis Stream 消费循环 + 进程池
│   ├── node_task.py         # 子进程侧入口：跑单个算子
│   ├── preview.py           # 结果摘要生成与截断
│   ├── publish_service.py   # 运行 → 模型版本
│   ├── binding_service.py   # 绑定与形参映射
│   ├── model_provider.py    # 台账求值扩展点的实现（AnalysisProvider）
│   ├── serving.py           # serving_json → 纯计算的 predict
│   └── retention.py         # 运行记录与节点明细清理
├── operators/
│   ├── __init__.py          # 显式登记清单（不自动扫包）
│   ├── base.py              # OperatorBase / PortSpec / OperatorSpec / 契约常量
│   ├── registry.py          # 进程内单例注册表
│   ├── frame.py             # 特征帧的构造与投影助手（含唯一一份切法）
│   ├── source.py  preprocess.py  feature.py  model.py  evaluate.py
├── crud/                    # 只 flush，不 commit；不跨 app
├── models/                  # ORM，不跨 app
├── schemas/                 # pydantic 出入参
├── deps.py                  # 路由依赖：权限 + 取会话 + load_xxx 404 助手
├── permissions.py           # 权限码常量
└── errors.py                # 领域号 14 的异常
```

依赖方向恒为 `api → services → crud → models`，由结构闸静态锁死。三条本模块特有的边界：

1. **`apps/modeling` 只许 import `apps/dataset/services/__init__.py` 的公开面**，
   不许深链到 `apps.dataset.crud` / `apps.dataset.models`
   （`project-structure-python.md` §7 铁律 4）。
2. **`apps/dataset` 永远不许 import `apps/modeling`。** 运行期台账求值确实会调到建模的代码，
   但那是经**抽象基类 + 注册表**做的依赖反转（§7.2），台账编译期不知道有个叫 modeling 的 app。
3. **跨 app 取数只能住 `services/`**，`crud/` 不许 import 别的 app，**含函数内惰性 import**
   ——惰性只是把编译期的环藏到运行期，不算解开。

### 3.2 装配点

| 角色 | 装什么 | 在哪 |
| --- | --- | --- |
| `api` | `MODELING_ROUTERS` 进 `create_app(routers=...)`；**注册 provider** | `app.py` |
| `worker` | 运行消费循环 + 进程池；保留期清理循环；**注册 provider** | `worker.py` |
| `publisher` | 什么都不装 | —— |

⚠ **provider 必须在 api 与 worker 两个角色都注册。** 注册表是**进程内**全局 dict，
而台账重算可能由任意 API 副本上的单行写触发、也可能由 worker 上的回填触发。漏一处的现象是
「有时候出数、有时候是空」，且与副本编号相关，极难复现。参考仓的同一条缝没接通的原因正是
`register_provider` 在生产代码里一次都没被调用（只有测试调）。装配点由契约测试的名单锁死。

### 3.3 取数：只认台账，且只走台账自己的口径

唯一取数路径（`services/frame_source.py`）：

```
dataset.table_service.resolve_table_code(session, code)      → 台账 id
dataset.column_service.list_column_specs(session, table_id=) → 当前列清单（纯数据）
dataset.record_read.scan_effective(session, window=, limit=)  → 生效值，ts 正序
```

⚠ **台账侧为此新增了四样东西，都是纯加法**：`RecordWindow.sources`（按行来源过滤，
下推进 SQL）、`record_read.scan_effective` + `EffectiveWindow` / `EffectiveRow` /
`EffectiveScan`（整段取生效值，**ORM 实例不出台账模块**）、
`table_service.resolve_table_code`（按编码取 id，同样不回整行）、
`column_service.list_column_specs`（列清单的最小纯数据形态）。
四样都进了 `apps/dataset/services/__init__.py` 的公开面——跨模块只许走那里。

**为什么不自己写 SQL**：取值口径「人工修正优先、公式结果覆盖同名键」在本仓只有一份实现
（`effective_merged`）。自己拼一份的现象是**模型训练用的是原值、界面上看的是修正值**，
两边各自自洽，排查时几乎不会怀疑到取值口径上。

**为什么不用 `read_series`**：它按列各返回一条 `[{t,v}]` 序列且丢空值，各列长度不同，
按位置对齐会静默错位。建模要的是**等宽矩阵，缺失必须保留为缺失**——台账 D3 明写空值一路
保持到展示层，绝不 coalesce 成 0。

**为什么不用 `list_records`**：它返回的是面向界面的游标分页对象，且带 `RecordOut` 序列化开销。

`scan.is_truncated` 必须如实传到运行记录与界面，不许吞掉。

#### 取数时必须处理的四件事

| 事实 | 处理 |
| --- | --- |
| **同一 `ts` 合法地有多行**：只有 `source='collect'` 的行走 uuid5 桶身份，manual / import 用 uuid4 | 取数算子给一个 `row_source` 参数（`collect` / `manual` / `import` / `all`，默认 `collect`）；选 `all` 时按 `(ts, row_id)` 建索引并在摘要里如实标注「同一时刻有 N 组重复」 |
| **已删列的残值刻意留在 `values_json` 里**（一次编辑不承担清理历史数据的职责） | 先取当前列定义清单，再按它投影；绝不把 `dict` 直接展开成矩阵——会长出幽灵列，且不同年份的行列集合不同 |
| **`values_json` 里的类型不可信**：写入路径的类型收敛只在 API 那一条上生效，采集器与回填走另一条构造式 | 按列定义的 `data_type` 显式转换，转不动的成缺失并计入列统计的 `coerce_failed` |
| **同一列在不同时期可能是两种聚合口径**，且行上没有字段记录「当初按什么口径算的」 | 取数算子把训练窗口写进模型版本指纹；窗口跨度过大时界面给一条明确提示。**这是数据本身发现不了的分布漂移**，只能靠说清楚 |

⚠ 台账 `ts` 存 UTC 但业务日历是配置里的聚合时区。做「按天 / 按小时」这类时间特征时按 UTC
截断会整体偏 8 小时，且不报任何错。时区偏移由引擎在 `bind_runtime` 里注入，算子不自己读配置。

---

## 4. 数据模型

5 张表，全部 `modeling_` 前缀，落 `platform` schema，普通表（不上 TimescaleDB——它们是元数据
与执行记录，不是时序）。命名与约束显式化，主键 UUIDv7，时刻一律 `timestamptz` 存 UTC，
**禁原生 ENUM**（取值集合用 CHECK 约束的字面量表达，与 `dataset_*` 同款）。

落地时定下的三处，记在这里免得后人当成遗漏：

- **只有流水线与绑定挂 `TimestampMixin`。** 运行、节点记录、模型版本只有 `created_at`——
  模型版本按 D8 是不可变的，给它挂一个 `updated_at` 是句假话。为此 `models/base.py` 另出两个
  混入：`CreatedAtMixin` 与 `EagerDefaultsMixin`。⚠ **`eager_defaults` 不能省**：这三张表都有
  服务端默认值（`attempt` / `cancel_requested` / `preview_truncated` / `created_at`），少了它，
  写过这行之后同步访问那些属性会在 asyncio 会话里抛 `MissingGreenlet`。
- **`trigger` 的取值集合现在只有 `manual` / `api`，不含 `schedule`。** 往一个闭合集合里塞一个
  当前没有任何代码产得出的取值，等于把一个永远为假的分支钉进 CHECK；真要定时触发时走一次
  放宽 CHECK 的扩展迁移（本仓已有先例）。
- **`error_text` 没有长度 CHECK。** 8 KiB 截断是写入方的责任（常量在 `models/run.py`）。让它
  因为超长而整个失败，等于把一次可解释的失败变成一次无声的失败——而这一列存在的意义正是
  记录失败。

### 4.1 `modeling_pipelines` · 流水线

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | |
| `code` | text UNIQUE NOT NULL | 便携标识：导出 / 导入按它对齐，建后不可改 |
| `name` | text NOT NULL | |
| `description` | text NULL | |
| `graph_json` | JSONB NOT NULL | 图本体，形状见 §4.6 |
| `source_table_codes` | JSONB NOT NULL default `'[]'` | 冗余：该图用到哪些台账。**由保存路径唯一写入**，用于「改这张台账会影响谁」的反查 |
| `created_by` / `created_by_name` | text | 与 `dataset_records` 同款 |
| `created_at` / `updated_at` | timestamptz NOT NULL | |

不建额外索引：量级是几十到几百条，主键 + 唯一约束够用。

### D4 · 图存一列 JSONB，但**边必须带端口**

**为什么不选 node / edge 双表**：编辑器是「草稿 → 整体保存」模型（与大屏编辑器同源），
本来就是整体提交；双表的增量更新好处一口吃不到，却要付三表事务的代价。
「哪些流水线用了这张台账」靠 `source_table_codes` 冗余列拿到，够用。

**但有一条必须与参考仓相反：边要带端口。** 参考仓的边只有 `source_node_id` / `target_node_id`，
连线语义靠「下游每个输入端口名去所有上游的上下文里找同名 key」隐式推导。后果是**上游有两个
节点都产出 `frame` 端口时，用户在画布上根本无从表达"我要连哪一路"**。这是抄那套模型时
**唯一必须改的结构性决定**，也是最贵的一处返工——改它要同时动表、保存路径、执行引擎的输入
拼装和前端画布。所以从第一天就带。

### 4.2 `modeling_runs` · 运行

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | |
| `pipeline_id` | uuid FK → pipelines ON DELETE CASCADE | |
| `status` | text NOT NULL | `pending` / `running` / `cancelling` / `succeeded` / `failed` / `cancelled` |
| `graph_snapshot` | JSONB NOT NULL | **运行时冻结的整份图**（D6） |
| `trigger` | text NOT NULL | `manual` / `api`；预留 `schedule` |
| `cancel_requested` | bool NOT NULL default false | 取消旗标（D24） |
| `heartbeat_at` | timestamptz NULL | 执行者每跑完一个节点写一次，用来判「跑飞了」 |
| `attempt` | int NOT NULL default 0 | 队列重投递次数；超过上限即判毒丸落 `failed` |
| `started_at` / `finished_at` | timestamptz NULL | |
| `duration_ms` | int NULL | 冗余，列表页排序用 |
| `row_count` | int NULL | 取数行数，第一手规模指标 |
| `source_truncated` | bool NOT NULL default false | 取数是否触顶 |
| `error_text` | text NULL | 终态失败原因（截断 8 KiB） |
| `created_by` / `created_by_name` / `created_at` | | |

索引：`(pipeline_id, created_at DESC)`。

### D17 · 单飞由数据库的部分唯一索引保证，不用 Redis 锁

```sql
CREATE UNIQUE INDEX modeling_runs_one_active_per_pipeline
  ON platform.modeling_runs (pipeline_id)
  WHERE status IN ('pending', 'running', 'cancelling');
```

一条流水线同时只能有一次在途运行，这是**数据库不变量**，不是一把有 TTL 的锁。

**为什么不用 Redis 单飞锁**（参考仓与本仓回填的做法）：锁与 run 行的生死是两件事，
锁提前过期就会并发跑两次、锁没释放就会 30 分钟发不起来。而这条约束天然与 run 行的状态同生死，
且并发插入时由 Postgres 直接拒绝——第二个请求收到的是 409 而不是"看起来成功了但没跑"。

**跑飞的怎么解锁**：worker 每跑完一个节点写一次 `heartbeat_at`；队列侧靠
`claim_idle_ms` 把没确认的消息重投给别的消费者（D25）。心跳陈旧超过阈值且消息已无人认领时，
保留期清理循环把它落 `failed`（原因写「执行中断」），索引随之放开。

### D5 · 上下文键一律用 `node.id`，`alias` 只做展示

参考仓的执行上下文 key 是 `alias or str(node.id)`，而 `alias` 只是普通可空列、没有唯一约束。
两个节点起同名 alias → 后执行的**静默覆盖**前者的输出，下游拿错数据且无任何报错。
我们只用 `node.id`。别名冲突因此从「静默算错」降级成「界面上两个节点重名，不好看而已」。

### D6 · 运行时冻结整份图快照

`graph_snapshot` 在建 run 那一刻写死。之后流水线被改被删，历史运行依然能复现当时的拓扑与参数。

⚠ 结果读回、只读回看、重跑「同一份图」全部读 `graph_snapshot`，**不读 pipeline 的
`graph_json`**。这条一破，历史运行的界面就会显示当前的参数、配着当时的结果。

### 4.3 `modeling_node_runs` · 节点级执行记录

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | |
| `run_id` | uuid FK → runs ON DELETE CASCADE | |
| `node_id` | text NOT NULL | 图里的节点 id |
| `operator` | text NOT NULL | 算子 code（冗余，列表页不必回查图） |
| `alias` | text NULL | 冗余展示名 |
| `ordinal` | int NOT NULL | 拓扑序，界面按它排 |
| `status` | text NOT NULL | 与 run 同一套取值，外加 `skipped` |
| `started_at` / `finished_at` / `duration_ms` | | |
| `error_text` | text NULL | **含 traceback**（截断 8 KiB） |
| `preview_json` | JSONB NULL | `{端口名: 结果摘要}`，有硬上限（D19） |
| `preview_truncated` | bool NOT NULL default false | |

唯一约束 `(run_id, node_id)`；索引 `(run_id, ordinal)`。

### D7 · 必须有节点级执行表

参考仓**没有**这张表：节点粒度的开始 / 结束 / 耗时 / 状态只存在于 SSE 事件流里，**断线即失**。
刷新页面后拿不到耗时、拿不到失败节点的 traceback。「每个环节都能看到中间结果」这条诉求
**必然**要求刷新后能重建视图，所以这张表是硬需求，不是优化。它同时也是进度的唯一真源（D23）。

### 4.4 `modeling_model_versions` · 模型版本

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | |
| `pipeline_id` | uuid FK → pipelines **ON DELETE RESTRICT** | 删流水线前必须先退役它的模型 |
| `run_id` | uuid FK → runs **ON DELETE RESTRICT** UNIQUE | 一次运行至多一个版本 |
| `version` | int NOT NULL | 按流水线自增；唯一约束 `(pipeline_id, version)` |
| `name` | text NOT NULL | |
| `algo` | text NOT NULL | 建模算子 code |
| `task` | text NOT NULL | `regression` / `classification` |
| `servable` | bool NOT NULL | 能否被台账公式调用（D9） |
| `serving_channel` | text NOT NULL | `json`（本轮唯一） / `binary`（留给树模型） |
| `unservable_reason` | text NULL | 不可服务时的人话原因 |
| `serving_json` | JSONB NOT NULL | **纯数据的可服务表示**，形状见 §7.3 |
| `feature_keys` | JSONB NOT NULL | 有序特征列 key = 对外输入契约 |
| `target_key` | text NOT NULL | |
| `metrics_json` | JSONB NOT NULL | 发布时冻结的评估指标 |
| `fingerprint_json` | JSONB NOT NULL | `{format_version, python, numpy, sklearn, rows, since, until, table_codes}` |
| `description` | text NULL | |
| `created_by` / `created_by_name` / `created_at` | | |

⚠ 二进制产物列（`artifact` / `artifact_digest` / `sklearn_version`）本轮**不建**。要建的时候
照 `ac_model_artifacts` 那张表的形状**另起一张子表**，不给本表加 bytea 列——版本表要被列表页
全量读，加一列几十 MB 的 bytea 会让每次列表都拖着产物走。

### D8 · 模型版本不可变；绑定显式钉版本，不做「跟随最新」

发布之后 `serving_json` / `feature_keys` / `metrics_json` 只读。要改就发新版本。

**为什么不做「跟随最新」**：公式库条目的语义是「就地改、引用方自动跟随」，那是用户拍板的，
且代价已知——公式的口径改动至少还是**人写的一段文本、能 diff**；模型换一版，台账里所有数字
都会变，而变化的原因是几千个浮点参数，没有任何地方能 diff 出「为什么这个月的预测值都低了
8%」。所以版本钉死，切换是显式动作，回执带影响面（§7.7）。

这也顺带让**不可变**成立，从而 provider 侧的版本缓存不需要任何失效机制。

### D9 · 可服务性由算法决定：拟合参数能纯 JSON 表达才可上线

`serving_json` 里只有数值与字符串——线性族的系数与截距、标准化的均值方差、填充值。
**推理时不读任何文件、不反序列化任何二进制**，因此天然跨副本可用（DB 是共享的），
也天然没有反序列化风险。

树模型（随机森林 / GBDT）的拟合参数表达不成纯 JSON，本轮**不可服务**——可以训练、可以看
指标、可以做对比，只是发布按钮禁用并给出原因。要让它可服务，走的是
「本服务自己训练、自己写入、带摘要校验与版本锁」的二进制通道，本仓 `ac_model_artifacts`
已有完整先例可抄，那是下一轮的事。

⚠ **不可服务必须显式、可测、界面可见**。参考仓的同类问题（ARIMA / Prophet 训得出来服务
不了）表现为推理时 warning 一句就 `continue`，用户完全不知道自己上线了一个永远返回空的模型。

### 4.5 `modeling_bindings` · 公式绑定

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | |
| `fx_code` | text UNIQUE NOT NULL | `dataset_formulas.code` 的**逻辑引用**，不建外键 |
| `model_version_id` | uuid FK → model_versions ON DELETE RESTRICT | |
| `param_map_json` | JSONB NOT NULL | 有序 `[{param, feature}]`，形参名 → 特征列 key |
| `param_names_snapshot` | JSONB NOT NULL | 绑定时的形参名集合，provider 每次加载时比对（§7.5） |
| `is_enabled` | bool NOT NULL default true | |
| `created_by` / `created_by_name` / `created_at` / `updated_at` | | |

**为什么 `fx_code` 不建外键**：跨 app 的表间外键会让 `apps/modeling/models` 依赖
`apps/dataset/models`，而结构闸明令 models 层不跨 app。本仓已有同款先例：
`dataset_columns` 的点位身份逻辑引用采集侧的表也不建外键。代价是「公式条目被删、绑定成孤儿」
要靠应用层守卫——见 §7.7。

**为什么绑定表在 modeling 而不是给 `dataset_formulas` 加列**：后者会让台账的表承载建模的
概念，等于把依赖方向掰弯。而且这张表要存的东西（形参映射、快照、版本指针）只有建模侧看得懂。

### 4.6 `graph_json` 的形状（也是导出件的形状）

```jsonc
{
  "format_version": "1.0",
  "nodes": [
    {
      "id": "9f2c…",               // uuid4 字符串，前端生成，全图唯一
      "operator": "ledger_source",  // 注册表的 key
      "alias": "小时级能耗",          // 展示名，可空
      "config": { "table_code": "energy_h", "columns": ["温度", "负荷"] },
      "position": { "left": 120, "top": 80 }
    }
  ],
  "edges": [
    {
      "id": "e1",
      "from_node": "9f2c…", "from_port": "frame",
      "to_node":   "a71b…", "to_port":   "frame"
    }
  ]
}
```

⚠ **纯 HTTP 部署禁 `crypto.randomUUID`**（只在 secure context 存在）——节点 id 由前端用
`getRandomValues` 拼，与本仓其它内网部署面同一条约束。

### D10 · 便携 = 流水线可迁移可复现，**不是**模型二进制可迁移

导出件 = `graph_json` + 流水线 code / name / description + 一份**算子版本清单**
`[{operator, spec_version}]`。纯 JSON，无二进制，可读可 diff 可进 git。

导入时：schema 校验 → 算子 code 逐个查注册表（不认识就 400，列出缺哪些）→
`spec_version` 不匹配给警告而非拒绝 → 走**与手工保存完全相同**的图校验 → 落库。
台账 code 不存在时不拒绝导入，但标记该流水线为「待接线」，运行时才报错——目标环境的
台账 code 通常要人工对一遍。

**为什么不做模型二进制的导入**：唯一可行的载体是 pickle / joblib，而加载它等价于在服务器上
执行别人的代码。参考仓的产物路径白名单里甚至把**用户可写的数据集目录**也放了进去。

---

## 5. 算子体系

这是「分析环节可扩展」这条诉求的落点：**加一个算子 = 加一个类 + 在清单里加一行**。
不改引擎、不改前端、不动数据库、不改 API 形状。

### 5.1 算子基类契约

```
类变量（全部 ClassVar，登记即元数据）
  CODE                 全局唯一，注册表主键；不可改（图里存的就是它）
  NAME                 中文显示名
  DESCRIPTION          一句话；同时喂给前端与将来的 LLM 目录
  CATEGORY             source | preprocess | feature | model | evaluate
  SPEC_VERSION         算子契约版本，导入时比对（"1.0"）
  ICON                 DtIcon 注册表里**已登记**的名字
  CONFIG_MODEL         pydantic v2 模型，参数 schema 的唯一来源
  INPUTS / OUTPUTS     tuple[PortSpec, ...]
  REQUIRES_FIT         训练学参数、推理套参数
  ENABLED_IN_SERVING   推理时跑不跑（取数、丢缺失行 = False）
  CHANGES_ROW_COUNT    会不会改变行数（丢缺失行 = True），图校验用
  SERVING_NEEDS_WINDOW 推理时需要历史窗口（lag / rolling = True）
  SERVING_CHANNEL      产 model@v1 的算子走哪条通道（json | binary）；空串 = 不产模型
  RUNTIME_ATTRS        引擎按名注入的运行期上下文名单

运行期注入项（基类给默认值，唯一入口是 bind_runtime）
  tz_offset_minutes    业务时区相对 UTC 的分钟偏移
  split_plan           下游切分的计划；带拟合的算子据此只用训练行算统计量

子类实现
  run(inputs) -> outputs          唯一必须实现的方法
  dump_fitted() -> dict | None    REQUIRES_FIT=True 必须实现，返回值必须是纯 JSON
  load_fitted(params) -> None
  validate_fitted(params) -> None 与 dump 侧严格度对齐

类方法
  spec() -> OperatorSpec          出 API 的完整描述
```

⚠ 上面每一项都在**注册期**被校验：`SERVING_CHANNEL` 漏设或取值不在白名单、
`RUNTIME_ATTRS` 与 `bind_runtime` 的参数对不上、端口名重复，都在登记那一刻拒绝。
理由是这几项打错名字在运行期是**静默**的：时间特征按 UTC 算差 8 小时、拟合统计量按整帧算
（测试集泄漏），两者都不报错。

`PortSpec`：`name` / `contract` / `label` / `is_required` / `description`。

⚠ 出 API 的字段名受**命名闸**约束：布尔要 `is_` / `has_` / `should_` / `can_` /
`allow_` / `use_` / `require_` 前缀，或 `_enabled` / `_required` / `_available` 后缀，
且不许出现单字母。所以类变量叫 `REQUIRES_FIT`（大写常量豁免），而它出 API 时叫
`fit_required`；节点位置是 `{left, top}` 而不是 `{x, y}`。
`label` 是画在画布上的短标签——端口名是英文标识，用户看不懂 `train` 是"训练"还是"训练好的模型"。

### D11 · 端口类型只保留 contract 字符串，不要枚举

参考仓有两层皮：类型枚举实际只有 `ANY` / `TABULAR` 两个值，真正的判别力全在 contract
字符串上。两套并存的结果是枚举形同虚设，还得在每个端口上重复声明一次。

我们只有 contract，四个值：`frame@v1` / `model@v1` / `metrics@v1` / `fitted@v1`。
加一种新数据形态不用改枚举、不用迁移；数据结构演进时把后缀改成 `@v2`，旧连线**立刻**在保存
时报错而不是运行时炸。契约常量**集中定义在 `operators/base.py` 一处**——参考仓在三个基类
文件里各复制了一份同名常量表。

### D12 · 步间只有一种表格载体：特征帧

参考仓的端口名约定是两套硬编码模式：加载器 / 预处理用 `(schema, data)`，特征工程 / 训练器用
`(X_schema, X, y_schema, y)`，中间靠一个适配器猜哪一套。于是「X 和 y 的行数怎么保证对齐」
这件事分散在每个算子里，没有一处能一眼看清。

**特征帧（`frame@v1`）**把这些收成一个：

```jsonc
{
  "columns": [
    { "key": "温度", "name": "环境温度", "dtype": "number",
      "role": "feature", "unit": "℃" }
  ],
  "index": [1754380800000, …],       // 毫秒时间戳，与 data 等长；可为 null
  "index_name": "ts",
  "data": [[23.1, 480.0], …],         // 行矩阵，列序与 columns 一致
  "row_count": 8760,
  "provenance": { "table_codes": ["energy_h"], "since": …, "until": …,
                  "truncated": false }
}
```

X / y 的对齐因此是**结构上不可能出错**的：它们本来就是同一个矩阵的不同列。
`provenance` 一路透传到模型版本指纹，回答「这个模型是拿哪段数据训的」。

⚠ 帧是**纯 dict / list**，因此天然可 pickle、可跨进程、可直接进 JSONB。估计器对象
**不跨进程回传**——子进程只回传 `dump_fitted()` 的纯 JSON 与 preview，估计器在子进程里
用完即弃（发布时由 `serving.py` 从 `serving_json` 重建）。这条同时消掉了参考仓
「估计器要能 pickle 回来」的一整类失败。

### D13 · 目标列在切分算子上一次性指定

`split_dataset` 的参数里指定 `target_column`，它在输出帧上把那一列的 `role` 打成 `target`、
其余数值列打成 `feature`。下游训练 / 评估算子**从角色读**，自己没有 `target` 参数。

**为什么不选「每个训练器自己配目标列」**：参考仓的训练器除了目标列还各带三个清洗开关，
于是「哪些列进了模型」这个问题的答案散在三个地方，同一条流水线里两个训练器可以配成不同的
特征集而毫无提示——做模型对比时这是致命的。

### D14 · 一份图两种执行语义：`REQUIRES_FIT` / `ENABLED_IN_SERVING`

同一个算子类承担训练与推理两种模式：`ENABLED_IN_SERVING=False` 的（取数、丢缺失行）推理时
整个跳过；`REQUIRES_FIT=True` 的（标准化、填充）训练时把统计量存下来，推理时回灌。
**这套做法解决的是训练 / 线上特征不一致**——用一份代码同时承担两种模式，杜绝了逻辑漂移。
这是参考仓最有价值的一条设计，原样继承。

⚠ 但**不抄它的搬运方式**：参考仓把拟合参数塞进节点的用户配置里（一个下划线开头的私有键），
推理时还要把这个键剔出来才能构造 config。我们用**独立字段**：拟合参数进
`serving_json.steps[i].fitted`，与用户配置 `config` **并列**。

### 5.2 拟合参数必须按**列 key** 建键，绝不按列索引

参考仓最严重的一处静默错误：标准化算子把统计量存成 `{列索引: {mean, std}}`。训练期若该节点
在切分**上游**，它看到的是含标签列的完整表，索引基于完整表；推理期先把请求投影成特征列、
再跳过切分步骤——**列索引完全对不上**，而找不到的索引只 debug 一行就 continue，对错位的
索引照样施加变换。**结果是无异常、无告警的错误预测。**

硬约束（契约测试锁死）：

1. 所有 `dump_fitted()` 的返回值**一律按列 key 建键**，出现整数键即测试红；
2. 每个 `REQUIRES_FIT` 算子的 `serving_json.steps[i]` 里额外存一份 `expected_input_columns`
   （该步骤训练时看到的列 key 与顺序），推理时先断言再执行，把「静默错位」变成
   「显式失败 + 一句原因」。

### 5.3 防泄漏：带拟合的算子只在训练行上算统计量

标准化 / 填充如果在**整帧**上算均值方差，测试集的信息就进了训练——指标虚高而上线崩。

做法：预处理与特征工程强制在切分**上游**（这是拓扑的自然形态），引擎从图里的
`split_dataset` 节点提取 `{target_column, method, test_ratio, random_state}`，
经 `bind_runtime` 注入到带拟合算子的 `split_plan`；这些算子用**与切分算子同一份切法**
（`operators/frame.py` 里唯一一份 `split_row_indices`）只在未来的训练行上拟合。

配套图校验两条：带拟合算子下游**至多一个**切分；带拟合算子与切分之间**禁止**
`CHANGES_ROW_COUNT` 的算子（行数一变，同一份切法算出的训练行就错位了）。

### 5.4 参数 schema 的声明规范

`CONFIG_MODEL` 是 pydantic v2 模型，`model_json_schema()` 的结果直接驱动前端表单：

- `Field(default=…, title="中文标签", description="中文说明", ge=…, le=…)`；
- 枚举用 `Literal[...]`，前端渲染下拉。⚠ **取值集合写在 description 里而字段是裸 `str`**
  的，schema 上没有 enum，前端会渲染成自由文本框，用户能敲出合法值之外的东西、要等后端
  422 才知道。这一类由契约测试扫描拦下；
- **列引用是一等类型**：字段带 `x-dt-widget: column`，前端据此渲染列选择器；
  **保存期**的图校验据此检查该列在上游帧里真的存在——参考仓没有这一步，列名打错要等运行时；
- 台账引用带 `x-dt-widget: table`，时间点带 `x-dt-widget: moment`（相对档如 `-90d` 与
  绝对时刻**两种写法都要保留**：相对时间让流水线导出到别的环境仍然有意义）；
- properties 按字段定义顺序输出。

⚠ schema **只在出 API 时现取，不落库**。参考仓存 DB 一份、出 API 一份，两份字段顺序不一致。

### 5.5 首期算子清单

**P0 = 本轮必须有**（五类各一个，能跑通一条线性回归全链路）。

| 类别 | code | 名称 | 关键参数 | fit? | serving? |
| --- | --- | --- | --- | --- | --- |
| source | `ledger_source` | 台账取数 | `table_code` / `columns[]` / `since` `until`（绝对或相对）/ `row_source` / `row_limit` | 否 | **否** |
| preprocess | `fill_missing` | 填缺失 | `strategy`（mean/median/constant）/ `columns[]` / `value` | **是** | 是 |
| feature | `standardize` | 标准化 | `method`（zscore/minmax）/ `columns[]` | **是** | 是 |
| model | `split_dataset` | 训练 / 测试切分 | `target_column` / `method`（time_order/random）/ `test_ratio` / `random_state` | 否 | **否** |
| model | `linear_regression` | 线性回归 | `fit_intercept` | 否（拟合结果即模型） | 是 |
| evaluate | `regression_metrics` | 回归评估 | —— | 否 | **否** |

`split_dataset` **默认 `time_order`**——台账数据是时序的，随机切分会让未来数据泄漏进训练集，
指标虚高而线上崩，这是工业时序场景最常见的一类错。界面上选 `random` 时给一条明确警告。
它输出的 `feature_keys` 同时是**模型对外的输入契约**。

`regression_metrics` 输出 R² / RMSE / MAE / MAPE / 最大误差，外加**真实值-预测值对**
（有上限，供散点图）与**残差直方图**（分桶计数，供可视化）。

#### 下一轮的扩容位（结构上已经留好，加类即可）

| 类别 | 候选 |
| --- | --- |
| source | `ledger_join`（多台账按时间对齐） |
| preprocess | `cast_type` / `drop_missing` / `clip_outlier` / `resample` / `filter_rows` |
| feature | `time_feature` / `one_hot` / `lag_feature` / `rolling_feature` / `select_feature` / `pca` |
| model | `ridge` / `lasso` / `logistic_regression` / `random_forest_regressor`（通道 B） / `kmeans` |
| evaluate | `classification_metrics` / `residual_analysis` / `feature_importance` / `cross_validate` |

⚠ `SERVING_NEEDS_WINDOW=True` 的算子（滞后 / 滚动）会让整条流水线**不可服务**（§7.6）。
参考仓完全没拦这一类：它的滞后特征推理时会用请求内的数据重算滞后，行数不足时结果是错的
且不报任何错。

### 5.6 注册机制

`@register_operator` 装饰器登记进进程内单例注册表；`operators/__init__.py` 用**显式 import
清单**触发登记，按类别分段。**不自动扫包**——自动扫包会让「装了一个包就多出几个算子」，
而算子清单是要被契约测试逐条断言的。

**重名不许静默覆盖**：`register` 遇到重复 CODE **抛错**。参考仓是 warning 后覆盖，
加算子时打错 id 会悄悄顶掉别的算子且 CI 全绿。

### D15 · 算子元信息不落库；`GET /operators` 现取，**必须吐完整 spec**

**为什么不建算子表**：图存 JSONB，节点里存的是 code 字符串，不需要外键。而落库的代价是
schema 有两份（DB 一份、代码一份），只要有一处不同步就出现「界面上的表单和实际参数对不上」。

**`spec()` 必须完整出 API。** 参考仓的目录只吐参数 schema，端口一个都没暴露，
**前端画布拿不到任何端口信息，只能自己硬编码一份端口拓扑**。这是那仓最影响建模页落地的一条
缺口。而且这份目录还是将来喂给大模型的同一份——一份目录两个消费者。

```jsonc
GET /api/v1/platform/modeling-operators
[{
  "code": "standardize", "name": "标准化", "description": "…",
  "category": "feature", "spec_version": "1.0", "icon": "workflow",
  "inputs":  [{ "name": "frame", "contract": "frame@v1", "label": "输入", "is_required": true }],
  "outputs": [{ "name": "frame", "contract": "frame@v1", "label": "输出" }],
  "config_schema": { /* CONFIG_MODEL 的 JSON Schema，字段按定义顺序 */ },
  "fit_required": true, "serving_enabled": true, "serving_window_required": false
}]
```

### 5.7 第三方依赖

`numpy` 与 `scikit-learn` **已在 platform-server 的依赖里**（`ac_model` 在用），本轮
**不新增任何 Python 依赖**。特别地**不引 pandas**：六个 P0 算子的取数 / 清洗 / 特征全用 numpy
就够，引进来是一个没有调用点的依赖 + 40 MB 镜像。等第一个真正需要它的算子（重采样 / 分组）
落地时再评估。

⚠ 规矩：**所有依赖显式声明；缺依赖时启动即失败，不做静默降级。** 参考仓有两条依赖靠
`try/except` 静默降级（缺 optuna 时贝叶斯搜索悄悄变成随机搜索）。

---

## 6. 执行引擎

### 6.1 全景

```
POST /api/v1/platform/modeling-pipelines/{id}:run          （api 角色）
  ├─ 图校验（与保存同一份实现）
  ├─ 建 modeling_runs 行（status=pending，冻结 graph_snapshot）
  │    └─ 部分唯一索引挡住并发第二次发起 → 409（D17）
  ├─ 同一事务提交后投队列 modeling:runs
  └─ 202 返回 {run_id}

worker 角色的消费循环（照 ac_model_worker 同构）
  ├─ 认领滞留的 → 取新的 → 逐条处理，确认只在处理走完之后
  ├─ status → running，写 started_at
  ├─ 拓扑排序（Kahn）
  └─ 逐节点：
       ├─ 从上下文按 (from_node, from_port) 取输入
       ├─ 提交给进程池 → 子进程跑 operator.run()
       ├─ 收结果 → 生成 preview → 写 modeling_node_runs（每节点一次提交）
       ├─ 写 run.heartbeat_at
       └─ 读 run.cancel_requested，置位则收摊
  └─ 终态：succeeded / failed / cancelled

GET  /modeling-runs/{id}            ← 前端 1 秒轮询：run 行 + 节点状态列表（不含 preview）
GET  /modeling-runs/{id}/nodes/{nid} ← 单节点，含 preview（懒加载）
POST /modeling-runs/{id}:cancel      ← 置 cancel_requested + status=cancelling
```

### D16 · 执行跑在 `ROLE=worker`，经 Redis Stream 领活

**为什么不在 API 进程里起后台协程**（参考仓的做法）：客户端断连或副本重启 = 运行中断且无人
知道；sklearn 的内存与 BLAS 线程会在 API worker 里累积并与事件循环抢核；而本仓已经有一条
跑通的同款链路（`ac_model` 的训练消费者 + `TrainerPool`），照它做零新范式。

**为什么不挂单活租约**：租约门控的是**全局单例循环**（采集器、发布器、归档器）。一次训练是
用户触发的一次性任务，跑在哪个 worker 上都对；同一条流水线的并发由 D17 的数据库不变量保证。

**为什么不新开 WS 主题**：主题协议当前是「大屏 / 采集」两族，加一族要动边缘网关的订阅路由
与鉴权。建模页是**单用户、单页面、短时任务**，1 秒轮询足够，且轮询天然跨副本正确
（状态在库里，不在发起副本的内存里）。这与「大屏取数统一走 WS」不矛盾——那条约束的是大屏
**运行态**的数据面。

### D23 · 进度的唯一真源是 `modeling_node_runs`，不另设 Redis 进度键

worker 每跑完一个节点提交一次，前端轮询读库即可拼出完整进度。

**为什么不写 Redis 进度**：那会有两份真相——键过期后要回落读库拼出「同一形状」，而两条拼装
路径迟早漂移。节点表本来就必须存在（D7），再多一份缓存是纯负债。代价是每秒一次轻查询，
按运行数量级（个位数并发）可以忽略。

### D17 的补充 · 跑飞的运行怎么解锁

| 情形 | 谁发现 | 怎么落 |
| --- | --- | --- |
| worker 处理中崩溃 / 被强杀 | 队列的 `claim_stale` 把消息重投给别的消费者 | 见 D25 |
| worker 关停宽限期到点还没跑完 | 同上（drain 超时不确认） | 见 D25 |
| 消息整个丢了（Redis 被清） | 保留期清理循环扫 `heartbeat_at` 陈旧且非终态的 run | 落 `failed`，原因「执行中断」 |

### D25 · 重投递一律判「执行中断」落终态，**不重放**

消费者拿到一条消息时：run 已是终态 → 直接确认丢弃（幂等）；run 非终态且这是**重投递**
（消息此前已被派发过）→ 落 `failed`，原因「执行中断，请重新运行」，然后确认。

**为什么不重跑**：一次运行会边跑边写节点记录，重放要先清干净再来一遍；而一张会让子进程崩溃
的图会被无限重投，把训练面整个堵死。**失败即停**（D18）已经决定了不做续跑，重投递重放不是
一个自洽的语义。这也与本仓「写操作超时按不可重试处理」同一条口径。

代价如实记：worker 滚动重启会让在途的那次运行失败，用户点一次「重新运行」。这是**响亮的**
失败，不是静默的。

### D18 · 失败即停，不做断点续跑

任一节点抛错 → 该节点落 `failed` + traceback，其余未执行节点显式落 `skipped`，run 落 `failed`。
不重试、不跳过、不续跑。

节点级的 `skipped` 必须**显式落库**而不是留空——留空的话界面分不清「没跑」与「记录丢了」。

**为什么不做续跑**：续跑要求每个节点的输出落成可寻址产物 + 一套失效判定（上游参数变了产物
就得作废）。这是一个独立的、不小的子系统。参考仓号称有产物文件，但**没有任何代码把它读回来
当输入**——它的"续跑"是不存在的。我们不假装有。

### 6.2 状态机

```
   POST :run ─▶ pending ─(worker 领走)─▶ running ─┬─ 全部节点成功 ─▶ succeeded
                                                  ├─ 任一节点抛错 ─▶ failed
                                                  └─ 取消旗标置位 ─▶ cancelling ─▶ cancelled
```

⚠ **`pending` 不是死枚举。** 今天它的窗口是「投队列到 worker 领走」这一小段，但它是状态机
里唯一承认「已受理、尚未开跑」的格子。参考仓把它做成死枚举（run 一创建就是 RUNNING），
于是「队列积压」与「正在跑」在界面上分不开。

⚠ **取消要有 `cancelling` 中间态。** 参考仓的取消把 DB 状态**立刻**写成终态并把这个终态兼作
取消旗标，于是存在一段「状态显示已取消、节点其实还在子进程里跑」的窗口。我们多一格，
代价是状态机多一个值，收益是状态不撒谎。取消在**下一个节点边界**生效。

**超时**：每节点的超时可配（运行参数，默认 300 秒），**不硬编码**。参考仓硬编码 300 秒且
不可配置。⚠ 超时掐断的只是等待，拟合还在子进程里烧——必须**杀进程换池**
（`TrainerPool.recycle()` 的同款做法），否则单工池被僵尸拟合占着，下一次运行永远排不上。

### D17b · 节点跑在进程池子进程里 —— 资源隔离，**不是**沙箱

收益两条：(a) sklearn / numpy 的内存不在 worker 的事件循环进程里累积；(b) BLAS 线程不与
消费循环抢核（**线程池救不了 GIL**，这是本仓 `code-style-python.md` 的硬规矩）。

⚠ **必须写清楚：子进程不是沙箱。** 用它是为了资源隔离，不是为了跑不可信代码——不可信代码
根本不进来（§9.3）。不写清楚的话，将来一定有人以「反正有子进程」为由加一个自定义代码算子。

⚠ 子进程的隐性约束：算子输入输出必须可 pickle。帧是纯 dict / list，天然可以；**估计器对象
不跨进程回传**（D12 的 ⚠）。

### 6.3 中间结果：产生

每个节点执行完，对它的**每一个输出端口**生成一份 preview（`services/preview.py`），
按契约分派：

| 契约 | preview 形状 |
| --- | --- |
| `frame@v1` | `{kind:"frame", shape:{rows,cols}, columns:[{key,name,dtype,role,null_ratio,n_unique,min,max,mean,p50,coerce_failed}], head:[[…]], index_head:[…], rows_truncated, cols_truncated}` |
| `model@v1` | `{kind:"model", algo, task, hyper_params:{…}, feature_keys:[…], target_key, servable, unservable_reason}` |
| `metrics@v1` | `{kind:"metrics", task, metrics:{…}, curves:{y_true_y_pred:{head,truncated}, residual_hist:{bins,counts}}}` |

⚠ **行截断与列截断各有各的标志位。** 参考仓（与本设计的参考实现第一版）对列截断如实置位、
对行却不置：几万行的帧只留 200 行而界面无从区分「本来就这么少」与「被切了」。

### D19 · 摘要进库必须有硬上限

常量集中在 `services/preview.py` 一处，界面如实标注被截断：

- `PREVIEW_ROWS = 200`、`PREVIEW_COLS = 60`；
- 序列化后 `PREVIEW_MAX_BYTES = 256 KiB`，超了逐级降到 50 行、20 行；
- 仍超则只保留形状 + 列统计，`preview_truncated=true`；
- 单次运行全部 preview 合计 `RUN_PREVIEW_MAX_BYTES = 8 MiB`，超了之后的节点只留统计。

**为什么必须有上限**：参考仓把**完整行矩阵**写进一个累积的 JSON 文件，且**每个节点后重写
一次整个文件**。N 个节点 = O(N²) 字节写入；10 万行 × 20 列 × 8 个节点 = 单次运行几个 GB。
更糟的是详情接口把整个文件读进内存——建模页一打开详情就把服务端内存打爆。

**全量帧落盘本轮不做**：200 行 + 每列统计已经完整满足「看到中间结果，便于分析」这条诉求；
而全量落盘会立刻带来格式（parquet → 新依赖）、保留期、多副本共享三个问题。

### 6.4 中间结果：读回

按 node 懒加载，不一次返回整包。⚠ 读不到就 404 + 明确 message，**绝不静默返回空**——
参考仓读失败时一律返回 None（吞掉异常），中间结果丢了用户看到的是「没有详情」而不是错误。

### 6.5 清理

| 对象 | 策略 | 触发 |
| --- | --- | --- |
| `modeling_node_runs`（含 preview） | 每条流水线保留最近 `N=20` 次运行的节点级明细，更老的删节点行、保留 run 行 | 每次运行结束时对该流水线做一次收敛 |
| `modeling_runs` | 保留 `M=90` 天 | worker 的保留期清理循环 |
| **模型版本** | **不受运行保留期约束** | 只能显式删除，且有绑定时 409 |

⚠ 模型版本的 `run_id` 是 `ON DELETE RESTRICT`——被发布过的运行**删不掉**，所以运行清理必须
先跳过它们。这条要显式写、显式测。

**为什么保留期从第一天就设计**：参考仓**零清理**——删工作流只做数据库级联，产物目录永久残留。
本仓已有成熟的保留期口径（点位归档、台账清理），建模产物纳入同一套。

### 6.6 运行参数

新增一组 `modeling` 进运行参数登记表：

| 键 | 默认 | 档位 | 说明 |
| --- | --- | --- | --- |
| `NODE_TIMEOUT_S` | 300 | 即时 | 单节点超时 |
| `MAX_SOURCE_ROWS` | 200000 | 即时 | 单次取数行上限（与台账 `MAX_RECOMPUTE_ROWS` 同量级） |
| `RUN_KEEP_PER_PIPELINE` | 20 | 即时 | 每条流水线保留几次运行的节点明细 |
| `RUN_RETENTION_DAYS` | 90 | 即时 | 运行记录保留天数 |
| `STALE_RUN_MINUTES` | 30 | 即时 | 心跳陈旧多久判「执行中断」 |

⚠ **运行参数每次现取，绝不赋给模块级变量或 `self.xxx`**——本仓已有一条闸门盯着，
且运行期无症状（覆盖值一换就静默用过期配置）。

---

## 7. 与台账公式对接：模型当公式用

这是「后期把建好的模型当公式配到台账中」这条诉求的落点，也是本模块存在的理由。

### 7.1 全景

```
建模侧                                     台账侧（apps/dataset）
──────────────────────────────────────────────────────────────────────────
成功运行 ──发布──▶ modeling_model_versions
                        │
                   modeling_bindings（fx_code ⇄ 版本 + 形参映射）
                        │
   ModelingAnalysisProvider（实现台账的 AnalysisProvider ABC）
                        ▲
                        │ register_provider("modeling", …)   ← app.py / worker.py 装配
                        │
        apps/dataset/services/analysis_provider.py  的 _PROVIDERS
                        │
        record_history.load_models(plan.model_refs)   ← 一次重算一次加载
                        │  {code: 已编译的可调用对象 | 失败原因}
                        ▼
        build_externals →  externals[("model", code)]
                        ▼
        evaluator._call → PREDICT('能耗预测', {温度}, {负荷}) → 同步纯计算
                        ▼
        台账公式列  @能耗预测({温度}, {负荷})   （公式库条目，体是上面那句）
```

### D26 · 模型以「已编译的可调用对象」进求值上下文，**不是**逐行请求批处理

参考仓的做法是：求值前把 `|模型数| × |行数|` 个「预测请求」全部物化成对象，整批扔给 provider，
套一个 15 秒总超时，超时整批降级。20 万行 × 3 个模型 = 60 万个对象同时驻留内存，且没有分片。

本仓的公式引擎本来就有一套**取数相位**机制（`build_externals`）：`PREV` / 时间窗 / 整列聚合 /
跨表引用都是「求值前预先取好放进 `externals`，求值器本身纯同步无 IO」。模型是同一类东西——
只不过预取的不是"值"，而是**一份模型定义**：

```python
externals[("model", "能耗预测")] = <一个 predict(args) -> float | None 的纯计算对象>
```

一次重算只加载一次（模型版本不可变，进程内 LRU 命中后零 IO），每行求值就是一次点乘。
由此得到三条参考仓拿不到的性质：

1. **没有整批超时这个概念**，因此也没有「整批降级」这种全有全无的失败模式；
2. **`PREDICT` 的实参可以是任意表达式，含公式列**。参考仓必须禁止「AI 列的实参是公式列」
   （它的分析取数发生在公式求值**之前**，放行会拿到上一轮的陈值且不报错）。我们的实参在
   **行内**求值，依赖图天然把被引用的公式列排在前面——这条限制在本设计里不存在；
3. 求值器仍然是**纯同步、零 fixture 可单测**的，这是台账公式子系统最值钱的性质，不能破。

⚠ 硬约束写进算子契约：**可服务算子的推理路径不许有任何 I/O**（无 HTTP、无文件、无逐行
DB 查询）。加载阶段允许查库，求值阶段一次都不许。由契约测试扫描锁死。

### 7.2 台账侧要加的东西（**这是本轮唯一改动台账的地方**）

| 位置 | 加什么 | 为什么是这里 |
| --- | --- | --- |
| `formula/refs.py` | 第六类引用 `ModelRef(code)`，进 `FormulaDeps.model` 与 `to_json` | 五类引用的连边规则各不相同，模型引用**不连边**（它不读别的行） |
| `formula/analysis.py`（新） | `AnalysisModel` 协议（**同步** `predict(args) -> float \| None`）与 `AnalysisUnavailable(reason)` | 求值器只认这个协议，不认识建模的任何概念 |
| `formula/tokens.py` / `parser.py` | `PREDICT` 进函数白名单；**第一个实参必须是字符串字面量**（与 `PREV` 的期数、时间窗字面量同一类"该位置必须是字面量"的既有能力） | 模型标识要在**解析期**就能拿到，才能建预取键 |
| `formula/context.py` | `HistoryCache.models`；`build_externals` 按 `deps.model` 建 `("model", code)` 键 | 取数相位的唯一装配处 |
| `formula/evaluator.py` | `_call` 加一条 `PREDICT` 分支：取出模型对象、逐个求值实参、同步调用 | 与 `_history_key` 三族并列 |
| `services/analysis_provider.py`（新） | `AnalysisProvider` ABC + 进程内注册表 + `register_provider` | ABC 反转的落点。**台账编译期不认识 modeling** |
| `services/record_history.py` | `load_models(codes)`：按 provider 分组、一次批量加载 | 与 `load_history` / `load_whole_stats` 并列，是同一层的第四个加载器 |
| `services/record_compute.py` | 把 `load_models` 接进相位装配，**两条路径都要接** | 见下方的 ⚠ |

⚠ **`ComputePlan` 上必须同步加一个 `model_refs` 派生属性。** 取数层是照着
`prev_refs` / `window_refs` / `whole_refs` / `external_refs` / `needs_history` 这组派生属性
决定装哪些相位的；不加的话新引用在两条路径上都**静默读不到东西**——而
`ExternalsNotPrefetched` 那道守卫只在「键建了但没填」时才响，**键压根没建是不响的**。

⚠ **相位装配有两条路径，形状不同，漏一条的症状是「单行试算对、全表重算全空」。**
单行走 `compute_row`（`load_history` 一把取齐）；批量走 `_run_passes`（批级预取一次）+
`_one_pass`（每趟一次）+ `_cache_of`（靠内存里滚动的 `series` 供 `PREV` 与窗口用）。
模型定义是整批共用的一份，两条路径各接一处即可，但**必须各接一处**。

⚠ **失败要落到 `compute_error` 那一列**（`dataset_records.compute_error`，JSONB
`{列key: 原因}`，整行无错时是 `null` 而不是空字典）。同一个 key 会**同时**出现在
`computed[key] = null` 与 `compute_error[key] = 原因` 两处——光看 `computed` 分不出
「这一格本来就是空」与「这一格算挂了」。

⚠ **`FormulaLibrary` 是快照不是活查询**，同一条纪律适用于模型：**一批算完之前不许换版本**，
否则同一批数据按两套口径算出来，且没有任何症状。模型版本不可变（D8）让这条天然成立。

⚠ **`dataset_formulas` 表一列不加、一条 CHECK 不改。** 模型调用是一个**函数**，不是一种新的
库条目类型。用户在公式库里建的仍然是一条普通条目：

```
标识：能耗预测      形参：温度(column)、负荷(column)
公式体：PREDICT('能耗预测', {温度}, {负荷})
```

台账列里写 `@能耗预测({环境温度}, {瞬时负荷})` 即可。**这是本设计相对参考仓最省的一处**：
零迁移、零表结构变更，且「模型」在公式库里与其它公式长得一模一样，不需要用户理解两套概念。

### 7.3 `serving_json` 的形状

```jsonc
{
  "format_version": "1.0",
  "task": "regression",
  "input_columns": ["温度", "负荷"],        // = feature_keys，对外输入契约
  "steps": [
    { "node_id": "…", "operator": "fill_missing",
      "config": { "strategy": "mean" },
      "fitted": { "温度": 22.4 },                      // ← 按列 key 建键（§5.2）
      "expected_input_columns": ["温度", "负荷"] },      // ← 推理前先断言
    { "node_id": "…", "operator": "standardize",
      "config": { "method": "zscore" },
      "fitted": { "温度": {"mean": 22.4, "std": 3.1},
                  "负荷": {"mean": 480.0, "std": 55.2} },
      "expected_input_columns": ["温度", "负荷"] },
    { "node_id": "…", "operator": "linear_regression",
      "config": { "fit_intercept": true },
      "fitted": { "coef": { "温度": -1.83, "负荷": 0.94 }, "intercept": 12.5 },
      "expected_input_columns": ["温度", "负荷"] }
  ]
}
```

`steps` 是训练时的拓扑序里 `ENABLED_IN_SERVING=True` 的那些节点。
`fitted` 与用户配置 `config` **并列而不是混在一起**。

⚠ **常量列会让发布失败，这是好事，但错误必须在发布时报，不能在推理时报。** 参考仓的标准化
算子训练期对常量列算出 `std=0` 并存下（训练成功），推理期的校验器遇到 `std <= 0` 直接抛
——**校验器比生成器严格**，于是模型训出来了、上线才炸。规矩：`dump_fitted()` 与
`validate_fitted()` 的严格度必须对齐，且发布时对 `serving_json` 跑一遍完整的校验链。

### 7.4 形参 → 特征列的映射

`PREDICT` 在求值时只看得见**位置**（第 2 个实参、第 3 个实参……），看不见形参名。
所以绑定必须显式记下「第 i 个实参供给哪个特征」：

```jsonc
"param_map_json": [ {"param": "温度", "feature": "温度"},
                    {"param": "负荷", "feature": "负荷"} ]
```

**绑定流程**（`POST /modeling-bindings`，入参 `{fx_code, model_version_id}`）：

1. 读公式库条目，要求存在且启用；
2. 要求它的形参**全部是 `kind='column'`**（value 形参进不了特征矩阵）；
3. 要求形参个数 == `len(feature_keys)`；
4. **按位置**生成 `param_map_json`，并把形参名集合快照进 `param_names_snapshot`；
5. 回执把映射逐条列出来给人确认（`形参「温度」→ 特征「温度」`），界面上允许调整顺序后再确认。

**为什么按位置而不是按名字**：调用点写的是台账列名、形参名是公式条目上的标签、特征名是训练时
的列 key ——三者可以完全不同（同一个模型可能被两张台账用，两张表的列名不一样）。位置是唯一
在三者之间稳定的东西。名字只用于展示与二次确认。

**建公式条目的动作不属于本模块**：它在公式库页做（`dataset:manage`），本模块只做绑定
（`modeling:publish`）。两个码分属两个页面，各管各的一半。

### 7.5 对不上时怎么降级 —— 一格一个原因，不静默算空

| 情形 | 求值结果 | 用户看到 |
| --- | --- | --- |
| 该 code 没有绑定 | `AnalysisUnavailable` | 该格空 + `compute_error`「模型未绑定」 |
| 绑定被停用 | 同上 | 「模型绑定已停用」 |
| 模型版本不可服务 | 同上 | 「该模型版本不可上线：<原因>」 |
| 实参个数与特征数不符 | 同上 | 「模型需要 N 个实参，这里给了 M 个」 |
| 某个实参是空 | 走 `fill_missing` 的拟合值；没有填充步骤则该格空 | 「输入缺失且模型未配置填充」 |
| 公式条目被删（绑定成孤儿） | 同上 | 绑定列表页标 `orphaned` |

⚠ **绝不返回 0，也绝不静默返回空**。这一条是台账「降级要降得让人看得见」那条立论的延续：
用户看到一个毫无解释的空白格时，无从判断是数据没有、模型没接、还是算错了。

**孤儿绑定不做后台对账任务**：绑定列表每次拉取时校验一遍公式条目是否还在，不在就标
`orphaned=true`。这与台账那边「绝不要写任何发现对不上就从上游重拉的对账逻辑」同一口径。

### 7.6 哪些模型不可服务

| 原因 | 判定时机 | 界面提示 |
| --- | --- | --- |
| 流水线含 `SERVING_NEEDS_WINDOW=True` 的算子（滞后 / 滚动） | 发布时扫图 | 「滞后/滚动特征在单行预测时拿不到历史窗口，本流水线暂不可上线」 |
| 建模算子的 `SERVING_CHANNEL` 是 `binary`（树模型） | 发布时扫图 | 「树模型的拟合参数无法用纯 JSON 表达，暂不可上线」（下一轮开二进制通道） |
| `serving_json` 的校验链没走通 | 发布时实跑一遍 | 具体到哪一步、哪一列 |

不可服务的版本仍然可以看指标、做对比——只是发布按钮禁用并给出原因。

### 7.7 换绑版本要带影响面

`PATCH /modeling-bindings/{id}` 的回执必须带**影响面**：调台账的 `formula_usage` 反查
（真解析，含间接引用）拿到「哪些台账的哪些列引用了这条公式条目」，逐条列出，并给一句
「这些台账需要重算才会按新版本出数」。

**重算本身不在这里做**：用户拿着影响面去台账页发起重算。批量重算是 `dataset:backfill` 档位的
权限——大批量改写历史行且吃数据库，不该被 `modeling:publish` 顺带授予。

### 7.8 provider 的加载注意事项

⚠ **一次 `load` 里会混着不同模型的 code**，provider 必须自己按 code 分派。
⚠ **`deps.model` 是 `set`**，跨进程迭代顺序随 `PYTHONHASHSEED` 变化；按下标做缓存 / 日志 /
分片会踩坑。结果按 code 建键，与顺序无关。
⚠ **单行写 = 一次加载**：人工修正、逐行录入、撤销修正各触发一次重算，批量大小恒为 1。
所以 provider 的**每次固定开销**（查绑定的那次 SELECT）必须小，且版本内容必须走进程内缓存
（版本不可变，缓存无需失效机制）。

---

## 8. 前端

### 8.1 页面结构

| 路由 | 名称 | 版式 | 权限 |
| --- | --- | --- | --- |
| `/modeling` | 分析建模（流水线列表） | 常规宽度，卡片网格 | `modeling:view` |
| `/modeling/:id` | 建模画布 | 满屏 | `modeling:view` |
| `/modeling/:id?run_id=…` | 运行回看（同一组件，只读态） | 同上 | `modeling:view` |
| `/modeling/models` | 模型版本与绑定 | 满屏表格 | `modeling:view` |

目录形态按本仓约定：一个路由一个目录，主组件固定 `index.vue`，私有组件只放 `components/`
（只 `.vue`），脚本只放 `scripts/`（只 `.ts`，组合式函数与纯逻辑同一个文件夹），
页面根目录不许平铺 `.ts`。

```
web/app/src/pages/Modeling/
├── Pipelines/{index.vue, components/, scripts/}
├── Canvas/{index.vue, components/, scripts/}
└── Models/{index.vue, components/, scripts/}
```

左栏导航加一项，插在「数据台账」之后——读作「采 → 建模 → 定口径 → 加工 → 看」。
⚠ 导航项与 router 必须 **import 同一个常量对象**，重抄一份长得一样的字面量会让既有的
导航契约测试红（它用同一性断言，不是深比较）。

⚠ 图标：`DtIcon` 注册表当前 94 个名字里**没有** `workflow` / `flow` / `git-branch`。
要么新增一枚（改 `packages/ui/src/components/DtIcon/registry.ts`，图标契约测试会跟着盯），
要么复用 `network` / `route` / `layers`。**未登记的名字 `DtIcon` 静默不渲染**，
typecheck 与 lint 双双放行——这是本仓已经吃过的亏，只有契约测试拦得住。

### 8.2 画布：自绘，不引入图编辑框架

**沿用 [ADR-0028「2D 编辑画布自绘，不引入图编辑框架」](./adr/0028-2D编辑画布自绘而不引入图编辑框架.md)
的结论**，本模块另出一条 ADR 把它扩到流水线画布上（§11 第 0 期）。判据不是"要不要偷懒"，而是三条：

1. **`as unknown as` 在本仓是红灯**（`web/eslint.config.js` 的 `no-restricted-syntax`：
   「as unknown as 一律打回：它把两次类型检查一起关掉了」）。而 vue-flow 的自定义节点 /
   边组件拿到的是它自己的 `NodeProps` / `EdgeProps`，与自己声明的 props 对不齐，
   社区通行解法正是这个断言。绕开它只剩三条路：给每个自定义组件手写运行时适配层、
   换个说法继续绕过检查、或为一个可以不引入的依赖开一条 eslint 例外——三条都比自绘贵；
2. **本仓已经自绘过一块更难的画布**：2D 孪生编辑器的视口 / 选中 / 吸附 / 指针手势共 916 行，
   还带节点与连线。流水线画布比它简单——没有旋转手柄、没有图元树、没有周长参数端口、
   没有标注双层、没有图元级选中；
3. **不欠框架的版本账**：没有第二套坐标系、没有第二套选中模型，也不会因为框架升级而重新校
   一遍手势。

**自绘的量级**（拆成组合式函数，各自压在 200 行以内）：

| 文件 | 管什么 |
| --- | --- |
| `scripts/useCanvasViewport.ts` | 平移、缩放、屏幕↔画布坐标换算、适应视图 |
| `scripts/useCanvasPointer.ts` | 指针手势状态机：拖节点、框选、拖连线 |
| `scripts/useCanvasSelection.ts` | 选中集（单选 / 加选 / 框选） |
| `scripts/useCanvasWiring.ts` | 端口命中、连线预览、连接前置校验 |

节点用绝对定位的 HTML 卡片（要 `text-overflow`、渐变、阴影这些 HTML 能力），
连线用一层 SVG 画贝塞尔，两层按 z 序叠。

**节点卡片**：

- 左侧**每个输入端口一个具名接点**（`data-port` = 端口名），右侧每个输出端口一个。
  ⚠ 参考仓只有一对接点，多输入算子在 UI 上无法区分主表 / 副表，语义只能靠后端按边的
  落库顺序猜。我们的边带端口（D4），画布必须把这件事表达出来；
- 四态染色：待运行 / 运行中 / 成功 / 失败（卡片内嵌一行错误摘要）；
- 右上角**结果按钮只在该节点有结果时出现**，参数按钮常驻。
  左抽屉 = 输入（参数），右抽屉 = 输出（结果），空间隐喻与数据流方向一致——
  用户心智是「想看哪一步就点哪个方块」，零导航成本。

⚠ **运行态染色走 `provide/inject`，不进节点数据**：运行状态每秒换新，混进节点数组会让
拖拽中的位置被每秒重建的数组盖回去。

⚠ **节点 id 用 `getRandomValues` 拼，不用 `crypto.randomUUID`**——后者只在 secure context
存在，本项目是纯 HTTP 内网部署。

⚠ 自绘画布的四条自负责任（2D 孪生那块已经踩过，逐条照抄它的用例）：
一次手势只在 `pointerup` 提交一步撤销（逐帧提交的话撤销键再也按不回上一步）；
拖拽中卸载要补提交一次；把手与选中框按当前倍率反着缩回屏幕上的固定尺寸；
手势期间挂在 `window` 上的 `pointermove` / `pointerup` 与视口的 `ResizeObserver`
**卸载时必须摘掉**。

**连线校验在画布上就做**（连接前置判定）：契约不等 → 拒绝并给一句原因；成环 → 拒绝。
参考仓零前置校验，所有错误都要等运行时才知道，长流水线里一个笔误要跑到那一步才炸。

**保存前整图校验**：调 `POST /modeling-pipelines/{id}:validate`（与保存同一份实现），
问题逐条列出。**运行前自动静默保存，保存失败即中止运行**——杜绝「我改了参数但跑的是旧图」。

### 8.3 参数表单：schema 驱动

用 `config_schema`（pydantic 生成的标准 JSON Schema）→ 控件映射：
`title` → 标签、`description` → `DtHelpTip`、`enum` → `DtSelect`、
`type:number` + `ge/le` → `DtNumberInput`、`type:boolean` → `DtSwitch`、
`items.enum` 数组 → 复选组、`x-dt-widget:"column"` → 列选择器（选项来自上游帧的列）、
`x-dt-widget:"table"` → 台账下拉、`x-dt-widget:"moment"` → 相对档 + 绝对时刻组合控件。

⚠ 参考仓的「schema 驱动」是**废设计**：后端有这个字段、一路透传到前端，但真实做法是 46 个
手写配置组件按 code 硬 switch（那行 import 被注释掉了，注释写着「保留在接口中以便未来扩展，
但当前未使用」）。加一个算子要改四个地方、两个 300+ 行的 switch。别照抄那 46 个文件。

⚠ **给算子参数补 `default` 会改变存量流水线的运行结果**（本仓在大屏模块 schema 上已经吃过
同一个亏）。所以：**保存时把 schema 的 default 物化进 `graph_json` 的 `config`**，
运行期不依赖 default 回填；算子参数的 default 变更等同于算子行为变更，必须升 `SPEC_VERSION`。

⚠ 不要与大屏组件那套 `configSchema` 复用同一个渲染器——两套 schema 的方言不同
（pydantic 的 `Optional[T]` 生成 `anyOf:[{T},{null}]`、`Literal` 生成 `enum`），
混用会在两边各埋一半的特例。

### 8.4 中间结果与可视化

右抽屉（可拖宽），按后端给的 **`kind` 显式派发**：

```
kind = "frame"   → 形状卡 + 列统计 + 分页表
kind = "model"   → 算法 / 超参 kv + 特征列表 + 可服务性徽标（不可服务时带原因）
kind = "metrics" → 指标网格（按阈值染色）+ 真实-预测散点 + 残差直方图 + 明细表
其它 / 未知       → 格式化 JSON（兜底，永不白屏）
```

### D21 · 结果视图按显式 `kind` 派发，不做结构嗅探

参考仓的派发是 duck typing：只要某个字段不是字符串就静默掉进 JSON 视图；后端改一个拼写、
或指标里那几个白名单键一个都没有，视图就悄悄降级，**且没有任何告警**。我们让后端在 preview
里直接给 `kind`，前端做 `Map<kind, Component>` 注册表 + 兜底。加算子只改注册表一项。

**每种结果都是三段式**：统计摘要卡（指标按阈值染色）→ 图 → 分页明细表。
第一屏永远是数字摘要而不是原始表格。

**图怎么画**：散点与直方图**手写 SVG**，不引 echarts。理由是本仓已有先例
（空调建模页的散点 / 误差直方图 / 按折条全部手写 SVG），且 echarts 只注册了折线，
首屏包体闸挡着；这两种图的画法都简单到不值得为它引一个图表库。折线若真需要，
用既有的 `DtLineChart`。⚠ 颜色一律走主题 token，**不写十六进制字面量**——参考仓的图表颜色
写死十六进制，与它自己的主题体系脱节，换主题不跟随。

**分页是服务端的**：preview 只有 200 行，超出部分明确显示「已截断」。参考仓把整个结果对象
塞进节点 data 再客户端切片，十万行直接把浏览器拖死。

### 8.5 运行历史与只读回看

运行历史做成画布页的一个抽屉（不单开页面）。点某次运行 → `?run_id=…`，同一组件进入只读态：
节点不可拖、不可连、参数只读，节点上挂那次运行的结果。**编辑与只读回看用同一个组件**——
这避免了维护第二个「运行详情页」。

进度至少给「第 3/8 个节点 · 已用 2m14s」。⚠ 参考仓**没有进度、没有日志、没有 ETA**：
一个 30 分钟的训练和一个卡死的节点在 UI 上完全一样。

⚠ **轮询必须防竞态**：切换 run / 快速点开另一条流水线时，先发的请求可能后到。
本仓已有一条硬规矩「可被快速切换触发的加载必须防竞态」，这里逐字适用。
⚠ **卸载必须清理定时器**，轮询用的 interval 与页面同生死。

### 8.6 组件与拆分纪律

- **写入口逐个包权限守卫**。⚠ 守卫组件的 prop 名写错会被当 fallthrough attribute 吞掉、
  门禁静默失效，而 `vue-tsc` 与 ESLint 都放行——本仓已有两条契约测试盯这一类，
  新页面要纳进去；
- 外壳槽名（顶栏动作）写错的现象是**顶栏内容整块消失**，打了桩的测试会照抄这个错还全绿。
  必须另写一个用真件的 shell 契约测试；
- **SFC ≤ 500 裸行、组合式函数 ≤ 200 行、props ≤ 10 个、模板嵌套 ≤ 6 层**（闸门数字）。
  画布页至少拆成 `useModelingGraph`（节点边 + 脏标记）、`useModelingRun`（轮询状态机）、
  `useModelingHistory`（撤销）、`useCanvasShortcuts` 四个组合式函数 + 一个薄页面壳。
  ⚠ 参考仓的画布页是一个 **1925 行的上帝组件**，且因为把回调挂在节点 data 上，
  同一段「剥回调 → 重绑回调」的闭包在文件里出现 5 次；
- **组件内禁 `new Date(` / `toLocale*`**，时间格式化集中在既有的 datetime 工具里；
- 后端数据的类型来自 openapi 生成，**禁 `as` 断言**。

**整套界面留在 `app/` 而不抽进 `packages/`**：判据是「有没有第二个宿主」——模型预测经公式
落到台账列，大屏绑那一列即可，大屏侧零改动，因此建模界面没有第二消费方。
schema 表单看着通用但方言与大屏配置不兼容，抽出去只会招来误用。

---

## 9. 权限与安全

### 9.1 权限码

新增权限组 `modeling: "分析建模"`，四个码：

| 码 | kind | 覆盖 |
| --- | --- | --- |
| `modeling:view` | view | 流水线 / 运行 / 节点结果 / 模型版本 / 绑定 的全部读面，含算子目录 |
| `modeling:manage` | manage | 建 / 改 / 删流水线，校验、导出、导入 |
| `modeling:run` | operate | 发起 / 取消运行 |
| `modeling:publish` | manage | 发布模型版本、建 / 改 / 删绑定、换绑版本 |

按「有没有人会只给其中一半」逐对检查：

- view / manage：会——只读分析师看得见图与结果，但不能改；
- manage / run：会——生产环境上允许配图、但不允许在业务高峰跑一个吃满 CPU 的训练；
- run / publish：**必须分**——能跑实验 ≠ 能把模型接进生产台账。`publish` 的爆炸半径是
  「所有引用该公式条目的台账列的数值全变」，与 `formula:manage` 同一量级。

内置角色从目录**机械推导**（admin = 全量、viewer = 全部 `kind=='view'`），新增码自动被跟上。

### 9.2 闸 1 路由规则

在 `auth-server` 的 `catalog/` 里新增 `rules_modeling.py`（`rules_platform.py` 已 400 行，
再塞进去会顶模块行数上限），照 `_FORMULA_RULES` 的阶梯形状，优先级取 **981 / 983 / 985 / 987**
（当前未被占用；必须压过 900 那几条按方法兜底的规则——`{_PLATFORM}/*` 的 `*` **跨斜杠**，
不压过去就成了拿别的码来删流水线）：

```
981  {_PLATFORM}/modeling-*            *                 modeling:manage   写兜底
983  {_PLATFORM}/modeling-*            GET               modeling:view     读（必须压过写兜底）
985  {_PLATFORM}/modeling-pipelines*:run   POST          modeling:run      发起运行
985  {_PLATFORM}/modeling-runs*:cancel     POST          modeling:run      取消运行
987  {_PLATFORM}/modeling-model-versions*  POST|DELETE   modeling:publish  发布 / 退役
987  {_PLATFORM}/modeling-bindings*        *             modeling:publish  绑定写
```

⚠ 更具体的路径要更高优先级，否则被通配规则先命中。既有的两条契约测试会验证
「每条受闸 2 保护的路由都有闸 1 规则」且「闸 1 码 ⊆ 闸 2 码」。
⚠ **改完权限目录必须重跑一次 auth 种子**，否则前端看得到码、后端不认——本仓已有明确记录的坑。

### 9.3 算子参数不得允许任意代码执行 —— 九道防线

这是本设计的**头号安全命题**，因为参考仓在这里是全开的：它有两个「跑用户 Python」的算子，
外加一个让大模型写代码、用户粘进算子的闭环。即便配了 AST 沙箱，那也只是把任意代码执行变成
「需要绕过一道名单」。

**① 不提供任意代码算子。** 写进非目标，且是**永久**不做。配套一条测试：注册表里不许出现
code 含 `custom` / `code` / `script` / `eval` / `exec` 的算子。这条看着像形式主义，
它的作用是让「加一个自定义代码算子」在 CI 上撞一次墙，逼人来读这一节。

**② 算子参数的类型闭合。** `CONFIG_MODEL` 的字段类型只允许
`bool` / `int` / `float` / `str`（语义是标签或列 key）/ `Literal[...]` / `list[上述之一]` /
`dict[str, 上述之一]`。契约测试**逐算子扫描字段类型**，出现自由文本且语义是
「表达式 / 代码 / 模块名 / 文件路径 / URL」的一律红。将来的 `filter_rows` 条件因此是
**闭合的三元组**（`column` + `op ∈ Literal[...]` + `value`），不是一段表达式串。

**③ 算子按 code 从注册表取，永不从请求取类名。** 注册表是代码里的显式登记清单。
请求里给一个不认识的 code → 400。**全模块不出现 `importlib` / `__import__` /
`getattr(module, 用户输入)`**（源码扫描锁死）。

**④ 不复用、不新建任何表达式求值器。** 将来若要「用表达式造派生列」，走的是台账公式引擎的
白名单 AST，而不是在算子里另开一个。现在就写死，避免以后有人图省事塞个 `eval`。

**⑤ 列 key 不进 SQL、不进任何字符串拼接。** 取数走参数化查询，列投影在 Python 侧按当前列
定义拿到的白名单做集合判定。请求里的列 key 只用于「在不在这个集合里」。

**⑥ 不接受任何二进制上传。** 没有模型导入、没有数据集上传。导入件只收纯 JSON 的流水线导出件，
走 schema 校验 + 算子 code 白名单 + 完整图校验，与手工搭图**同一条闸**。
发布 / 导入端点**没有任何 `UploadFile` 形参**（源码扫描锁死）。

**⑦ 产物路径不取用户输入**（本轮不落产物文件，这条为下一轮预先写死）。

**⑧ 子进程不是沙箱。** 它防的是资源与崩溃，不防恶意代码。

**⑨ 将来的 AI 生成图与手搭图走同一条校验闸。**

### 9.4 其它

- **取数的权限口径**：流水线读台账数据，最低要 `dataset:view`。本轮只要 `modeling:run`
  ——因为数据不出系统（preview 有上限、无原始数据下载）。**将来加了「导出全量帧」那个端点，
  必须同时要求 `dataset:record:export`**。这条现在写下来，免得到时候忘了；
- 结果 preview 里含台账原始数据（前 200 行），所以 `modeling:view` 实质上包含了对该台账部分
  数据的读权限。**这是有意的**（不然中间结果没法看），要在权限描述文案里写明白；
- 运行是 CPU 密集操作，`modeling:run` 天然是一道限流闸；同一流水线不并发由 D17 保证。

---

## 10. 测试策略

按本仓的四层分层与覆盖率门槛（整体行 ≥ 80% / 分支 ≥ 75%，增量行 ≥ 85%，零容忍 flaky，
CI 不重试）。

### 10.1 分层测什么

| 层 | 测什么 | 怎么测 |
| --- | --- | --- |
| 单元 · 算子 | 每个算子给固定帧，断言输出帧 / 指标；`REQUIRES_FIT` 的另测训练与推理两种模式 | 零 DB、零 fixture。这是刻意的红利——与台账求值器纯同步是同一个理由 |
| 单元 · 图校验 | 环 / 端口不存在 / 契约不匹配 / 必填参数缺失 / 孤立节点 / 列不在上游帧 / 目标列缺失 / 带拟合算子下游多个切分 | 逐条一个用例，每条断言**错误消息里有中文人话** |
| 单元 · 取数 | `ts` 非唯一、已删列残值、脏类型、`truncated` 如实上报、空表 | 假件返回构造好的行 |
| 单元 · 执行引擎 | 状态机全部迁移、取消在节点边界生效、超时换池、失败即停 + 下游 `skipped`、节点记录逐条落库 | 假算子（sleep / raise）+ 假进程池 |
| 单元 · preview | 大帧被截断、行/列两个截断位各自为真、字节上限逐级降档、运行级总上限 | 构造 10 万行 × 200 列 |
| 单元 · 发布 | `servable` 判定各条、`serving_json` 往返 | |
| 单元 · provider | 未绑定 → 原因；实参个数不符 → 原因；一次加载混多模型能正确分派；**推理路径零 IO** | 无 DB fixture |
| 集成 | 端点行为、权限、事务边界、保留期 | 真 Postgres（本仓已有 `requires_postgres` 标记与起真库的配方） |
| 契约 | 见 10.2 | |
| E2E | 一条最小流水线跑到底并出模型版本 | 夜间闸 |

### 10.2 契约测试锁死什么

**既有的自动覆盖**（新代码进来就生效）：路由权限契约、分层契约、权限码存在性、
闸 1 ⊆ 闸 2、导航与 router 的同一性、图标名登记、`openapi.json` 与代码一致、
运行参数不许赋给模块级变量。

**本模块新增的**（每一条都对应上文一个被点名的翻车点）：

| 用例 | 锁什么 |
| --- | --- |
| `算子清单与显式名单一致` | 注册表 key 集合 == 一份写死的清单（防重名静默覆盖、防漏登记） |
| `重复算子码抛错而非覆盖` | 参考仓是 warning 后覆盖，打错 id 会悄悄顶掉别的算子且 CI 全绿 |
| `算子目录必须吐端口` | 每个算子 `spec()` 的 `inputs`/`outputs` 端口名唯一，`config_schema` 非空 |
| `枚举字段必须是 Literal` | 扫描「description 里列了取值集合却是裸 `str`」的字段 |
| `算子参数类型在白名单内` | §9.3 ② |
| `算子码不含代码执行意味的词` | §9.3 ① |
| `全模块无 eval/exec/importlib/UploadFile` | §9.3 ③⑥ |
| `拟合参数按列 key 建键` | 每个 `REQUIRES_FIT` 算子的 `dump_fitted()` 无整数键（参考仓最严重的静默错误） |
| `拟合参数往返` | `load_fitted(dump_fitted())` 必须成功；含常量列的场景（参考仓校验器比生成器严格） |
| `preview 有硬上限` | 超大帧的 `preview_json` 序列化后 ≤ 上限 |
| `边必须带端口` | `graph_json` 里缺端口的边 → 400 |
| `上下文键不使用 alias` | 源码扫描：执行引擎里不出现 `alias` 做键 |
| `历史运行读快照而非当前图` | 改图后回看旧运行，参数仍是旧的 |
| `不可服务的版本不能绑定` | 各条判定一个用例 |
| `provider 按 code 分派` | 一次加载混两个模型，各自结果正确 |
| `provider 推理路径零 IO` | 求值路径不出现 httpx / open / session |
| `导入件不含二进制` | 导入端点拒绝非 JSON |
| `provider 在 api 与 worker 两个角色都注册` | 装配点名单（参考仓这条缝从没接通） |
| `一条流水线只能有一次在途运行` | 真库并发插入 → 第二次 409 |

前端另加：外壳槽名的真件契约、结果视图 `kind` 派发表逐条断言、满屏版式契约。

### 10.3 不测什么

- 不测 sklearn 本身的数值正确性（那是上游的事），只测「我们传给它的东西对不对」与
  「它的输出被正确搬进 `serving_json`」；
- 不做「训一个真模型再预测」跑在 CI 上（慢且不稳），改成**用固定随机种子 + 20 行数据造
  `y = 2×温度 + 3×负荷 + 5`，断言学出来的系数与手算一致**——「跑完没报错」不等于「算对了」；
- 不测画布的像素级布局（happy-dom 不做布局计算，测不出来）。

---

## 11. 分期实施计划

每期可独立交付、独立验收，每期一个 PR（≤400 行、只碰一个服务；锁文件单独成 PR）。

### 第 0 期 · 铺路（两个独立小 PR）

1. 一条 ADR：**流水线画布沿用 ADR-0028 的自绘结论**，把判据与本模块的差异写清楚
   （编号取当前未占用的下一个，⚠ 另有会话正在占号，开写前先看一眼 `docs/adr/`）；
2. `DtIcon` 注册表补一枚 `workflow` 图标（或确定复用 `network` / `route` / `layers`）。

**本轮不新增任何前后端依赖**：numpy 与 scikit-learn 已在 platform-server 里，
前端画布自绘。

### 第 1 期 · 地基与最小闭环（后端，同步执行）

**范围**：app 骨架六件套 → 5 张表 + 迁移（新建表，索引随建表一起下，无回填）→
`permissions.py` + auth 权限码与闸 1 规则 → 算子基类 / 注册表 / `spec()` → 图校验 →
**同步执行**（先不接队列、不接进程池，行数上限调低）→ 运行 + 节点记录落库 + preview →
六个 P0 算子。

**验收**：建图 → 跑通线性回归 → 每个节点都能看到 preview；端到端用例用
`能耗 = 2×温度 + 3×负荷 + 5` 造数并**逐个系数手算核对**；四组既有契约测试全绿。

### 第 2 期 · 执行引擎硬化

**范围**：Redis Stream 队列 + worker 消费循环 + 进程池（照 `ac_model_worker`）→
`cancelling` 中间态与取消旗标 → 可配超时 + 超时换池 → 失败即停 + 下游 `skipped` →
运行参数组 `modeling` → 保留期清理循环 → 心跳与「执行中断」判定。

**验收**：`POST …:run` 立刻 202；取消在两秒内落终态；worker 重启后在途运行落 `failed`
且索引放开；同一流水线并发发起第二次得 409。

### 第 3 期 · 与台账公式对接（**这一期是本轮的重点**）

**范围**：台账侧七处改动（§7.2）→ 模型版本发布 + `servable` 判定 → `serving.py`
（serving_json → 纯计算 predict）→ `ModelingAnalysisProvider` + 两个角色的装配 →
绑定表与绑定流程 → 换绑回执带影响面。

**验收**：
- 公式库建一条 `PREDICT('能耗预测', {温度}, {负荷})`，台账列写 `@能耗预测(...)`，重算后出数；
- 拔掉绑定 → 该列变空 + `compute_error` 是「模型未绑定」而不是空白；
- 实参个数不符 → 该列变空 + 一句人话；
- 不可服务的版本发布按钮禁用且给出原因；
- 求值路径零 IO 的契约测试绿。

### 第 4 期 · 前端建模页

**范围**：路由 + 导航 + 权限 → 列表页 → 自绘画布（四个组合式函数、具名接点、连线前置校验）→
算子面板 → schema 驱动参数表单 → 节点四态 → 结果右抽屉（`kind` 派发 + 三段式）→
运行历史抽屉 + `?run_id=` 只读回看 → 1 秒轮询进度 → 模型版本与绑定页。

**验收**：完整流程可视化搭建并跑通，每个节点点得开中间结果；前端三件套全绿
（typecheck 0 错 / lint `--max-warnings=0` / 测试）+ `pnpm build` 通过。

### 第 5 期（下一轮）· 扩容

算子扩容（§5.5 的候选表）、树模型的二进制通道（照 `ac_model_artifacts` 的四条护栏）、
流水线导出 / 导入、全量帧落盘与下载、AI 自动建模草稿端点。

---

## 12. 从参考仓继承什么、反着做什么

> 上文各节已就地标注，这里汇总成一张表便于评审时逐条对照。
>
> ⚠ **先说一条边界**：参考仓的 `apps/modeling` 只落地了流水线 CRUD、图校验、执行引擎、
> 算子体系与保留期。**模型版本发布、公式绑定、`AnalysisProvider`、导出导入这四块它一行代码
> 都没有**——5 张表建了 5 张，代码只用了 3 张；`register_provider` 在它的生产代码里一次都
> 没被调用过（恰好与它自己列为翻车点的第 26 条同款状态）。所以本文档 §6（模型版本）与
> §7（台账接缝）**不是迁移，是原创设计**，参考仓在那两处只有文字口径可参考、没有可抄的实现。

**原样继承（那仓少有的干净设计）**：

| 项 | 为什么值得抄 |
| --- | --- |
| 一个算子类承担训练 / 推理两种语义（`REQUIRES_FIT` / `ENABLED_IN_SERVING`） | 用一份代码同时承担两种模式，杜绝训练 / 线上特征漂移。这是那仓最有价值的一条 |
| 运行时冻结整份图快照 | 成本极低（一次 JSONB 写），收益是整个复盘与可审计性 |
| 切分算子产出的 `feature_keys` 就是模型对外输入契约 | 用户只需提供原始特征，派生特征由管线自己造 |
| 编辑与只读回看用同一个组件 | 避免维护第二个「运行详情页」 |
| 结果三段式（摘要卡 → 图 → 明细表） | 对工业用户很对味，第一屏永远是数字摘要 |

**必须反着做**：

| # | 参考仓的做法 | 后果 | 我们怎么做 |
| --- | --- | --- | --- |
| 1 | 边**没有端口列**，连线靠端口名字符串巧合 | 两个上游产出同名端口时用户无法表达意图 | D4：边必须带端口（最贵的一处返工，从第一天就带） |
| 2 | `alias` 无唯一约束却当上下文主键 | 同名 alias 静默覆盖上游输出，下游拿错数据且无报错 | D5：只用 `node.id` |
| 3 | 结果文件每节点整份重写、存完整行矩阵 | O(N²) 写入，单次运行几个 GB；详情接口整包进内存 | D19：preview 有硬上限 + 按节点懒加载 |
| 4 | 标准化的拟合参数**按列索引建键** | 训练期与推理期列序不同 → **无异常、无告警的错误预测** | §5.2：一律按列 key + `expected_input_columns` 断言 |
| 5 | `validate_fitted` 比 `dump_fitted` 严格 | 模型训出来了，上线才炸 | §7.3：两侧严格度对齐 + 往返契约测试 |
| 6 | 端口类型两层皮（枚举 + contract 字符串） | 枚举形同虚设还要重复声明 | D11：只保留 contract |
| 7 | 连线校验函数写了但**全仓零调用** | 端口约束从未生效 | 图校验在**保存期**跑，且与导入、前端同一份实现 |
| 8 | `spec()` 的端口**从不出 API** | 前端画布拿不到端口，只能自己硬编码一份 | D15：目录吐完整 spec |
| 9 | `spec()` 传复数 kwarg 而模型声明单数，pydantic 静默吞 | 连线约束永远是空列表 | 出入参模型一律 `extra="forbid"` |
| 10 | 整条流水线跑在 HTTP 协程里 | 客户端断连 = 运行中断；DB 会话跨整个运行期持有 | D16：worker + 队列 |
| 11 | 声称 SSE 实则裸 NDJSON（无 `data:` 前缀） | 浏览器原生 `EventSource` 收不到 | 不做流，做轮询（D23） |
| 12 | 取消把 DB 状态**立刻**写成终态并兼作旗标 | 「显示已取消、其实还在跑」的窗口 | §6.2 加 `cancelling` 中间态 |
| 13 | 超时硬编码 300 秒且不可配 | 长训练必然踩线 | 运行参数（§6.6） |
| 14 | **没有节点级状态表**，进度只活在事件流里 | 刷新页面即失，拿不到 traceback | D7 |
| 15 | 产物**永不清理** | 磁盘无限增长 | §6.5 保留期 |
| 16 | 模型产物里**没有** `format_version`、依赖版本、数据指纹 | 升级 sklearn 后老部署能不能加载全靠运气 | `fingerprint_json` |
| 17 | 模型版本号是秒级时间戳 | 同秒两次运行唯一键冲突 | 按流水线自增 |
| 18 | 训得出来服务不了的模型，推理时 warning 一句就跳过 | 上线一个永远返回空的模型 | D9：`servable` 显式、可测、界面可见 |
| 19 | 滞后特征推理时用请求内数据重算 | 行数不足结果就错且不报错 | §7.6：窗口算子让整条流水线不可服务 |
| 20 | 三个自定义代码算子 + 生成代码闭环 | 任意代码执行面 | §9.3 九道防线，**永久**不做 |
| 21 | 缺 optuna 时贝叶斯搜索**静默降级**成随机搜索 | 用户看不出来 | 依赖显式声明，缺依赖启动即失败 |
| 22 | 参数 schema 是废设计，实为 46 个手写表单 | 加算子要改四个地方 | §8.3：真的 schema 驱动 |
| 23 | 结果视图靠结构嗅探派发 | 后端改拼写就静默降级，无告警 | D21：后端给 `kind`，前端注册表派发 |
| 24 | 全量结果进内存 + 纯客户端分页 | 十万行拖死浏览器 | §8.4：preview 200 行 |
| 25 | 画布页是 1925 行上帝组件 | 无法维护 | §8.6：四个组合式函数 + 薄壳 |
| 26 | provider 注册在生产代码里**一次都没被调用** | 整条通道端到端可跑、有测试，但从没接过真模型 | §3.2：装配点由契约测试的名单锁死 |
| 27 | 注释里大量「新增：…」变更史 | 与本仓注释规范冲突 | 抄逻辑不抄注释 |

**参考仓有、我们不抄的一整块**：它的数据源是 CSV / HTTP，没有台账那套「修正优先 / 空值不
填 0 / `ts` 非唯一 / 已删列残值」。照抄取数逻辑会拿到原值而非修正值、会长出幽灵列、
会静默丢行（§3.3）。

---

## 13. 不确定项（诚实标注，不编）

**13.1 台账真实数据量级未实测。** `MAX_SOURCE_ROWS = 200000` 是照台账
`MAX_RECOMPUTE_ROWS` 拍的，第 2 期要用真实表压一次并回填这个默认值。

**13.2 `PREDICT` 的求值开销没量过。** 纯 Python 的逐行点乘在几十万行上**应该**够快，
但没有实测数。第 3 期要用 20 万行 × 3 个模型压一次；不够就把 provider 的 `predict` 换成
「整批向量化」——那需要给求值器加一条批量相位，是一次不小的改动，要走 ADR。

**13.3 自绘画布的真实行数没量。** 按 2D 孪生那块（视口 / 选中 / 吸附 / 指针手势 916 行）
折算，流水线画布应当更少（没有旋转、图元树、周长参数端口、标注双层、图元级选中），
但没有实测。第 4 期开工前先把 `useCanvasViewport` + `useCanvasPointer` 两个先写出来量一次；
若单文件顶到 200 行的组合式上限，就再拆一层，**不要**把它变成一个 500 行的大文件。

**13.4 时间特征与业务时区的边界情形没穷举。** 台账的桶对齐在业务时区做，建模侧的时间特征
也必须用同一个时区，但夏令时、跨年边界这些没有逐个验证（本轮 P0 算子里没有时间特征，
这条在扩容期才生效）。

**13.5 建模页的首屏包体增量没量。** 页面走路由级懒加载，理论上不进首屏 chunk，
但没有实测。第 4 期跑一次 `pnpm build` + 包体闸确认。

**13.6 「可扩展性」的验收标准**：本文认为「加一个算子 = 加一个类 + 清单里加一行」。
第 5 期加第一个新算子时，如果实际还要改引擎 / 前端 / 数据库任何一处，说明本设计漏了一个
抽象，要回来改这份文档。

---

## 附录 A · REST 面

前缀 `/api/v1/platform`。信封、分页、时间、错误码口径全部照
[`agents/api-contract.md`](./agents/api-contract.md)，本附录只列形状。
错误码领域号 **14**（`41401` 起客户端错、`51401` 起服务端错）。

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/modeling-operators` | `modeling:view` | 算子目录，**完整 spec**（含端口与 config_schema）。现取不落库 |
| GET | `/modeling-pipelines` | `modeling:view` | 流水线列表。**页码分页**（有限管理集合） |
| POST | `/modeling-pipelines` | `modeling:manage` | 建流水线 |
| GET | `/modeling-pipelines/{id}` | `modeling:view` | 详情，含 `graph_json` |
| PATCH | `/modeling-pipelines/{id}` | `modeling:manage` | 整体保存图（`code` 不可改） |
| DELETE | `/modeling-pipelines/{id}` | `modeling:manage` | 删。有模型版本时 409 |
| POST | `/modeling-pipelines/{id}:validate` | `modeling:manage` | 图校验，返回问题清单（**与保存同一份实现**） |
| POST | `/modeling-pipelines/{id}:run` | `modeling:run` | 发起运行，202 返回 `{run_id}`。已有在途运行 409 |
| GET | `/modeling-pipelines/{id}:export` | `modeling:manage` | 导出件（纯 JSON） |
| POST | `/modeling-pipelines:import` | `modeling:manage` | 导入（只收 JSON 体，**无文件形参**） |
| GET | `/modeling-runs` | `modeling:view` | 运行列表，`?pipeline_id=`。**游标分页**（追加型、量大） |
| GET | `/modeling-runs/{id}` | `modeling:view` | 运行详情 + 节点状态列表（**不含 preview**）。前端 1 秒轮询它 |
| GET | `/modeling-runs/{id}/nodes/{node_id}` | `modeling:view` | 单节点，**含 preview**。读不到 404 + 明确 message |
| POST | `/modeling-runs/{id}:cancel` | `modeling:run` | 置取消旗标，状态转 `cancelling` |
| GET | `/modeling-model-versions` | `modeling:view` | 版本列表，`?pipeline_id=`。页码分页 |
| POST | `/modeling-model-versions` | `modeling:publish` | 从一次成功运行发布一个版本，入参 `{run_id, name, description}` |
| GET | `/modeling-model-versions/{id}` | `modeling:view` | 详情（含指标、指纹、可服务性与原因） |
| DELETE | `/modeling-model-versions/{id}` | `modeling:publish` | 退役。有绑定时 409 |
| GET | `/modeling-bindings` | `modeling:view` | 绑定列表，逐条带 `orphaned` / `stale` 标志 |
| POST | `/modeling-bindings` | `modeling:publish` | 建绑定，入参 `{fx_code, model_version_id}`，回执列出形参映射 |
| PATCH | `/modeling-bindings/{id}` | `modeling:publish` | 换版本 / 调映射 / 启停。**回执带影响面** |
| DELETE | `/modeling-bindings/{id}` | `modeling:publish` | 删绑定 |

⚠ 静态段必须排在 `/{id}` 之前，否则 `import` 会被当成一个 id。
⚠ `openapi.json` 提交进仓、CI 校验一致，前端类型由它生成——加端点必须重新导出。

---

## 附录 B · 新增一个算子的完整清单

这是「可扩展性」这条诉求的可验收形式。加一个算子要动的地方**只有这些**：

1. 在 `operators/<类别>.py` 里写一个类：类变量 + `CONFIG_MODEL` + `run()`
   （带拟合的再加 `dump_fitted` / `load_fitted` / `validate_fitted`）；
2. 在 `operators/__init__.py` 的显式清单里加一行 import；
3. 在算子清单契约测试的写死名单里加一行；
4. 给它写单元测试（固定帧进、断言输出帧出；带拟合的另测两种模式）。

**不需要**动：执行引擎、图校验、preview 生成、REST 端点、数据库、前端表单渲染器、前端画布。
如果实际动了其中任何一处，说明本设计漏了一个抽象——回到 §13.6。
