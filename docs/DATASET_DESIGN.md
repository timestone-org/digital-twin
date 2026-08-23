# 数据台账（代码标识 dataset）—— 设计与接口契约

> 权威设计文档，开发前必读。涉及 **platform-server**（`apps/dataset`：4 张表 + 公式引擎 +
> 聚合采集器 + 回填 + 保留期清理 + REST）与 **web**（台账列表 / 详情三分区 / 公式编辑器 /
> 批量导入 / 趋势分析）两层。任何跨层契约变更先改本文档。
>
> 本文档描述的是**两层架构的第 2 层**。第 1 层「点位历史」见
> [COLLECT_DESIGN.md](./COLLECT_DESIGN.md)，两者的分工与边界在 §2。
>
> ⚠ **两个后台任务「已上线」不等于「在跑」**：聚合采集器要 `PLATFORM_DATASET_ENABLED=true`
> （默认 `false`），保留期清理要 `PLATFORM_DATASET_RETENTION_ENABLED=true`（默认 `false`）。
> 回填不受这两个开关影响——它是用户显式触发的一次性任务。
> 界面**不许写死**「未生效」，措辞一律由三个开关的**真实有效值**决定：写死会在运维打开开关
> 之后继续显示未生效，把「诚实」变成另一个方向的谎。
>
> ⚠ **`agg='delta'` 的口径是「跨桶：本桶末值 − 上一桶末值」，不是桶内 `last − first`**。
> 理由见 §4.4。

## 1. 背景与目标

### 1.1 三类点位历史解决不了的需求

系统里的时序数据只有一种来源——现场采集，落在 `collect.point_history`
（见 [COLLECT_DESIGN.md](./COLLECT_DESIGN.md)）。它解决的是「设备吐什么就存什么」，是**唯一原始
事实**，但它解决不了业务侧的三类需求：

1. **人工台账**：班次产量、巡检读数、化验结果——没有点位，只能人填；
2. **口径派生**：净水量 = 进水 − 出水、用电量 = 本次电表读数 − 上次读数、这一小时的平均温度
   ——要的不是「每次变化的原始值」，是按业务口径**折算到时间桶上**的数；
3. **自定义结构**：每个业务场景的字段各不相同，不可能预先建表。

### 1.2 定位：从点位历史聚合出来的业务派生层

```
一行台账 = 一个时间桶 × 三类列
            ├─ 点位汇总列（source=point）  ← 从 collect.point_history 按桶聚合，可人工修正
            ├─ 人工录入列（source=manual） ← 人填 / CSV 批量导入
            └─ 公式列    （source=formula）← 由前两类算出（同行 / 跨行 / 时间窗 / 全表 / 跨表）
```

**★ 数据台账不直连设备。** 这是第一条边界：

- 它**不订阅**任何驱动、**不进**采集运行时、**不读**实时快照、**不参与**采集热路径；
- 它唯一的上游是 **`collect.point_history`**；
- 采集侧的任何抖动都不会直接打到台账；反过来，台账挂掉也绝不影响采集与实时下发。

### 1.3 规模前提

台账是**低频派生层**——人工录入一天几条到几十条，聚合采集按周期出行（1 小时周期 = 24 行/天/表）。
单表年增行数通常在 **10⁴~10⁶ 量级**，比点位历史低 3~4 个数量级。存储与索引决策全部基于这个前提，
**不要照抄点位历史的参数**。

## 2. 与点位历史的关系

### 2.1 两层数据流

```
现场设备 ──驱动──→ 采集运行时 ──Redis Stream──→ 归档器 ──→ collect.point_history
                                                                    │
                        ┌───────────────────────────────────────────┘
                        │  ⚠ 跨 schema **只读**（ADR-0003 写独占读放行）
                        ▼
                 聚合采集器（platform worker）──→ platform.dataset_records
                                                        │
                                                  公式引擎重算
```

### 2.2 两层的差异

| | 点位历史（第 1 层） | 数据台账（第 2 层） |
|---|---|---|
| schema | `collect`（collector-server 写独占） | `platform`（platform-server 写独占） |
| 产生方式 | 变化驱动（deadband + 心跳） | **定时聚合**（每个周期一行） |
| 原子单位 | 一个测点的一次读数 | **一条记录**（整行） |
| 结构 | 固定六列宽表 | 用户自定义列，JSONB 宽行 |
| 可否人工改 | 否，是原始事实 | 是，且人工修正优先 |
| 日增行数 | 千万级 | 几十到几千 |
| 保留期 | 全局配置，默认 90 天 | **默认永久**，逐表可配 |

### 2.3 点位身份：`node_key`

⚠ **本仓的点位身份是 `node_key = {source_id}:{point_code}`**（`server/domain/timeseries/node_key.py`），
不是「服务器 + NodeId」那种协议寻址串。台账的点位汇总列绑的就是这个串，与大屏绑定、
点位历史读侧完全同一套口径。

`point_code` 是**身份**、`address` 是**配置**：换协议只改 address，台账列不必动。

### 2.4 可重新汇总的范围 = 点位历史的保留期

台账行一旦写出就是快照。**比点位历史保留期更早的桶重新汇总不出来**——原始样本已被清理，
重算只会得到一整段空行。界面必须明说这条边界（§7），回填也会据此 clamp（§14.3）。

## 3. 决策记录（已拍板）

### D1 台账行由**定时聚合**产生，不是变化驱动、也不是快照采样

一行 = 一个时间桶 = `collect_interval_ms` 这么宽的一段时间。桶内的 N 条点位历史按**逐列可配**的
口径（§4.4 八档）折成一个数。

**为什么不是读实时快照**：快照是「此刻的瞬时值」，采样点落在哪取决于 loop 什么时候醒，
两次运行算出的数不一样，且断连期间会把上一个陈值反复写进台账。聚合是**对一段时间的统计量**，
可重现、可回填、可解释。

### D2 行幂等：`row_id` 由桶身份派生，写入走 `ON CONFLICT DO UPDATE`

```
ROW_NAMESPACE = uuid5(NAMESPACE_URL, "https://digitaltwin.local/dataset/collect")   # 写成字面量定死
row_id        = uuid5(ROW_NAMESPACE, f"{table_id}|{桶起点.astimezone(UTC).isoformat()}|collect")
```

⚠ **改命名空间或构造式 = 主键漂移**：每个历史桶会再长出一行，全程不报错。ISO 串强制 UTC，
避免 `+08:00` 与 `Z` 两种写法算出两个 id。

### D3 空桶 → **NULL**，绝不填 0、绝不结转

桶内一条样本都没有，这一格就是空。三条规则：

1. **不填 0** —— 0 是一个断言（「这一小时用电为零」），而事实是「这一小时的用电量算不出来」；
2. **不结转（LOCF）** —— 把上一桶的值抄下来，会让断采期间的曲线看起来一切正常；
3. **`count` 也不例外** —— 桶里 0 条归档既可能是「值一直没变」也可能是「断连」，写 0 会把
   两者混成一句话。

推论：**整行全空的桶不写行**。

### D4 点位汇总列**允许人工修正，且修正优先**

修正值存在独立的 `overrides_json` 列里，**采集与重算绝不覆盖它**。取值口径：

```
effective(k) = overrides[k].v  若存在，否则 values[k]
```

这条口径**只有一份实现**（`services/effective.py`）。读路径——记录分页 / 最新值 / 序列 /
CSV 导出——一律走它，出参里的 `values` **已经是 effective**，前端不必也不该再叠一遍。

### D5 台账列绑点位时，**自动为该点位开启归档**

没开归档的点位不进 `collect.point_history`，绑了也永远是空列。这条自动化落在**后端**
（绑定时调采集面的服务）而不是前端——绕开界面直接调 API 建列的路径也必须拿到它。
调用方没有 `collect:manage` 时降级为提示，不阻断建列。

> ⚠ 这是与参考实现的一处**有意偏离**：那边这条自动化只在前端做，绕开界面就拿不到。

### D6 调度：向前算扫原始表，回填走连续聚合，每 tick 重算最近 2 桶

- 向前采集只读原始表——刚关闭的桶在连续聚合里**还没有**，不是慢是没有；
- 回填可以吃连续聚合的快路（§14.4）；
- 每 tick 额外重算最近 `RECOMPUTE_TAIL_BUCKETS` 个已关闭的桶，兜住迟到数据。

### D7 保留期：点位历史按全局配置，台账默认永久

`dataset_tables.retention_days` 为 `null` 即永久。夜间清理任务消费它（§15），**默认关**。

### D8 命名只改用户可见文案，代码标识一律不动

界面上叫「数据台账」，代码里一律 `dataset`，表名 `dataset_*`，权限码 `dataset:*`。

### D9 公式引擎留在 `apps/dataset/`，不进 `server/domain/`

[ADR-0004](./adr/0004-server分三层且domain承载领域共享包.md) 的入场券是「已有 ≥ 2 个**服务**真实消费」。
公式引擎目前只有 platform-server 一个代码单元消费（api 与 worker 是同一个代码单元的两个运行角色），
够不着这条线。将来报告模块若落在另一个服务里并复用它，再按 ADR-0004 搬家。

### D10 台账行是超表，且是 `platform` schema 里的第一张

周期可以配到 10 秒（3.15M 行/年/表），普通表在保留期清理时会退化成全表扫描。
timescaledb 扩展由 collector-server 的迁移在**同一个库**里装过，`CREATE EXTENSION IF NOT EXISTS`
幂等，platform 侧直接用。

## 4. 数据模型

### 4.1 为什么是 JSONB 宽行

三个候选：JSONB 宽行（采纳）/ 窄表 EAV / 运行时建真表。

决定性理由：**这个领域的原子单位是「一条记录」而不是「一个测点值」**——录入、编辑、修正、展示、
导出、审计全都是整行操作。「一个测点值」是第 1 层的原子单位，已经由 `collect.point_history`
窄表存好了；在第 2 层再拆一次，等于每次展示一行都要做一次 N 列自连接。

运行时 `CREATE TABLE` 被否决的理由更硬：用户改一次列结构就是一次 DDL，而 DDL 拿
ACCESS EXCLUSIVE 锁、不可回滚、且让「迁移是唯一的结构变更入口」这条纪律彻底失效。

### 4.2 四张表

全部在 `platform` schema，模型在 `apps/dataset/models/`。

#### `dataset_tables` —— 台账定义（普通表）

| 列 | 类型 | Null | 默认 | 含义 |
|---|---|---|---|---|
| `id` | `uuid` | NO | uuid7 | PK |
| `code` | `text` | NO | — | ASCII 标识，**全局唯一**；大屏绑定键 `ds:{code}:{列key}` 的前半段；**建后不可改** |
| `name` | `text` | NO | — | 展示名 |
| `description` | `text` | YES | — | |
| `collect_mode` | `text` | NO | `'manual'` | `manual`（仅人工录入）\| `aggregate`（按周期从点位历史聚合） |
| `collect_interval_ms` | `integer` | NO | `60000` | 台账周期 = 一行覆盖的桶宽；`[1000, 86_400_000]` |
| `retention_days` | `integer` | YES | NULL | NULL = 永久 |
| `last_collected_ts` | `timestamptz` | YES | NULL | **采集器水位** = 已算完的最后一个桶的起点 |
| `is_enabled` | `boolean` | NO | `true` | |
| `created_at` / `updated_at` | `timestamptz` | NO | `now()` | `TimestampMixin` |

约束：`uq_dataset_tables_code`、`length(code) BETWEEN 1 AND 64`、`length(name) > 0`、
`collect_mode IN (…)`、`collect_interval_ms BETWEEN 1000 AND 86400000`、
`retention_days IS NULL OR retention_days > 0`。

⚠ **`collect_interval_ms` 上界 1 天是已知限制而非设计意图**：周宽及以上的桶，PG 的 `time_bucket`
按 2000-01-03（周一）对齐、Python 侧按 2000-01-01 对齐，两者差 2 天且**不报错**。解除条件是
在真库上把整周桶宽的 origin 验一遍并让两侧对齐。

#### `dataset_columns` —— 列定义（普通表）

| 列 | 类型 | Null | 默认 | 含义 |
|---|---|---|---|---|
| `id` | `uuid` | NO | uuid7 | PK |
| `table_id` | `uuid` | NO | — | FK → `dataset_tables.id` **ON DELETE CASCADE** |
| `key` | `text` | NO | — | 公式里写作 `{key}`，也是 JSONB 字段名；`(table_id, key)` 唯一；**不可改** |
| `name` | `text` | NO | — | |
| `unit` | `text` | YES | — | |
| `decimals` | `integer` | YES | NULL | 展示小数位，NULL = 不限 |
| `data_type` | `text` | NO | `'number'` | `number` \| `string` \| `bool` |
| `source` | `text` | NO | `'manual'` | `manual` \| `point` \| `formula` |
| `agg` | `text` | NO | `'avg'` | 仅 `source=point` 有意义，八选一（§4.4） |
| `node_key` | `text` | YES | — | `source=point` 时绑的点位身份 `{source_id}:{point_code}`；**不建外键**（删点位不连坐台账历史） |
| `formula` | `text` | YES | — | 表达式原文，≤2000 字符 |
| `formula_deps` | `jsonb` | YES | — | 保存时解析出的依赖，避免每次求值重解析 |
| `order_index` | `integer` | NO | `0` | |
| `is_required` | `boolean` | NO | `false` | 仅对 manual 列有意义 |
| `default_value` | `jsonb` | YES | — | 录入表单默认值，存原值保类型 |
| `created_at` / `updated_at` | `timestamptz` | NO | `now()` | |

⚠ `key` 放行中文，但禁空格、引号、冒号、逗号、点号、括号——这些都是公式语法里的记号。

⚠ **`source` 取值是 `point` 不是 `opcua`**：本仓的采集是按驱动适配器分协议的
（[ADR-0011](./adr/0011-采集按驱动适配器分协议而采集计划保持协议无关.md)），列绑的是一个**点位**，
与它背后跑的是哪个协议无关。写死协议名会让「同一张台账里既有 OPC UA 点位又有 Modbus 点位」
这件本来天然成立的事看起来像是没做。

#### `dataset_records` —— 台账行（**超表**）

**PK `(table_id, ts, row_id)`，无代理主键。** 列序是刻意的：`table_id` 前缀定位表、
`ts` 有序支撑「取最后一条」（反扫一行）与时间窗扫描、`row_id` 补唯一。

| 列 | 类型 | Null | 含义 |
|---|---|---|---|
| `table_id` | `uuid` | NO | 对齐 `dataset_tables.id`，**不建外键**（超表上的外键拖慢每一次写入；删表由应用显式清行） |
| `ts` | `timestamptz` | NO | 桶起点；**分区列** |
| `row_id` | `uuid` | NO | 采集来源由 uuid5 派生（D2），人工/导入来源用 uuid7 |
| `values_json` | `jsonb` | **NO** | 原始值 `{列key: 值}`——人工录入或点位聚合结果。**公式重算绝不写这一列** |
| `overrides_json` | `jsonb` | YES | 人工修正 `{列key: {v, by, by_name, at, reason?}}`。**采集与重算绝不覆盖** |
| `computed_json` | `jsonb` | YES | 公式结果 |
| `compute_error` | `jsonb` | YES | 求值失败的列 `{列key: 错误文案}`，NULL = 全部成功 |
| `samples_json` | `jsonb` | YES | 各点位汇总列的桶内样本数 `{列key: n}` |
| `source` | `text` | NO | `manual` \| `collect` \| `import` |
| `created_by` | `text` | YES | 录入者用户 id |
| `created_by_name` | `text` | YES | 录入者用户名（**冗余存一份是刻意的**：账号可能被删） |
| `created_at` / `updated_at` | `timestamptz` | NO | |

超表参数：`chunk_time_interval => interval '7 days'`、`create_default_indexes => FALSE`、
`compress_segmentby = 'table_id'`（逐表删除退化成丢弃整段、零解压）、`compress_orderby = 'ts DESC'`、
`add_compression_policy(compress_after => interval '30 days')`。

**没有 retention policy**（台账默认永久，D7），删行走应用层夜间任务。
**只建主键，不建任何二级索引**——年增 10⁴~10⁶ 行，主键前缀已经够；等真到百万行再按实测加。

#### `dataset_formulas` —— 公式库（普通表）

跨台账的全局资源，详见 §5。

### 4.3 三条关键决策

**（a）原始值 / 计算值 / 人工修正，三者分列存。**
于是：改公式重算只覆盖 `computed_json`，采集只覆盖 `values_json` 里属于点位列的键，
人工修正独占 `overrides_json`。任何一方都不会把另一方的数据抹掉，
而「谁改的这一格」永远答得出来。

**（b）复合主键，无代理主键。** `ts` 是分区列，Timescale 要求它进每个唯一约束；
而这个键一物三用——幂等去重 / 主查询索引 / 分区约束。
**推论：改 `ts` 必须先删后插**，不能 `UPDATE`。

**（c）`samples_json` 不是可选的装饰。** 均值的可信度不在均值里：1 小时桶里 2 个样本的 avg
与 3600 个样本的 avg 在界面上长得一模一样。带上 `n`，前端才能把前者标灰；`n = 0` 也是排查
「这格怎么是空的」的第一手证据。

### 4.4 八档聚合口径

```
AGG_FUNCS = ("avg", "min", "max", "last", "first", "sum", "count", "delta")
```

| agg | 语义 | 备注 |
|---|---|---|
| `avg` | `avg(value_num)` | |
| `min` / `max` | `min/max(value_num)` | |
| `sum` | `sum(value_num)` | |
| `last` / `first` | 桶内最晚 / 最早的一条 | **数值优先，取不到再还原文本值**——非数值点位只有 `value_text` |
| `count` | `count(value_num)` | **永远 ≥1**：桶里一条都没有时压根没有这一行 |
| `delta` | **跨桶**：本桶末值 − 上一桶末值 | 见下 |

⚠ **平台侧已有的 `AGGREGATE_SQL` 白名单只有 5 档**（`apps/collect/schemas/history.py`），
那是点位历史读侧的对外契约。台账**自己出一份 8 档白名单**，不去改采集那份——两个消费者的
口径不该互相牵连。

#### `delta` 为什么是跨桶

第 1 层的归档是**变化驱动**的——点位值不变就不写一行。于是桶内 `last − first` 只覆盖了
「本桶第一个样本 → 本桶最后一个样本」，**漏掉了「上一桶最后一个样本 → 本桶第一个样本」
之间的增量**。对累计量计数器（电表、水表、产量累计）来说那段增量是真实发生的，漏掉就是
**系统性少算**：极端情况是一个桶里只有 1 个样本，`last − first = 0`——账面上「这一小时没用电」，
实际上用了一小时。

跨桶口径 `delta(t) = last(t) − last(t−1)` 让相邻桶首尾相接，把时间轴不重不漏地切开：
所有桶的 delta 之和恰好等于首末两个末值之差。

**三条边界规则，都是「不猜」**：

1. **取不到上一桶末值 → 这一格为空**，**绝不拿本桶的 `first` 顶替**。顶替等于无声地退化回
   旧口径，而且退化得毫无痕迹：界面上它和一个真实的 delta 长得一模一样。
2. **结果为负 → 这一格为空，且绝不写成 0**。负值意味着计数器清零 / 换表 / 上游改了量程，
   这一桶的真实增量**无从得知**。写 0 是在断言「这一桶没有增量」——与 D3 否决「空桶填 0」
   是同一条理由。
3. **中间的空桶不打断接力**：末值一直有效到下次变化为止。

`delta` 是八档里**唯一需要看桶外数据**的口径。减数查询必须有**回看窗口下界**：
`clamp(interval × 24, 6h, 2d)`。没有下界的话，稀疏点位会让 PG 沿 6 小时一个 chunk
一路摸到保留期尽头。

⚠ **文本点位配数值口径 → 那一格空、且不报错**（`value_num` 全 NULL，PG 聚合自然给 NULL）。
理由：它跑在 leader 的后台 loop 里，一列配错不该让整张表的采集永久中断。
但**未知的 `agg` 值直接抛错**——那是配置写坏了，不是数据的问题。

### 4.5 桶对齐：`time_bucket` **必须**带 timezone

```sql
time_bucket(CAST(:bucket_width AS interval), ts, timezone => :bucket_timezone)
```

不带它 `time_bucket` 按 UNIX 纪元对齐，东八区的日桶会从当地 08:00 开始，07:00 的数据落进前一天。
平台侧已有的 `build_aggregate_query`（`apps/collect/crud/history.py`）本来就是这么写的。

Python 侧的 `bucket_start()` 必须与它**同口径**：

```
origin = datetime(2000, 1, 1, tzinfo=ZoneInfo(tz))
bucket = origin + ((ts - origin) // interval) * interval
```

错开一格是静默写歪，不会有任何提示。

## 5. 公式引擎

> 本节随第 2 期补齐。参考实现在
> `../DigitalTwinBK/digitaltwin-server/apps/dataset/formula/` 与
> `../DigitalTwinBK/docs/DATASET_DESIGN.md` §5。

## 6. 接口契约

前缀 `P = /api/v1/platform`。信封 `{code,message,data,trace_id}`，权限见 §9。

```
P/dataset-tables                              GET  列表（?q=）   POST 新建
P/dataset-tables/{tid}                        GET  详情（含列）  PATCH 更新  DELETE 删除（?force=）
P/dataset-tables/{tid}/columns                GET  列表          POST 新增
P/dataset-tables/{tid}/columns:reorder        POST 整体重排
P/dataset-tables/{tid}/columns/{cid}          PATCH 更新         DELETE 删除（?force=）
P/dataset-tables/{tid}/records                GET  游标翻页      POST 录入
P/dataset-tables/{tid}/records/{rid}          PATCH 编辑（?ts=） DELETE 删除（?ts=）
P/dataset-tables/{tid}/records/{rid}/overrides PUT 写修正（?ts=） DELETE 撤销（?ts=）
P/dataset-tables/{tid}/overrides:clear        POST 按列批量撤销修正
P/dataset-tables/{tid}/records:import         POST 批量导入 CSV
P/dataset-tables/{tid}/latest                 GET  最后一条
P/dataset-tables/{tid}/series                 GET  序列（?keys=a,b）
P/dataset-tables/{tid}/template               GET  下载录入模板（CSV 正文，无信封）
P/dataset-tables/{tid}/export                 GET  导出 CSV（同上）
P/dataset-tables/{tid}/backfill               POST 起回填  GET 查进度  DELETE 取消
P/dataset-tables/{tid}:recompute              POST 重算公式列
P/dataset-tables/{tid}/formula-functions      GET  函数目录 + 库公式 + 可引用的列
P/dataset-tables/{tid}/formula:validate       POST 校验（语法 / 未知列 / 环）
P/dataset-tables/{tid}/formula:preview        POST 试算
P/dataset-recomputes                          POST 起批量重算
P/dataset-recomputes/{job_id}                 GET  查进度  DELETE 取消
P/formulas                                    GET  列表  POST 新建   （与 dataset-tables 平级）
P/formulas/{fid}                              GET  详情  PATCH 更新  DELETE 删除
P/formulas/{fid}/usages                       GET  引用反查
```

URL 形状受 `scripts/gates/check_api_contract.py` 管，三条会真的把人绊倒：

1. **末段带 `:` 的路径，全部方法必须是 POST**（`check_action_endpoints_are_post`）。
   所以「取最后一条」「取序列」「下模板」「导出」「引用反查」这些读操作**只能是子资源
   而不是动作端点**——写成 `GET …:latest` 会直接红。
2. **非参数段最多 3 个**（`MAX_RESOURCE_DEPTH + 1`）。`…/records/{rid}/overrides` 是
   `dataset-tables / records / overrides` 三段，卡在上限上，合规。
3. **只有第一段强制复数**，且每一段都要过 `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`。
   故 `template.csv` 这种带点的段不合法，扩展名靠 `Content-Type` 与
   `Content-Disposition` 表达，不进 URL。

### 6.1 五条口径

1. **时间一律 RFC3339 UTC 字符串**（`Utc` 别名 → `2026-08-23T10:00:00.000Z`）。
   > ⚠ 这是与参考实现的**有意偏离**：那边接口层用毫秒整数。本仓
   > [api-contract §6](./agents/api-contract.md) 要求 RFC3339，且 `Utc` 别名带
   > `WithJsonSchema` 保住 openapi 里的时间语义——换成裸整数，前端的契约测试就钉不住它了。

2. **`:series` 返回 `{列key: [{t, v}]}`**，与点位历史的序列接口**完全同形**，
   趋势页的渲染代码可原样复用。

3. **`formula:validate` 用 200 + `is_ok=false` 报告公式错误**，不是 HTTP 错误：
   编辑器里「公式还没写完」是正常状态，不是异常。

4. **编辑 / 删除记录务必带 `?ts=`**：`ts` 是分区键，带上直接命中 chunk，否则跨 chunk 扫描。

5. **记录列表走游标分页**（`CursorPage`），不是页码分页。
   > ⚠ 又一处**有意偏离**：参考实现用的是 `skip/limit/total`。
   > `dataset_records` 是持续写入的时序集合，页码分页会静默重复与漏行
   > （[api-contract §5.1](./agents/api-contract.md)）。前端配 `DtCursorPager` + `useCursorPages`。

### 6.2 截断口径

`:series` 与 `:export` **共用同一份窗口扫描实现**。两条规则：

- **触顶时留下的是最新的那批**（内层按 `ts` 倒序反扫取 `limit` 行，出参再排回升序）。
  时序图的默认预期是「看最近」；两个同形接口若一个给最新、一个给最早，合进同一个趋势页
  共用渲染时就会画出两种曲线。
- **触顶判定多查一行（`limit + 1`）**，而不是拿 `len(rows) == limit` 猜。恰好只有 `limit` 行时
  数据其实是完整的，猜法会把它误报成截断，用户于是被劝去缩小一个根本不需要缩的时间范围。

### 6.3 幂等

写动作走 `WriteContext.run_once(endpoint=…, model=…, action=…)`。
长任务（回填、批量重算、导入）**必须**支持 `Idempotency-Key`。

> ⚠ 参考实现没有幂等键，靠 `row_id` 派生 + `ON CONFLICT` 兜写值、靠 Redis 单飞锁兜长任务。
> 本仓 [api-contract §7](./agents/api-contract.md) 要求长任务显式支持幂等键，故两者都要。

## 7. 前端

### 7.1 路由

```
/datasets                    Dataset/Tables/index.vue        台账列表
/datasets/:tableId           Dataset/TableDetail/index.vue   详情（父级）
    ''      → 重定向到 columns
    columns   列配置   → TableDetail/components/ColumnsPanel.vue
    records   数据     → TableDetail/components/RecordsPanel.vue
    trend     趋势     → TableDetail/components/TrendPanel.vue
/formulas                    Dataset/Formulas/index.vue      公式库
/trend                       Trend/index.vue                 趋势分析（点位历史 / 台账两个数据源）
```

**三个分区是子路由，不是页内状态。** 本仓的页签组件 `AppTabNav` 每一项必须有 `to`——它是
`RouterLink` 不是按钮（`@dt/ui` 里没有 `DtTabs`）。这顺带修掉了参考实现的一个毛病：那边切页签
地址不变，于是刷新回到第一个页签、也发不出「看这一页」的链接。

⚠ 子路由**不重复写** `meta.permissions`：`to.meta` 是全部匹配记录的合并，父级那一条管住整棵子树，
两处各写一份反而会漂。
⚠ 带 `:tableId` 的路由**不进** `NAV_ITEMS`——那张表里每一项都要有静态路径，且由契约测试钉着。
返回列表靠 `AppShell` 的 `back-to`。

导航项与路由的权限码必须**逐字一致**，由 navItems 的契约测试钉死。`meta.permissions` 只放
**读码**（`dataset:view` / `formula:view`）；写码全部在页内逐个入口门控——把写码挂到路由上会
把只读账号整个挡在门外。

### 7.2 详情页持有唯一状态

详情页（父级）持有 `table` / `columns` / `records` 三份状态，三个分区组件**全部受控**：
只 emit 不自取数。于是「改了列 → 数据表格的列跟着变」这类联动只有一条数据流。

父级自己渲染的是**与页签无关**的那几块：身份条（code / 启用状态 / 只读标记 / 列数与行数）、
采集水位与可回填范围两行小字、回填任务卡。

⚠ **回填卡与「自动采集已推进到」刻意分成两块**，且回填卡末尾明写「回填只补历史行，不会推进水位」。
并排放会被读成「回填 = 采集」，而它们是两件独立的事。

### 7.3 「只读」的判据是一个写入口都没有

页面有五个互不蕴含的写码（`manage` / `record:write` / `record:export` / `override` / `backfill`）。
顶部那个「只读 · 当前账号仅可查看」标签的判据是**五个全都没有**。

⚠ 拿单个码判是错的：只有录入权限的人看到「只读 · 仅可查看」，会以为自己进错了账号。

用 `<PermGuard :codes="[…]" mode="any" explain>`——`explain` 只给页面级主动作开，行内小按钮不开：
每行挂一句「只读」是纯噪音，页面顶上那一句已经说清楚了。

### 7.4 两处「看得见但动不了」是有意的

- **回填进度条不挂权限码，取消按钮挂**。任务可能是别人起的；没有 `dataset:backfill` 的人
  该看得见进度，不该能把它掐掉。
- **「下游过期」的横幅所有人可见，「立即重算」按钮挂码**。过期是他改历史行造成的**事实**，
  得让他知道去找谁重算。

### 7.5 删除是两段式，第二段的文案由后端回执撑起来

前端先发一次不带 `force` 的删除。后端拿 409 回来，`data` 里带着**为什么不能删**：
删表带 `record_count`，删列带 `referenced_by`。前端据此把确认文案换成具体的那一句，
确认词从「删除」变成「仍然删除」，**弹窗不关**。

这比前端自己先查一次「有没有数据」好：前端查完到用户点确认之间，数据可能已经变了。

### 7.6 公式编辑器：一条路径，两种编辑面

公式**只有一条落库路径**——一行表达式文本。「分段」不是另一种存储，只是同一行文本的另一种编辑面：
分支编辑器把 `IF/IFS(...)` 拆成若干「当…取…」，改完再拼回同一行。拼接函数与后端的
`compose_branches` **逐字对齐**，保证拆开再拼回不会静默改写一条没动过的公式。

三条时序上的规矩，每一条都对应一个真实的静默故障：

1. **分支编辑面只在「切进去的那一刻」播种一次。** 分支模式每敲一个键都会重新校验，
   若每次响应都回来重新播种，正在打字的那个框光标会被重置。
2. **切回文本模式必须把选区重置到末尾。** 旧的选区下标指向的是另一个字符串，不重置的话
   下一次从工具箱点一个列名会**静默吃掉开头几个字符**。
3. **文本一变就立刻熄掉绿灯**（清 error / 读法 / 记号树，`validity` 发 `false`）。
   「改完了还亮着绿灯」是最骗人的一种状态。

校验**防抖 400ms**，且必须有竞态守卫——本仓只许用 `useRacedFetch`，不许手搓序号。

⚠ 校验端点用 **200 + `is_ok=false`** 报语法错，不是 HTTP 错误：编辑器里「还没写完」是正常状态。

### 7.7 数据表格的三层取值与两种标记

一格显示什么，按序判：

1. `compute_error[key]` 有值 → 红色「计算失败」，鼠标悬停出原因；
2. 否则取值：公式列读 `computed[key]`，其余读 `values[key]`。
   ⚠ **`values` 出参已经是 effective**（D4），前端**绝不再叠一次** `overrides[].v`；
3. 样本数标记：`samples[key]` 过小的格子标灰并加虚线下划线，悬停说明「这个数只由 n 个样本汇总而来」。
   `n = 0` 与「值为空」是两件事，文案必须分开：**「没有数据」不是「值是空的」**。

人工修正的角标只是**标记**，不参与取值。角标要区分两种来源：人改的（`pencil` + 主题色）与
数据迁移带进来的（`database` + 灰）——后者不是本期有人动过手，撤销的措辞也不同。

⚠ 表格里的悬停气泡**必须 `placement="bottom"`**：`DtTooltip` 是相对定位不是传送的，
第一行的向上气泡会被滚动容器的上边缘裁掉，于是失败原因**永远读不到**。

⚠ 撤销单格修正的确认文案里不能承诺撤销后会变成什么数——**自动值不在任何一个响应里**，
前端预览不出来。只能如实说「回落到自动采集值，显示的数字可能与现在不同；那个周期若没采到数据，
会变成空」。

### 7.8 批量撤销修正：默认范围不是「不限」

时间范围留空 = 不限，但**不限刻意不做默认值**：默认打开时填的是当前这页的最早与最晚时刻。
一次误点就抹掉三年的修正，而后端只回一个数字，看不出抹掉了什么。

列的预选也一样：默认只勾**这一页上真的有角标**的那几列——用户是冲着看得见的角标来的。

### 7.9 列表页与列表页之外

- **建表成功后直接跳详情页**：刚建的表没有列，留在列表上没有下一步。
- **搜索是纯客户端过滤**（表的数量是业务台账级别，几十张顶天）。
- **运行开关查不到时退回全关**，且**不把整页判成加载失败**——宁可多标一句「未生效」，
  也不能反过来承诺后台在采而实际没采。
- 开关的措辞一律由三个总开关的**真实有效值**决定，**不许写死**。

### 7.10 组件切分（本仓 SFC ≤300 行）

参考实现的 `detail.vue` 是 1076 行、`ColumnFormDialog.vue` 627 行、`RecordTable.vue` 560 行，
在本仓一律超限。切法：

```
Dataset/TableDetail/
├── index.vue                       壳 + 身份条 + 水位/范围两行 + AppTabNav + RouterView
├── components/
│   ├── BackfillCard.vue            回填任务卡（进度 / notes / 触顶警告）
│   ├── BackfillDialog.vue          发起回填
│   ├── ColumnsPanel.vue            列配置分区
│   ├── ColumnList.vue              列表格（DtDataView）
│   ├── ColumnFormDialog.vue        列表单（壳 + 三选一子块）
│   ├── ColumnSourceManual.vue      manual 子块
│   ├── ColumnSourcePoint.vue       point 子块（选点 + 聚合口径 + 归档状态机）
│   ├── ColumnSourceFormula.vue     formula 子块（挂 FormulaEditor）
│   ├── RecordsPanel.vue            数据分区
│   ├── RecordTable.vue             数据表格（DtDataView + 动态列）
│   ├── RecordFormDialog.vue        录入/编辑
│   ├── OverrideBulkDialog.vue      批量撤销修正
│   ├── ImportDialog.vue            CSV 导入三步
│   ├── TrendPanel.vue              趋势分区
│   ├── FormulaEditor.vue           公式编辑（两种面 + 校验 + 试算）
│   ├── FormulaToolbox.vue          可引用项 / 跨表 / 公式库 / 函数 / 运算符
│   ├── FormulaBranchEditor.vue     分段编辑面
│   └── FormulaNotation.vue         记号树（递归自引用）
└── scripts/
    ├── format.ts                   取值 / 格式化 / 徽标口径
    ├── formulaText.ts              插入与拼接的纯函数
    ├── useTableDetail.ts           表与列的状态
    ├── useRecords.ts               记录游标翻页
    ├── useBackfill.ts              发起 / 轮询 / 取消
    └── useFormulaValidation.ts     防抖 + 竞态的校验
```

⚠ **脚本只能放 `scripts/`（只 `.ts`），组件只能放 `components/`（只 `.vue`），
页面根目录除了 `index.vue` 什么都不许有**——参考实现把 `format.ts` 放在 `components/` 里，
在本仓是结构闸门错误。

### 7.11 列表一律走 `DtDataView`

`app/src/**/*.vue` 里出现 `<table` 是闸门错误。两张表的做法不同：

- **列配置表**列是静态的，常量命名 `COLUMNS`，每个 key 配一个 `#cell-<key>` 插槽——
  契约测试**双向**锁死（有列无槽、有槽无列都红）。
- **数据表**列由台账的列配置驱动，是动态的：computed 产出 `DtDataColumn[]`，单元格用
  **动态插槽名**。契约扫描器只认 `const [A-Z_]*COLUMNS` 形式的静态常量，扫不到动态表——
  这不是钻空子，是那条闸本来就只管静态列表；动态表的列⇄槽一致性**自己写一条用例钉**。

### 7.12 轮询与清理

| 什么 | 间隔 | 起 | 停 |
|---|---|---|---|
| 回填进度 | 3s | 提交后；**外加挂载时立刻拉一次**，好接上刷新页面之前起的任务 | 终态；取数失败（**静默，不弹吐司**——每 3 秒一个会糊满屏幕）；卸载 |
| 批量重算 | 1.5s | 起任务后且状态是 running | 非 running；取数失败（作业态只留一天，**保留最后一次进度不要清空**）；关弹窗；卸载 |

⚠ 定时器、监听、`ResizeObserver`、echarts 实例**必须在卸载时清掉**，这是闸门检查项。

### 7.13 降级：每一条都是「宁可说不知道，不许假装知道」

| 失败 | 表现 |
|---|---|
| 运行开关取不到 | 全关，说「未生效」，**不把整页判成加载失败** |
| 函数目录取不到 | 编辑器退化成纯文本域 + 后端校验，**不挡住页面** |
| 公式库里的表列不出来 | 只丢跨表引用，其余照常 |
| 分析 provider 列表为空 | 那是**正常状态**（AI 模块没接），不是错误 |
| 回填进度返回 `null` | 「没有任务」，不是「失败」；已有的终态不清掉 |
| 未知的聚合口径 | 显示原始代码 + 一句通用说明，**绝不隐藏这个选项** |
| 记号树节点不认识 | 渲染成 `?`，**绝不白屏** |
| 时间串解析不了 | 原样返回，**不显示成「—」**——「格式不认识」不该读成「没有值」 |

## 8. 批量导入（模板 → Excel → 回传）

### 8.1 真正的风险在 Excel，不在 CSV

用户拿到模板后会用 Excel 打开、填、另存。于是要处理的全是 Excel 的怪癖：

- **编码**：Excel 另存的 CSV 在中文 Windows 上是 GB18030。解码顺序
  `utf-8-sig → utf-8 → gb18030`（gb18030 是 GBK/GB2312 的超集）。
- **时间被存成序列号**：单元格格式一变，`2026-08-23` 就成了 `46261`。
  纪元是 **1899-12-30**（含 1900 闰年 bug）；只有落在 `[20000, 80000]` 才当序列号（≈1954–2119）。
  ⚠ 序列号编码的是**墙上时间**，必须与裸文本时间走**完全同一条时区折算**——漏了这步，
  东八区用户把日期列导成数字之后，整批数据静默偏 8 小时。
- **表头会被改**：接受三种写法——`key` / `名称（单位）` / `名称`，**先精确后宽松**。
  自己导出的文件原样传回来必须能用，故公式列表头与「已修正列」标记列都要能被识别并忽略。

### 8.2 CSV 注入

列名是低权用户能自由填的。导出时以 `= + - @ \t \r` 开头的**字符串**单元格前面加 `'`。

⚠ **只对字符串转义、数字不转义**：否则 `-1.5` 被写成 `'-1.5`，导回来就成了非法数字。
反向剥离也只在引号后跟公式触发字符时才做。

### 8.3 上限

`MAX_IMPORT_ROWS = 10_000`、`MAX_IMPORT_BYTES = 16MB`。**分块读并即时判字节数**，
不要先整个读进内存再判——那样 16MB 的限制形同虚设。

### 8.4 写入分派

导入**复用**单行录入的清洗实现，不另写一遍。按列的 `source` 三分派：

| source | 去处 |
|---|---|
| `formula` | **拒收** |
| `manual` | `values_json`；未提交则取 `default_value`，再没有就 `None` |
| `point` | `overrides_json`（记为人工修正，带 by / by_name / at / reason） |

未定义的列 key 一律丢弃。点位汇总列**只认显式提交的 key**：不套默认值、不参与必填校验；
显式提交为空 = 撤销修正。

## 9. 权限

八个码。划分依据是**爆炸半径**，不是「读 / 写」。

| 权限码 | 覆盖面 |
|---|---|
| `dataset:view` | 表 / 列 / 函数目录 / 回填进度 / 记录 / 最新值 / 序列 |
| `dataset:manage` | 建改删表、列增删改与排序、公式 validate / preview |
| `dataset:record:write` | 新增 / 修改 / 删除单行，以及 CSV 批量导入 |
| `dataset:record:export` | 导出与模板下载——**数据外带口子，故与读面分家** |
| `dataset:override` | 人工修正的写入 / 撤销 / 按列批量清除。修正值优先于点位聚合值，**等同于篡改台账** |
| `dataset:backfill` | 历史回填与全表重算——大批量改写历史行且吃满数据库 |
| `formula:view` | 公式库读面 |
| `formula:manage` | 公式库写面。⚠ **与 `dataset:manage` 分家是刻意的**：改一条库公式会同时改掉**所有**引用它的台账列，爆炸半径比改单张表的一列大一个量级，不该被同一个码顺带授予 |

三条与直觉不同的划分：

- 建 / 改 / 删表 + 列 + 公式合成一个 `manage`——没人会「能建表不能删表」；
- 录入 / 改 / 删行 / 批量导入合成一个 `record:write`——导入风险更高，但要限制的是行数上限，
  那是**配额不是权限**；
- 导出与人工修正各自单列。

## 10. 命名：用户可见文案 ↔ 代码标识

| 界面 | 代码 |
|---|---|
| 数据台账 | `dataset` |
| 台账（一张） | `dataset_table` |
| 列 | `dataset_column` |
| 数据 / 记录（一行） | `dataset_record` |
| 点位汇总列 | `source = "point"` |
| 人工录入列 | `source = "manual"` |
| 公式列 | `source = "formula"` |
| 人工修正 | `override` |
| 自动采集 | `collect` / 聚合采集器 |
| 回填历史 | `backfill` |
| 重算公式列 | `recompute` |
| 公式库 | `formula` |

## 11. 分期落地

| 期 | 内容 | 状态 |
|---|---|---|
| 1 | 数据模型 + 迁移 + 表/列 CRUD + REST + 权限码 + 种子 | ⬜ |
| 2 | 公式引擎 + validate / preview / functions 端点 | ⬜ |
| 3 | 记录读写（effective / 分页 / latest / series / recompute / 脏信号） | ⬜ |
| 4 | 公式库 | ⬜ |
| 5 | 聚合采集器（worker） | ⬜ |
| 6 | 历史回填 | ⬜ |
| 7 | 保留期夜间清理 | ⬜ |
| 8 | 前端契约 + 线形 + 台账列表页 | ⬜ |
| 9 | 详情页：列配置 / 数据两个分区 | ⬜ |
| 10 | 公式编辑器（工具箱 / 记号树 / 分支编辑） | ⬜ |
| 11 | 导入 / 回填 / 人工修正的界面 | ⬜ |
| 12 | 公式库页 | ⬜ |
| 13 | 趋势分析页 + 详情页趋势分区 | ⬜ |
| 14 | 大屏对接（`dataset` 取数来源 + 脏信号 + 模块绑定） | ⬜ |

## 12. 聚合采集器

> 本节随第 5 期补齐。要点已记在 §4.4、§4.5、D1–D3、D6。

## 13. 运维与配置

> 本节随第 5 期补齐。

## 14. 历史回填

> 本节随第 6 期补齐。

## 15. 保留期夜间清理

> 本节随第 7 期补齐。三条硬约束（禁子查询 / DELETE 必带 `ts` 上下界 / 周期性 REINDEX）
> 照 [COLLECT_DESIGN.md](./COLLECT_DESIGN.md) 的归档清理写。

## 16. 台账脏信号

> 本节随第 3 期与第 14 期补齐。
