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
- 回填在参考实现里可以吃连续聚合的快路，**本仓没有那张视图**，故只走原始表（§14.4）；
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

⚠ `key` 放行中文，但禁掉公式语法里的全部记号：空格、单双引号、冒号、逗号、点号、
小括号、**花括号与方括号**。花括号尤其不能漏——引用写作 `{key}`，替换按 `\{([^{}]+)\}` 匹配，
key 里混进一个花括号就**永远引用不到这一列**：`{a}b}` 会先匹配 `{a}`，剩下的 `b}` 成为垃圾，
表现是一个指错位置的语法错误，而那一列在配置界面上看起来完全正常。

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

跨台账的全局资源。表结构、展开口径与两道守卫见 **§5.11**。

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

Python 侧的 `bucket_start()` 必须与它**同口径**——PG 的算法是「换成该时区的**墙钟**时刻 →
在墙钟上按原点取整 → 换回 UTC」，照抄即可：

```python
zone   = ZoneInfo(tz)
local  = ts.astimezone(zone).replace(tzinfo=None)     # 墙钟，不带时区
origin = datetime(2000, 1, 3)                         # ⚠ 见下
bucket = origin + ((local - origin) // interval) * interval
return bucket.replace(tzinfo=zone, fold=1).astimezone(UTC)
```

三处都不能省，每一处写错都**不报错**，只是把数记进隔壁那一格：

1. **原点是 `2000-01-03`（周一），不是 `2000-01-01`，且对全部桶宽都如此。**
   两者差 2 天 = 172 800 秒，故整除它的桶宽（1s / 1min / 1h / 12h / 1d）两种取法算出来一模一样
   ——只有 7 分钟、7 小时、11 秒这类不整除的桶宽会整体错开一段固定的量。
   实测见 `tests/integration/test_dataset_bucket_alignment.py`（4 个时区 × 10 种桶宽 × 4 个时刻逐格比对）。
2. **减法用不带时区的墙钟时刻。** 拿带时区的时刻相减算的是绝对时长，跨夏令时会与 PG 差一小时。
3. **`fold=1`。** 秋季回拨那一小时的本地时刻出现两次，PG 的 `AT TIME ZONE` 取的是**后一次**
   （回拨之后的标准时），而 Python 默认 `fold=0` 取前一次。一年只错一小时，而那一小时的数看起来完全正常。

> 实现在 `apps/dataset/services/buckets.py`。⚠ **`collect_interval_ms` 的 1 天上界仍然保留**：
> 周宽及以上的桶还没在真库上逐格验过（`time_bucket` 对 `interval` 里带月/年的宽度另有一套规则），
> 解除条件是把那一档也加进上面那条比对用例。

#### 4.5.2 跑得起来的两个前提（都不在 SQL 文本里）

⚠ 上面那条 SQL **拼得对不等于跑得起来**，两个前提都只有真跑一遍才暴露，而拿假件断言 SQL
文本的单元用例对它们完全无感：

| 前提 | 写错的表现 |
|---|---|
| 归档只读池的 `search_path` 要带上 timescaledb 所在的 schema（`container.TIMESCALE_SCHEMA`） | `function time_bucket(...) does not exist`——一句看起来像版本不对、其实是路径不对的错。`last` / `first` 同样解析不到 |
| `:bucket_width` 要绑 **`timedelta`**，不能绑 `'1 hour'` 这样的字符串 | `CAST($1 AS interval)` 让驱动把这个参数认成 interval，喂字符串是当场 `DataError`，整条链路 503 |

#### 4.5.1 时区取值只有一处：`PLATFORM_DATASET_BUCKET_TIMEZONE`

⚠ 本仓有**两个**桶时区配置：`PLATFORM_COLLECT_BUCKET_TIMEZONE` 服务点位历史读侧自己的聚合，
`PLATFORM_DATASET_BUCKET_TIMEZONE` 服务台账。两者是**不同消费者的独立取值**，与
「台账自己出一份八档白名单、不去改采集那份」（§4.4）同一条理由。

由此推出一条**必须守住的纪律**：台账这一侧的 SQL 分桶与 Python 的 `bucket_start()`
**必须同取 `dataset` 那一个**。聚合采集器（§12）不许图省事去调采集面那份带
`collect` 时区的查询构造器——两个时区配得不一样时，SQL 按一种边界分桶、Python 按另一种
算水位，行会成批落进错误的桶，**而且完全不报错**：数值本身是合法的，只是被记在了隔壁那一格。

## 5. 公式引擎

### 5.1 不是 eval

公式**不执行**，只解析后按白名单遍历求值。管线五步：

1. 把 `@公式标识(` 文本替换成占位调用，记下映射；替换后文本里**还剩 `@`** 即报错
   （「调用库公式要带括号，零参也要写成 `@标识()`」）；
2. 把 `{列key}` 文本替换成占位标识符，同一个 key 复用同一个占位符；
3. `ast.parse(text, mode="eval")` —— 用 Python 自己的表达式解析器，**只解析不执行**；
4. 展开库公式（表达式档就地内联，分析档留一个占位调用到求值期）；
5. 遍历 AST，**节点与运算符双白名单**，同时抽依赖。

⚠ 用 `ast.parse` 而不是手写 Pratt 解析器，是因为优先级与结合性一旦与人的直觉差一点点，
表现就是「算出来的数不对但看不出哪不对」。借 CPython 的语法是把这一整类风险移交给一个
被亿万行代码验证过的实现。⚠ `RecursionError` 必须接住转成公式错误——深嵌套的 `1+1+1+…`
会打穿 AST 递归栈，而校验端点只要读权限就能调，不接就是白送的 DoS。

⚠ **第 1、2 步是文本替换、发生在解析之前**，所以参考实现里字符串字面量不许含 `{` `}` `@`
——`IF({a}>0, "{x}", "")` 会把 `"{x}"` 误读成列引用。**本仓要修掉这条限制**：替换时先扫一遍
引号跨度并跳过其中的内容。这是本设计对参考实现的一处修正，不是照抄。

### 5.2 值模型：空、数、真假

「空」只定义一次：`None`，以及**只含空白的字符串**。⚠ `0` 与 `false` **不是空**。

- 取数（`to_number`）：`None`→空；`bool`→1/0；数值→float，但 **NaN 与 ±inf → 空**（不是错）；
  字符串先 strip，空串→空，转不动才报错。⚠ 401 位整数字面量抛的 `OverflowError` 必须接住
  转成公式错误，漏接就穿透成 500。
- 真假（`truthy`）→ `真 / 假 / 未知`。空→未知；数→`!= 0`；**转不成数的文本（如「停机」）算真，不报错**
  ——一个脏格子不该毙掉整列。

### 5.3 函数目录：三处一处真源

三张表必须一致，且由契约测试锁死：

| 表 | 管什么 |
|---|---|
| `SCALAR_FUNCS` | 名字 → `(最少参数, 最多参数)`。**元数的唯一真源** |
| `SCALAR_IMPL` ∪ `LAZY_IMPL` | 实现。两张表**互斥**，并集必须**恰好等于** `SCALAR_FUNCS` |
| `FUNCTIONS`（给前端的目录） | **不许手写元数**，由前两张注入 |

⚠ 前端的函数面板**零硬编码函数名**。参考实现早期硬编码了 5 个，后端加了对数与三角族之后
整族在界面上不可见，用户报「算不了 ln」。

五个族：标量函数、`PREV`（跨行）、`*_OVER`（时间窗，元数固定 2）、`*_ALL`（全表，元数固定 1）、
分支族。

### 5.4 三值逻辑：短路的精确规则

`IF` / `IFS` / `AND` / `OR` 拿到的是**未求值的子树**，自己决定算哪一支。

**`AND` / `OR` 走 Kleene 三值逻辑 + 惰性求值**：

| 式子 | 结果 |
|---|---|
| `AND(假, 任意)` | 假 —— 右边**根本不求值** |
| `OR(真, 任意)` | 真 —— 同上 |
| `AND(未知, 真)` | 未知 |
| `OR(未知, 真)` | **真** —— 决定性的真盖过前面的未知 |
| `OR(ISBLANK({x}), {x} == 0)`，`x` 为空 | **真** |

⚠ **精确规则是：未知不中断扫描，只有决定性取值提前返回。** 换句话说「短路」只对排在
决定性取值**之后**的操作数成立；排在未知之后的操作数**照样求值**。
**实现成「遇到第一个未知就返回空」会静默毁掉每一条 `ISBLANK` 守卫公式**——而那正是它存在的场景。

⚠ **`AND(a,b)` 与 `a and b` 必须共用同一份实现**，否则同一个意思换个写法算出不同的数。

⚠ **`IF` / `IFS` 比 `AND` / `OR` 严**：条件算出空就**整条中止为空，不往下一档滑**。
「这一档说不准」与「这一档不成立」是两回事，滑过去会让用户拿到一个看着正常、
其实建立在未知之上的数。三元写法 `X if C else Y` 与 `IF` 语义**必须一致**。

### 5.5 空与零永远分开

这是全模块反复出现的同一条原则（与 D3 同源）：

- `ALL_ZERO_OVER` 在**空窗口**上返回**空，不是真**。「全是 0」与「什么都没有」不是一回事，
  混为一谈会把一张刚建的空表送进「归零」那一支。
- `COUNT_OVER` / `COUNT_ALL` 在空集合上返回 **0**（不是空）——数得清就是 0。
  但 `COUNT_ALL` 在「这一列压根没取过数」时返回**空**：那是「不知道」，不是「没有」。
- 其余聚合在空集合上一律返回空。

### 5.6 窗口与全表的取数边界

- **时间窗是半开区间 `(下界, 当前行ts]`——当前行在窗内。**
- **全表聚合覆盖所有行，包括当前行之后的行。** 五个 `*_ALL` 由一份四字段底数
  （min / max / sum / count）派生，于是一列只查一次。
  正在新建或编辑、还没落库的那一行要**并进底数**再算，否则归一化类公式的结果会越界。
- `PREV` 的期数必须是**整数字面量**（`bool` 明确拒绝），`1 ≤ n ≤ 100`，且**只能引用本表的列**。

### 5.7 一处对参考实现的修正：`%` 与 `MOD` 必须一致

参考实现里中缀 `%` 走 Python 语义（结果随**除数**符号，`-1 % 3 == 2`），
而 `MOD()` 函数走 `math.fmod`（结果随**被除数**符号，`fmod(-1, 3) == -1`）。
两者对负数算出不同的数。那边**知道这是个缺陷但没改**——改了会改变存量公式的结果。

**本仓是新建的，没有存量公式，故从第一天就让两者一致**：一律取**除数**符号
（`-1 % 3 == 2`），与电子表格的 `MOD` 同口径。台账的用户是拿电子表格思维来的，
按那边的直觉对齐是唯一说得通的选择。

### 5.8 依赖与环

保存列时解析出的依赖落进 `formula_deps`，避免每次求值重解析。依赖分几类，
**只有「同行引用」与「指向其它公式列的窗口引用」连边**——`PREV` 与自引用窗口不连边
（它们读的是别的行，不构成同一行内的先后关系）。据此拓扑排序，成环即拒绝保存。

⚠ 保存一个公式列**必定跑一次整表试编译**，而不是只编译这一列：环是整表的性质。
试编译时要带齐全部相位输入（已知列集合、跨表 code 映射、公式库），
**漏任何一项今天都表现为静默算空**——漏跨表映射就是「引用了不存在的表」，漏公式库就是展不开。

### 5.9 记号树：为什么解析放后端

校验端点除了「对不对」，还回一棵**记号树**——把公式渲染成人读的数学式（分式上下排、
Σ 带上下标、`IF/IFS` 收成一个大括号）。

放后端的理由：前端再解析一遍就是**第二个解析器**，两者对优先级的理解迟早分叉，
而分叉的表现是「读法显示的和实际算的不是一回事」——比不显示读法更糟。

⚠ 记号树的渲染必须**对不认识的节点降级成 `?`**，绝不白屏：一个能识别的节点类型少了个子字段
就会让递归撞上 `undefined`，把整个弹窗打黑。

### 5.10 已知边界：下游过期

改一条历史行之后，它**之后**那些行里的 `PREV` / 时间窗 / 全表类公式结果就不准了。
本期**只如实上报**（写操作回执带 `has_stale_downstream`，界面出横幅提示去重算），
**不做级联重算，也不落表级的持久过期标志**。理由：级联的边界是「这张表之后的全部行」，
在最坏情况下等于全表重算，而它由一次单行编辑触发。

⚠ **整表聚合（`*_ALL`）的过期判定不能只看「之后」**：改一行会改掉整列的
min/max/sum，比它更早的行同样不准了。故这张表用到 `*_ALL` 时判据是「除了这一行，
表里还有没有别的行」，其余情况才是「这一刻之后还有没有行」。

> ⚠ 字段名是 `has_stale_downstream` 而不是 `stale_downstream`：本仓的命名闸要求
> 布尔带 `is_` / `has_` / `should_` 前缀（code-style-python §1）。

### 5.11 公式库

跨台账的具名计算单元，在公式里写作 `@标识(实参)`。落在 `platform.dataset_formulas`
（普通表，几十行量级）：`code`（全局唯一，**建后不可改**——它就是调用点上的那个字面量）、
`name`、`category`、`expression`（体，形参写作 `{形参名}`）、`params_json`（有序形参表）、
`description`、`is_builtin`、`is_enabled`。

**没有外键、没有版本表、没有索引，三件都是决定不是遗漏**：

- 台账列与库公式之间只有一条**文本**联系（列公式里的那段 `@标识(`），故「谁在用它」只能
  重新解析，JOIN 不出来；
- 没有版本表意味着改一条公式**即刻**改掉全部引用方的口径，历史行等下一次重算才跟上——
  改之前先看 `/usages`，改之后去重算；
- `load_library` 本来就是整表无 WHERE 扫描，几十行上的索引不会被选中。

**只有表达式档，而且往后也不加第二档。** 参考实现有一档 `analysis`（把实参交给一个 AI
provider 求值），本仓不做：落一个只有一种取值的 `kind` 列等于把一个死开关钉进表结构。

⚠ 本节原先写的是「将来要加是扩展步：新增一个可空的 `kind` 列 + 一个可空的 `provider` 列」。
[分析建模](./MODELING_DESIGN.md) 落地时**没有走这条路**，理由是它更贵：`kind` 分档会破掉
展开机制的核心不变量（「展开之后调用不复存在，于是依赖抽取 / 环检测 / 拓扑排序 / 记号树 /
求值器一个字都不用知道公式库」，见下一小节），分析档节点要在解析、依赖、记号树、求值器**四处**
各加一支。

**实际采用的是第六族函数 `PREDICT('模型标识', 实参…)`**（[MODELING_DESIGN §7.2](./MODELING_DESIGN.md)）：
它与 `PREV` / `*_OVER` / `*_ALL` 三族**完全同构**——解析期只登记依赖，取数期由异步层预取，
求值期只查 `externals`。于是求值器保持纯同步无 IO，一次重算只加载一次模型定义，而
`dataset_formulas` 表**一列不加、一条 CHECK 不改**。用户侧照旧在公式库里建一条普通条目，
公式体写 `PREDICT('能耗预测', {温度}, {负荷})`。

#### 展开：拼的是 AST 子树，不是文本

`@标识(实参)` 在**解析期**就地内联（§5.1 第 4 步），展开之后调用**不复存在**，于是依赖抽取、
环检测、拓扑排序、记号树与求值器一个字都不用知道公式库。

⚠ **替换的是 AST 子树而不是文本。** 把 `{整体}` 按文本换成 `1+3`，`{部分}/{整体}*100`
就成了 `1/1+3*100 = 301`，正确答案是 25——**不报错，数还长得挺像样**。
⚠ **每处替换都 `deepcopy`**：同一个形参在体里出现两次会共用一个节点对象，之后任何一次
树改写都会同时改到另一处。
⚠ 实参属于**调用方**：用调用方的调用链展开，嵌套调用（`@加一(@加一(1))`）才不会被误判成环。
⚠ 体里的跨表引用 `{某表.某列}` 是绝对地址，展开时并进**调用方**的占位空间。

三道闸，都必须终止：调用链里再次出现同一个标识即成环（`甲 → 乙 → 甲`）；嵌套深度上限
`MAX_FX_DEPTH = 8`；一条公式里的总展开次数上限 `MAX_FX_EXPANSIONS = 200`（挡的是「层数不深
但极宽」那一路）。

#### 形参两档：`column` 与 `value`

| 档 | 实参能是什么 | 为什么 |
|---|---|---|
| `column` | **只能**是裸列引用 `{列key}` | `PREV` / `*_OVER` / `*_ALL` 要知道是**哪一列**，收不了表达式 |
| `value` | 任意表达式 | 它可能落在字面量位（时间窗、`PREV` 的期数），也可能落在算术位 |

⚠ **`value` 形参的 `default` 不是界面预填，它是「这个位置该放什么」的唯一声明。**
校验时拼一条样例调用（列形参填 `{形参名}`，值形参填它的默认值），走与真实调用完全相同的
那条解析链。一个值形参落在只收字面量的位置而没有默认值，引擎报的是「时间窗必须是字符串
字面量」——那句话指的是**样例调用**，而用户要改的是「默认值」那一栏，故报错要**补一句**
指回该改的字段。

⚠ 公式体**不能单独校验**：单独解析时那个值形参必然报「必须是字面量」，那是校验方法的问题，
不是公式的问题。

#### 快照、`@` 闸与「已停用」

`FormulaLibrary` 是**一次解析期间的快照，不是活查询**：一次重算可能横跨上万行、共用同一套
定义，中途换定义会让同一批数据按两套口径算出来，而且没有任何症状。

⚠ **没有进程内缓存**：改一条库公式必须立刻对每一处引用生效，而缓存失效要跨 worker 与副本
传播。省开销靠另一条路——`uses_library` 那道 `@` 闸：源文本里没有 `@` 就一次查询也不发。
它安全的前提是**列 key 与公式标识都禁掉了 `@`**，而一个裸 `@` 本来就是解析错误。

⚠ **快照里**要装**停用的条目**，`_require_entry` 才说得出「已停用」而不是「公式库里没有 X」。
后者会把人送去建一条已经存在的公式。

#### 两道守着不可逆动作的闸

⚠ **停用一条还在被引用的库公式，破坏力与删除相同。** 引用它的列在**解析期**就失败，而保存
任一列都会试编译整张表，于是那张表的**数据录入、批量导入、人工修正与重算一起 400**。
故停用走 **409**，且文案要点名受影响的台账**与后果**——只说「还有 3 处引用」，运维不会知道
自己按下去的是什么。

⚠ **删除要查两侧**：台账列在用它，以及**库里别的公式在调它**。少问后一侧，「`@综合能耗`
调用 `@折标煤`、只是还没有台账列用到 `@综合能耗`」这一路会被放行。判据取解析之后的
`used_fx` 而不是文本搜索，故**间接**引用也算数。**没有 `force` 出口**：绕过去的代价是那些
引用方在运行期才崩，而配置那张表的人看不见。

⚠ 反查用的快照里，条目**一律按启用算**。照原样解析的话，一条已停用公式的引用方会因为
「已停用」抛错、被当成「没人引用」，于是那条不可逆的删除被放行。

⚠ 同理，**校验一条草稿时把它自己当成启用的**：停用开关管的是「谁还能调它」，不是「它写得
对不对」。不这么办，停用一条公式的那次保存会被它自己的「已停用」挡下来——一个永远关不掉的开关。

#### 预设：只补缺，恢复只恢复口径

15 条出厂预设是**代码常量**（`apps/dataset/builtin_formulas.py`），由 `scripts/seed.py` 在
迁移之后补进库，**只补缺、绝不覆盖**——一条被用户改过的预设不会在下次启动时被改回去。
⚠ 预设**没有任何运行期信号**：改坏一条，在有人从插入面板里选中它并保存失败之前不会有东西
抱怨，故单元用例逐条跑真校验。

预设**不能删除，只能停用**（删掉之后没有恢复入口）；改歪了走 `POST P/formulas/{fid}:restore`
还原。⚠ **恢复不动 `is_enabled`**：恢复的是**口径**，不是开关。顺手把它翻回启用，等于悄悄
重新打开一个运维刻意关掉的东西。

折标煤系数（电 0.1229 kgce/kWh、天然气 1.33 kgce/m³）按 GB/T 2589 等价值口径，**本来就是要
按地区与年份改的**；`同比增长率` 的 `周期数` 数的是**台账的期数不是时间**（月报填 12，
小时表填 24）。

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
P/formulas/{fid}:restore                      POST 恢复预设出厂口径（⚠ 不动启用开关）
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

2. **`:series` 返回 `{列key: [{ts, value}]}`**，字段名与点位历史读侧的
   `HistoryPointOut` 对齐，趋势页的渲染代码两边共用一份。
   > ⚠ 参考实现用的是 `{t, v}`。本仓的命名闸不许单字母名（code-style-python §1），
   > 而点位历史那份本来就叫 `ts` / `value`——照抄 `{t, v}` 得到的是两个都不一样的
   > 形状，反而更难共用。
   > ⚠ 出参类型名是 `DatasetSeriesPointOut` 而不是 `SeriesPointOut`：空调面已经有
   > 一个 `SeriesPointOut`，同名会让 FastAPI 把**两边**的形状名都改成带模块路径的
   > 长名，当场打断前端已经钉住空调那份的契约用例。

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

### 7.10 组件切分（本仓 SFC ≤500 行）

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

⚠ **这八个码是终态，不是一次性登记的清单。** 每个码跟着**它自己的端点**那一期进 auth-server 的
权限目录与路由规则表——auth-server 的目录明写「只登记已经有消费方的码：无端点无页面的占位码
不进目录，否则角色配置界面会摆出一排点了没有任何效果的开关」，且有一条契约用例钉着
「每个码都必须被某条路由规则引用」。提前把八个码全种进去，得到的是六个点了不起作用的开关，
而翻开关的运维**收不到任何反馈**说它什么也没做。

新增一个码要动三处，漏一处的表现各不相同：auth-server 的 `catalog/permissions.py`（真源）与
`rules_platform.py`（闸 1 规则），`apps/dataset/catalog.py`（逐字复述），前端
`PERMISSION_CODES` 与路由/导航的 `meta.permissions`。**改完必须重跑 auth 种子**，否则新端点全 403。

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
| 5 | 聚合采集器（worker） | ✅ |
| 6 | 历史回填 | ✅ |
| 7 | 保留期夜间清理 | ✅ |
| 8 | 前端契约 + 线形 + 台账列表页 | ⬜ |
| 9 | 详情页：列配置 / 数据两个分区 | ⬜ |
| 10 | 公式编辑器（工具箱 / 记号树 / 分支编辑） | ⬜ |
| 11 | 导入 / 回填 / 人工修正的界面 | ⬜ |
| 12 | 公式库页 | ⬜ |
| 13 | 趋势分析页 + 详情页趋势分区 | ⬜ |
| 14 | 大屏对接（`dataset` 取数来源 + 脏信号 + 模块绑定） | ⬜ |

## 12. 聚合采集器

跑在 **worker 角色**里的一条常驻循环（ADR-0002：重任务用运行角色而非独立服务），
`ROLE=worker` 的进程起来就装它，与另外五条消费循环共用同一个事件循环。

### 12.1 模块与职责

| 模块 | 管什么 |
|---|---|
| `services/buckets.py` | 桶对齐（§4.5）与行幂等标识（D2）。**零 IO 的纯函数** |
| `services/aggregate.py` | 八档白名单 + 两条 SQL（分桶聚合 / `delta` 减数）+ 把结果折成一格一格 |
| `services/collect_run.py` | **一张表、一个事务**里发生的全部事：定桶 → 折算 → 幂等写 → 重算 → 推水位 → 报脏 |
| `services/collector.py` | 调度：租约 → 读开关 → 逐表算 → 收摊 |
| `crud/record.py::upsert_collected` | `ON CONFLICT DO UPDATE` 那一条 |

### 12.2 一拍做什么

```
续/抢租约 ──否──→ 这一拍什么都不做（连库都不开）
   │是
读 dataset 组运行参数的有效值（一次小查询）
   │
总开关关着 ──→ 返回（租约照持：关的是「采不采」，不是「谁是主」）
   │开
取全部 collect_mode='aggregate' 且启用的台账 id
   │
逐表：各开一个事务 + 各有一个超时 + 每张之间 await asyncio.sleep(0)
```

**一条循环管全部台账**，不是一张表一条循环——台账是几十张级别的低频派生层，
每张一条循环等于几十个各自持租约、各自定时的独立单元。逐表的隔离由
「一表一事务、一表一超时」拿到：一张表撞上约束或查询超时，同一拍里其余的表照常写完。

### 12.3 单表这一拍算哪几个桶

```
current      = bucket_start(now)                       # 还开着，绝不算
last_closed  = current − 1 桶                           # 这一拍的右界
first        = 水位 + 1 − RECOMPUTE_TAIL_BUCKETS        # 水位为空时 = last_closed
右界再压到   min(last_closed, first + MAX_BUCKETS_PER_TICK − 1)
```

四条边界，每条都有理由：

1. **只算已关闭的桶**：当前这个桶还在收数，此刻折算出来是半截的数，而它会被下一拍原地改掉
   ——图上表现为最后一格反复跳。
2. **水位为空的表只算最近一个已关闭的桶**，不倒着补历史：补历史是回填（§14）那件**显式触发**
   的事，让它在建表之后自己跑起来等于随手扫全表。
3. **每拍额外重算最近 `RECOMPUTE_TAIL_BUCKETS` 个已关闭的桶**（D6），兜住迟到的归档数据。
4. **先把右界压进上限再展开桶序列**：停机一个月的 1 秒周期表展开出来是几百万个桶，
   而那一串在算出上限之前就已经把内存吃掉了。

**水位推到这一拍算完的最后一个桶，不管有没有写出行**——「这个桶算过了、一格都没算出来」
与「这个桶还没轮到」是两回事。**唯一的例外是一根点位列都没绑的表：它连水位都不推**，
等有人把列配上之后要能从原地接着算；推了就是把这段时间永久跳过。

### 12.4 向前采集只读原始表

⚠ 刚关闭的桶在连续聚合视图里**还没有**——不是慢，是没有（D6）。而本仓的点位历史
连那张视图都没有，故回填也只走原始表（§14.4）。

### 12.5 八档 SQL

一条语句渲染出这一批列需要的全部档位（每档一条 SQL 就是 N 遍时序扫描）：

```sql
SELECT source_id, point_code,
       time_bucket(CAST(:bucket_width AS interval), ts, timezone => :bucket_timezone) AS bucket_start,
       count(value_num) AS num_count,
       count(value_text) AS text_count,
       <按需渲染的档位…>
  FROM collect.point_history
 WHERE (source_id, point_code) IN (…) AND ts >= :range_start AND ts < :range_end
 GROUP BY source_id, point_code, bucket_start
 ORDER BY bucket_start ASC, source_id ASC, point_code ASC
 LIMIT :row_limit
```

| agg | 渲染出来的表达式 |
|---|---|
| `avg` / `min` / `max` / `sum` | `avg(value_num)` / `min(value_num)` / `max(value_num)` / `sum(value_num)` |
| `count` | `count(value_num)`，**结果为 0 时这一格是空**（D3） |
| `first` / `last` | `first/last(value_num, ts) FILTER (WHERE value_num IS NOT NULL)`，取不到再还原 `value_text` 那一份 |
| `delta` | `last(value_num, ts) FILTER (…)` —— **SQL 只出本桶末值**，跨桶相减在 Python 里做 |

⚠ **`FILTER (WHERE value_num IS NOT NULL)` 不能省**：timescaledb 的 `last(v, t)` 取的是
「时间最大那一行的 `v`」，那一行的 `v` 是 NULL 就回 NULL——一个末尾恰好写过一条空值的桶
会被整格算空，而它上面的样本明明都在。

⚠ **样本数跟着真正撑起这一格的那一列走**：数值档记 `num_count`，`last`/`first` 落到文本
那一档时记 `text_count`。不分开的话，一个有值的文本格会显示成「0 个样本」而被界面标灰。

### 12.6 `delta` 的减数与三条边界

减数单独一条查询，**必须有回看窗口下界** `clamp(桶宽 × 24, 6h, 2d)`：

```sql
SELECT DISTINCT ON (source_id, point_code) source_id, point_code, value_num
  FROM collect.point_history
 WHERE (source_id, point_code) IN (…)
   AND ts >= :lookback_start AND ts < :range_start AND value_num IS NOT NULL
 ORDER BY source_id ASC, point_code ASC, ts DESC
```

拿到减数之后按桶升序接力，三条规则见 §4.4，实现只有四行：

```python
if previous is None: return None          # 取不到上一桶末值 → 空，绝不拿本桶 first 顶替
step = end - previous
return None if step < 0 else step         # 负 → 空，绝不写 0
```

中间的空桶**不打断接力**——它们压根不在结果集里，而 `previous` 一直留着，末值有效到下次变化为止。

### 12.7 写入：`ON CONFLICT DO UPDATE` 的 SET 子句

```sql
INSERT INTO platform.dataset_records
       (table_id, ts, row_id, values_json, samples_json, source)
VALUES (…)                                       -- row_id = uuid5(桶身份)，source = 'collect'
    ON CONFLICT (table_id, ts, row_id) DO UPDATE SET
       values_json  = dataset_records.values_json || (EXCLUDED.values_json - CAST(:manual_keys AS text[])),
       samples_json = COALESCE(dataset_records.samples_json, '{}'::jsonb)
                      || COALESCE(EXCLUDED.samples_json, '{}'::jsonb),
       updated_at   = now()
```

五条，每条都是「不这么写就静默出错」：

1. **SET 里没有 `overrides_json`**——人工修正独占它自己那一列，采集与重算绝不覆盖（D4）。
2. **SET 里没有 `source` / `created_by` / `created_by_name` / `created_at`**——那是这一行的出身，
   不该每一拍改一次。
3. **`- CAST(:manual_keys AS text[])`**：入参里带着人工录入列的 `default_value`，那是给**新建**
   的行用的；更新时不把这些键减掉，就是每一拍都拿默认值盖掉人填的数。
4. **`samples_json` 两侧都要 `COALESCE`**：这一列可空，而 SQL 的 `NULL || 任何东西` 还是 NULL
   ——少一边就是一次采集把整份样本数抹平。
5. **`updated_at` 要显式推进**：`onupdate` 是 ORM 层的钩子，核心层的 upsert 走不到它，
   不写就永远停在第一次写入的时刻。

⚠ **整行全空的桶不写行**（D3）：一格都算不出来的桶写出去就是一行永远解释不清的空记录，
而它在图上与一个真实的零点长得一模一样。

### 12.8 写完之后

- **重算刚写过的那一段的公式列**（只覆盖 `computed_json` / `compute_error`）。不重算的话，
  表格会同时显示「这一拍新采的原始值」与「按上一拍的值算出来的公式值」，而两者都不带标记。
- **报脏**（§16）：走 `lib.db.after_commit` 登记的钩子，即「自己这个事务提交之后」。
  就地报脏会让发布器抢先读到旧值。**只有真写出行的那一拍才报**。

### 12.9 出错与关停

| 情况 | 行为 |
|---|---|
| Redis 不可达 / 续租失败 | 一律判非 leader，立刻停手（renew-or-die） |
| 一张表抛异常或超时 | 记一条 `dataset_collect_table_failed`，**下一张表照常算** |
| 一列的 `node_key` 拆不开 | 记一条 `dataset_collect_node_key_unusable`，**跳过那一列** |
| 一列配了未知的 `agg` | **抛**——那是配置写坏了，不是数据缺失（§4.4） |
| 文本点位配数值口径 | 那一格空、不报错 |
| 一拍整体出错 | 记一条 `dataset_collect_tick_failed`，下一拍继续（绝不带走循环） |

关停顺序照 `worker.py::run_until_stopped`：**停收新活 → drain → 让租约 → 关资源**，
不是启动顺序的逆序。逐表循环每一轮开头看一眼 `stopped`，手上那张算完就不再开始下一张。

日志只在**有内容**的那一拍记一条 `dataset_collect_tick`（写出了行、或者有表在等点位列）
——一分钟一条的流水会把真正有内容的那几条埋掉。每一拍开头绑一条新的 trace：
contextvars 不跨任务传播，不绑就取到一串全零。

## 13. 运维与配置

### 13.1 六个环境变量

全部在 platform-server 的 `.env` 上，**前五项同时是运行参数**（界面可改，见 §13.2）。

| 变量 | 出厂值 | 含义 |
|---|---|---|
| `PLATFORM_DATASET_ENABLED` | `false` | 聚合采集总开关 |
| `PLATFORM_DATASET_INTERVAL_S` | `60.0` | 采集器多久醒一次，扫一遍全部按周期聚合的台账 |
| `PLATFORM_DATASET_RECOMPUTE_TAIL_BUCKETS` | `2` | 每拍额外重算最近几个已关闭的桶（D6） |
| `PLATFORM_DATASET_MAX_BUCKETS_PER_TICK` | `240` | 单表一拍最多算多少个桶 |
| `PLATFORM_DATASET_TABLE_TIMEOUT_S` | `60.0` | 单表一拍的预算 |
| `PLATFORM_DATASET_LEASE_TTL_S` | `180` | 单活租约的存活期（**不是**运行参数：改它要重新装配租约） |

另有 `PLATFORM_DATASET_BUCKET_TIMEZONE`（§4.5.1），它同时喂 SQL 的 `time_bucket`
与 Python 的 `bucket_start`，改它会改变**所有**新桶的边界，故也不做成运行参数。

保留期清理另有五个变量（同一个 `dataset` 分组、同一条路由），列在 §15.5。

### 13.2 运行参数：`dataset` 分组

界面路径 `GET/PUT/POST /api/v1/platform/dataset-tables/runtime-params[/{section}][:reset]`，
读用 `dataset:view`，写用 `dataset:manage`。

⚠ 挂在 `dataset-tables/` 之下而不是另起一个顶层资源段：闸 1 的规则表在 **auth-server**，
`dataset-tables*` 那一摞已经把「GET → `dataset:view`、其余 → `dataset:manage`」的阶梯铺好了，
正是这一面要的两个码。另起 `dataset-runtime-params` 就要在另一个服务里补一条规则，
而没补上的表现是它掉进 900 那条按方法兜底的规则——「改台账采集节拍要 `ac:manage`」，
管空调的人能改、管台账的人反而不能。

**九项全是即时档**（采集五项 + 清理四项，后者见 §15.5）：两条循环各自在**每一拍 / 每一趟**里
现读一次这一组的有效值（覆盖行优先，没覆盖的回落到环境变量），界面上一改下一拍就生效，
不必重启进程。启动时抄一份的话，运维关掉开关之后还要重启一次才停得下来。

⚠ **采集开关的危险方向是「关」**（`danger: off`）：关掉之后水位停在原地、完全没有报错，
界面上那张表看起来只是「今天还没有数据」；而关闭期间的桶**不会自己补回来**——重新打开只
从当前这一拍往下算，中间那段要人显式触发回填（§14）。`recompute_tail_buckets` 的危险方向
是「调小」：调到 0 就只算新桶，迟到的样本从此永远进不了台账，而那一格看起来只是「当时就
这么多」。

⚠ **同一组里的清理开关方向恰好相反**（`danger: on`，§15.5）：它**打开**才危险。同为开关
不等于同一个方向，照抄另一个的取值会把二次确认弹在安全的那一侧。

### 13.3 界面上的「未生效」由真实有效值说了算

台账列表页的「(未生效)」徽标读的是 `dataset_enabled` 的**有效值**，不许写死
（本文档开头那条告诫）：写死会在运维打开开关之后继续显示未生效，把「诚实」变成
另一个方向的谎。

### 13.4 单活与多副本

租约键 `platform:dataset-collect:leader`（写死不可配，与另外三把互不相干）。
worker 起几个副本都行，同一时刻只有一个在算。写入本身按桶身份幂等（D2），
但两个副本会互相把对方刚算的结果原地覆盖一遍，白烧一份数据库负载。

⚠ Redis 不可达一律判非 leader：宁可这一拍没人采，也不要两个进程同时算同一批桶。

### 13.5 排查「这张表怎么不出行」

按这个顺序问，每一步都有一处**看得见**的证据：

1. `dataset_enabled` 的有效值是不是 `false`（界面 / `GET …/runtime-params`）；
2. 台账的 `collect_mode` 是不是 `aggregate`、`is_enabled` 是不是真；
3. 有没有绑了点位的列——一根都没有时**水位原地不动**，日志里那一拍的
   `dataset_collect_tick` 会把它的编码列进 `awaiting_columns`；
4. 绑的点位有没有开归档（D5 会自动开，但绕开界面建的列可能没拿到）；
5. `last_collected_ts` 有没有在动——不动而第 3 步又通过，去看
   `dataset_collect_table_failed`；
6. 行写出来了但格子是空的：看 `samples_json`，`n = 0` 就是「这个桶里一条数值样本都没有」
   （文本点位配了数值口径也是这样）。
7. **只有不常变的点位是空的**：去查那个点位的归档心跳 `archive_max_interval_ms`
   是不是**比台账周期宽**。第 1 层是变化驱动的，值不变时只有心跳在写行；心跳比
   桶宽，稳定点位的多数桶就一条样本都没有，`last` 也取不到（COLLECT_DESIGN §4.3 ③'）。
   出厂心跳 60s，秒级台账要把心跳压到不宽于周期。

### 13.6 可观测

| event | 何时 | 级别 |
|---|---|---|
| `dataset_collect_tick` | 这一拍写出了行、或者有表在等点位列 | INFO |
| `dataset_collect_lease_acquired` / `_released` / `_lost` | 主的交接 | INFO / INFO / ERROR |
| `dataset_collect_table_failed` | 一张表这一拍没算完 | ERROR |
| `dataset_collect_node_key_unusable` | 一列的绑定串拆不开 | WARNING |
| `dataset_collect_tick_failed` | 一整拍出错 | ERROR |
| `dataset_dirty_mark_failed` | 报脏没发出去（数据已落库） | WARNING |

无事发生的一拍**不记**：一分钟一条的流水会把真正有内容的那几条埋掉。

## 14. 历史回填

把用户显式指定的一段**过去**时间重新汇总成台账行。它补的是向前采集器身后的
历史——新建聚合台账之前那一段空桶、采集开关关闭期间断掉的那一段（§13.2）。

⚠ **不受 `dataset_enabled` 影响**：那个开关管的是「自动采不采」，回填是人按下去
的一次性任务。

### 14.1 三条拍板决策

**D-A 回填绝不推进 `last_collected_ts`。**
水位是**向前采集**的进度，回填补的是它身后的历史。推一下的后果是采集器从此
跳过中间那一段，而它看起来只是「那几天没有数据」——没有任何一处会报错。

**D-B 折桶、组行、写入一律走向前采集那一份。**
`services/buckets.py`（桶网格与 `row_id` 构造式）、`services/collect_run.py`
（`point_columns` / `manual_keys` / `manual_defaults` / `collected_rows`）与
`crud/record.py::upsert_collected` 四件回填原样复用。两份「桶怎么变成行」的实现
是这块地方唯一真正的风险：`row_id` 差一点点，同一个桶就长出第二行，而两行看
起来都对。

**D-C 收尾重算的范围是 `[回填起点, 此刻]`，不是回填区间。**
补进来的历史行会改变它**之后**每一行的 `PREV`、时间窗与整表统计（`*_ALL`）。
只重算补的那一段，后面那些行仍按缺了这一段的底数显示，而它们看起来完全正常。

### 14.2 一次回填的流程

```
POST → 取运行参数有效值 + 保留期下界 → 定计划（三道 clamp）→ 抢单飞锁
     → 清取消标志 → 写任务态 → 起后台任务（fire-and-forget）→ 202 立刻返回
                                        │
后台：逐批（240 桶 = 一次聚合 = 一次 upsert = 一个事务）
        每批之间：看取消标志 → 报脏 → 写进度 → 续锁 → 让出事件循环
      跑完/取消 → 重算 `[回填起点, 此刻]` → 再报一次脏 → 落终态 → 放锁
```

### 14.3 三道 clamp，每一道都留一句话

**静默裁剪是这里的失败模式**：用户要了一年、拿到一个月，而界面上看不出少了
哪一段。故每一道 clamp 都往 `notes` 里追加一条中文说明，`is_clamped` 汇总。

| clamp | 口径 | 为什么 |
|---|---|---|
| 保留期下界 | `now − min(绑定点位的 archive_retention_days)`，边界桶**向上**取整 | 更早的原始样本已被清理，重算只会得到空行（§2.4）。向上取整是因为跨在边界上的桶只剩半桶样本，折算出来是个**错的数**，而它一旦写出去就永久留在台账里 |
| 尾部避让 | `min(最后一个已关闭的桶, 采集器下一拍的起点) − 1 个桶` | 两边同时写同一行只会互相覆盖。⚠ 采集器从**水位**往下算，不是从最后一个已关闭的桶：开关关了很久的表，它的射程整段压在过去 |
| 桶数上限 | 20 万个桶（= `MAX_RECOMPUTE_ROWS`），留**较新**的那一段 | 补出来的行紧接着就要重算，两个上限不一致的话，多出来的那一截会写出行却永远没有公式值 |

三处口径：

- 保留期取**最短**的那一个，永久保留（`archive_retention_days IS NULL`）不参与
  比较。宁可让保留期长的那几列少补一段，也不要留下一格半桶算出来的错数；
- 尾部避让只看台账自己的 `collect_mode` 与 `is_enabled`，**不看采集总开关**：
  那个开关随时会被打开，而回填这时已经跑在半路上了；
- 区间是**桶闭区间**：两端各自落到自己那个桶上，两端同桶就是「只补这一个桶」。

### 14.4 取数路径：本仓只有原始表

`fast_path` 恒为 `raw`，回执里如实说出来。参考实现走的是一张 1 小时连续聚合
视图（约 170×），本仓的点位历史**没有**这张视图——建它要改 collector-server 的
迁移链，那是另一个服务、另一个 PR。留一个永远填不上的「快路」字段，等于让界面
长期显示一个不存在的加速选项。

### 14.5 一批 = 一次 upsert = 一个事务

取消只在**批边界**生效：半个批次提交出去的是一段谁也解释不清的历史。一批的
预算沿用「单表一拍」那一档（`PLATFORM_DATASET_TABLE_TIMEOUT_S`）——回填的一批
与采集的一拍做的是同一件事：一段桶、一次聚合、一次写入。

**报脏报两次**（§16）：逐批报一次，让大屏随进度长出数据；**收尾重算之后再报
一次**。少了后面那一次的话，最后一批的 upsert 让新行的 `computed_json` 还空着，
发布器在这个窗口里读到的是一片空的公式列。

### 14.6 三个 Redis 键，谁也替不了谁

```
platform:dataset:backfill:{table_id}          任务态，TTL 一天
platform:dataset:backfill:{table_id}:lock     单飞锁，每批 CAS 续期，TTL 5 分钟
platform:dataset:backfill:{table_id}:cancel   取消标志，与锁同寿
```

1. **锁与任务态必须分家**：任务态跑完还要留着给人看这一次补了多少、被裁了
   哪一段；拿它当锁的话，「上一次跑完的记录」会把下一次回填永久挡在门外。
2. **单飞靠 `SET NX` 这一次原子写**，不是「先查再插」：两个请求同时打进来时，
   先查再插会双双看见「没人占」，于是两个回填一起改写同一段历史。
3. **续锁与放锁都必须 CAS**（`Cache.renew_if_owner` / `delete_if_owner`）：自己
   那把锁可能早已过期并被下一个回填抢走（收尾重算跑得比 TTL 还久就会这样）。
   无条件续就是把别人的锁改成自己的，无条件删就是把接任者的锁一起删掉——两边
   都不会报错。续不上立刻停手；删不掉说明锁早就不是自己的了，正合适。
4. **抢到锁才清取消标志**：上一次留下的标志会把这一次刚起的回填在第一个批边界
   直接毙掉，而回执里只说「已取消」，看不出取消的是上一次。
5. **起任务时任务态落不下去，要把刚抢下的锁放掉再抛**：留着它等于让这张表的
   下一次回填白等一个 TTL，而界面上只会说「已经有一个回填在跑」——其实一个都
   没起来。
6. **进度读不出来要响亮报错**（`DatasetBackfillUnreadable`，503）：「我说不出来」
   与「什么都没有」是两个答案。混成一个的话，用户会在读不到的时候又发一次回填，
   而那一次撞上的是仍然握着锁的上一次。

### 14.7 取消是协作式的

写一个 Redis 标志，worker 在下一个批边界读到它就停。**刻意不用 `task.cancel()`**：
受理这次取消的进程未必是正在跑那个任务的进程，而进程内的取消传不过去。代价是
「等当前这批跑完」，换来的是绝不留下写了一半的批。

**取消之后照样重算**：已提交的批里公式列还空着，停在那里等于留下一批「原始值
有、公式值没有」的行，而它们在表格里与真算出空值一模一样。

进程关停是另一件事（`failed` + 「服务正在关停」）：它要让人看出「它没跑完」，
而用户按的取消是「不用跑了」。关停走 lifespan 钩子，排在 Redis 与连接池**之前**
——收摊时还要写一次终态、放一次锁。

### 14.8 三条端点

```
POST   P/dataset-tables/{tid}/backfill   起任务（202）  dataset:backfill  必须支持 Idempotency-Key
GET    P/dataset-tables/{tid}/backfill   查进度         dataset:view      没有任务时 data=null
DELETE P/dataset-tables/{tid}/backfill   取消           dataset:backfill  没有在跑的任务 404
```

- **起与查共用一个出参形状**（`BackfillJobOut`）：两个形状的话，界面要为「刚起」
  与「查回来」各写一遍渲染，而其中一份迟早跟不上另一份；
- **请求区间与实际区间两份都在**（`requested_since/until` 与 `since/until`）：
  只给实际区间的话，被裁掉的那一段在界面上无从对比；
- **幂等键**：不支持的话，客户端的一次重试撞上的是自己刚起的那个任务留下的
  单飞锁，用户看到一句莫名其妙的 409；
- 闸 1 的规则在 auth-server：974 `…/backfill` 全方法 → `dataset:backfill`，
  976 同路径 GET → `dataset:view`（后者必须压过前者，否则只想看一眼进度的人
  反而要拿到改写历史的权限）。

### 14.9 可观测

| event | 何时 | 级别 |
|---|---|---|
| `dataset_backfill_started` | 起了一个任务 | INFO |
| `dataset_backfill_finished` | 收摊（完成 / 取消 / 中止都记） | INFO |
| `dataset_backfill_failed` | 任务本体出错 | ERROR |
| `dataset_backfill_cancel_requested` | 收到取消请求 | INFO |
| `dataset_backfill_state_write_failed` | 进度没写进 Redis（数据已落库） | WARNING |
| `dataset_backfill_cancel_flag_unreadable` | 取消标志读不到，本批按未取消继续 | WARNING |
| `dataset_backfill_release_failed` | 锁没放掉，等它自己过期 | WARNING |

## 15. 保留期夜间清理

跑在 **worker 角色**里的另一条常驻循环（与聚合采集器并列），一趟扫完全部配了保留期的
台账，把过期行**真的删掉**。

⚠ **「夜间」说的是意图，不是调度器。** 这里没有 cron，只有一条带间隔的循环：它保证的是
「两次清理之间至少隔一个周期」，**不保证在哪个墙钟时刻醒来**——进程什么时候起来，节奏
就从什么时候算起。文档里不写「每天凌晨 X 点」，因为那句话是假的。

⚠ **只删台账行**（`platform.dataset_records`）。点位历史的保留期归 collector-server
管（§2 的两层分工），本模块一个字都不碰。

### 15.1 保留天数：空 = 永久，且要有两道闸

`dataset_tables.retention_days` 为 `NULL` 即**永久保留**（D7）。它绝不许被当成 0 天——
那是一次不可逆的清库。故这条判断落在**两个互相独立**的地方，任何一道单独成立都拦得住：

| 闸 | 位置 | 形态 |
|---|---|---|
| 1 | `crud/table.py::with_retention` 的 `WHERE` | `retention_days IS NOT NULL AND retention_days > 0` |
| 2 | `services/retention_run.py::keep_before`，**紧贴 DELETE** | `retention_days is None or <= 0` → 返回 `None`，这张表一条语句都不发 |

一道闸不够：删掉的行找不回来，而「少了一道闸」这件事在任何一次成功的清理里都看不出来。
第 2 道刻意收在 `keep_before` 而不是在装载清单时就把空值滤掉——提前收窄的话，两道闸会
退化成同一道。

一张表的删除边界 = `now - retention_days`；下界取**这张表最老的一行**
（`ORDER BY ts LIMIT 1`，走超表的有序追加计划，不是 `min(ts)` 的全扫）。

### 15.2 三条硬约束——都是在真库上量出来的，不是推想的

**(a) DELETE 的谓词里绝不许出现子查询。** 压缩超表上 `… IN (SELECT …)` 实测跑了 5.5 秒，
然后仍以 `tuple decompression limit exceeded` 收场。要删哪几张表必须**先 SELECT 进应用层**，
再以绑定参数下发。

> 推论：**批的单位是「哪张表、多宽的 `ts` 窗口」，不是「多少行」**——PostgreSQL 的
> `DELETE` 没有 `LIMIT`。故「这一趟不超过 N 行」做不到，能保证的只有「超了就不再发下一条」
> （§15.3 的行数预算）。

**(b) 谓词必须同时带 `ts` 的上界与下界。** 只给一侧，计划器会扫遍每一个 chunk。
两条语句逐字如下（`crud/retention.py`，形状由
`tests/contract/test_dataset_retention_sql.py` 逐条钉着）：

```sql
DELETE FROM platform.dataset_records
 WHERE table_id = :table_id
   AND ts >= :from_ts
   AND ts < :to_ts
```

```sql
SELECT public.show_chunks(
         'platform.dataset_records',
         older_than => :older_than,
         newer_than => :newer_than
       )::text AS chunk_name
```

⚠ `show_chunks` 要写**全限定**：业务写连接的 `search_path` 只有 `platform`，不限定就报
「function show_chunks(…) does not exist」——一句看着像版本不对、其实是路径不对的错。

⚠ 一批的窗口宽度取 **7 天 = `dataset_records` 的 `chunk_time_interval`**，于是一条 DELETE
基本只碰一个 chunk。**每一批各自提交**：压缩块的解压额度是**按事务**算的，攒成一个大事务
就会在某一批上撞出 `tuple decompression limit exceeded`，而前面删掉的那些跟着一起回滚。

**(c) 必须周期性 `REINDEX`。** 压缩 chunk 上的 DML 让 `index_bytes` 涨了 **29 倍**，而
`VACUUM (ANALYZE)` 一个字节都收不回来（387MB → 393MB）；只有 REINDEX 收得回（单个 chunk
23ms，回收 112MB）。

本仓的 REINDEX 口径：

- **每一趟真删过行就跑一次**，对象是本趟 DELETE 实际覆盖到的那段 chunk；不按「运行次数」
  节流——节流计数只活在进程内存里，重启比节流周期还勤的进程会**永远轮不到 REINDEX**，
  而那是一件不报错、只让索引一路涨到 29 倍的事；
- 真正的闸是**单趟 chunk 数上限（32）**与 `SET LOCAL lock_timeout = '5s'`：
  `REINDEX TABLE` 拿的是 ACCESS EXCLUSIVE 锁，**拿不到就跳过这个 chunk**，异常就地吞掉
  绝不上抛——为了回收索引把写入堵死，是拿要紧的事换不要紧的事；
- 单个 chunk 失败要 `rollback`：语句报错之后这条事务已作废，不回滚的话后面每个 chunk
  都跟着报「事务已中止」，看起来像整片 chunk 都锁着；
- chunk 名来自 PG 自己的 `show_chunks()::text`，拼进 DDL 之前先过形状白名单
  （标识符位置无法参数化，只能拼串）。

### 15.3 执行锚点：拨开开关之后必须等满一个完整周期

Redis 上一个写死不可配的键记着「上一次**真的删过**是什么时候」：

```
键：platform:dataset:retention:anchor    值：RFC3339 UTC 时刻
```

四条规则，一条一条都是为了同一件事——**「打开开关」绝不等于「立刻开删」**：

1. 开关**关着**的那一趟：把锚点**抹掉**，一行都不删；
2. 开关**开着**、锚点不存在（刚被拨开、或 Redis 丢过键）：把锚点写成此刻，**本趟不删**；
3. 开关开着、`now - 锚点 < 周期`：什么都不做，**锚点原地不动**；
4. 否则：删一趟，然后把锚点推到此刻。

⚠ 第 1 条是这一节最要紧的一行。若锚点只在「真跑过」之后推进、而关着开关的那些趟原样留着，
那么一个关了一年的库在重新拨开开关的**下一次醒来时就会立刻开删**——因为「上次执行」已经
是一年以前，而这件事没有任何一句警告。抹掉它换来的是：拨开之后总有整整一个周期的反悔余地。
这条由 `tests/unit/test_dataset_retention_loop.py` 里那条「关一年再打开」的用例钉着。

⚠ 锚点带 30 天 TTL，那只是个兜底上限而不是节奏：周期的上限是 24 小时（§15.5 的运行参数
目录钉着），故它怎么都不会先过期。真过期了就按「尚未锚定」处理——重新锚定、再等一个周期，
方向是安全的。读写一律不抛：控制面抖一下不该让清理循环崩掉。

**行数预算**：`dataset_retention_max_rows_per_run` 是一趟的实删行数上限，**只在批边界判定**
（约束 a 的推论）。触顶时提前收工、剩下的下一趟继续，并**响亮记一条 `dataset_retention_capped`**
——静默截断会让人以为保留期已经完全生效了，而其实每晚都只删掉一部分。

### 15.4 单活、隔离与关停

租约键 `platform:dataset-retention:leader`（写死不可配）。**与聚合采集那把分开**：共用一把
会让「今晚采不采」顺带决定「今晚清不清」，而两条循环的节奏差着三个量级（一分钟 vs 一天）。
⚠ Redis 不可达一律判非 leader；续不上立刻停手（renew-or-die）。

⚠ 租约 TTL（出厂 90 000 秒 = 25 小时）**必须大于清理周期的上限**（24 小时）：续期只发生在
每一趟醒来时，TTL 比周期还短就是每一趟都先把租约丢了。这条由用例钉着。

| 情况 | 行为 |
|---|---|
| Redis 不可达 / 续租失败 | 一律判非 leader，立刻停手 |
| 一张表抛异常或超时 | 记一条 `dataset_retention_table_failed`，**下一张表照常删** |
| 一个 chunk 拿不到排他锁 | 记一条 `dataset_retention_reindex_skipped`，**跳过它** |
| 回收索引整段出错 | 记一条 `dataset_retention_reindex_failed`，**清理结果不受影响** |
| 一整趟出错 | 记一条 `dataset_retention_tick_failed`，下一趟继续（绝不带走循环） |

关停顺序照 `worker.py::run_until_stopped`：**停收新活 → drain → 让租约 → 关资源**。
逐表循环每一轮开头看一眼 `stopped`，手上那张删完就不再开始下一张。硬停最多让一批过期数据
多留一个周期，**绝不会留下半张删了一半的表**——每一批各自提交，批与批之间没有任何需要
收尾的状态。

⚠ **删过行的台账要报脏**（§16）：删行同样会改这张表读出来的东西（长窗口的序列少了一截），
不报脏的表现是大屏静默停在旧数上。只报**真的掉了行**的那几张。

### 15.5 环境变量与运行参数

| 变量 | 出厂值 | 含义 |
|---|---|---|
| `PLATFORM_DATASET_RETENTION_ENABLED` | `false` | 清理总开关 |
| `PLATFORM_DATASET_RETENTION_INTERVAL_S` | `86400.0` | 清理周期（也是循环的醒来间隔） |
| `PLATFORM_DATASET_RETENTION_MAX_ROWS_PER_RUN` | `200000` | 单趟实删行数上限 |
| `PLATFORM_DATASET_RETENTION_TABLE_TIMEOUT_S` | `300.0` | 单表一趟的预算 |
| `PLATFORM_DATASET_RETENTION_LEASE_TTL_S` | `90000` | 单活租约存活期（**不是**运行参数） |

前四项都在 `dataset` 那一组运行参数里，**全是即时档**，每一趟现读（与采集那五项同一组、
同一条路由、同两个权限码，见 §13.2）。

⚠ **危险方向是「开」（`danger: on`），与采集开关恰好相反**：那一项关掉只是不再出新行，
这一项**打开**就开始按保留天数真实删除，而删掉的行找不回来。照抄另一个开关的 `danger`
等于把二次确认弹在安全的那一侧，用户会因此训练出无脑点确认的肌肉记忆。前端的
`RUNTIME_PARAM_DANGERS` 因此要多一档 `'on'`（第 8 期补前端时一并加）。

⚠ 周期的上限 24 小时是**硬的**：租约 TTL 按它算出来（§15.4）。

### 15.6 可观测

| event | 何时 | 级别 |
|---|---|---|
| `dataset_retention_run` | 这一趟删掉了行、或者有表失败 | INFO |
| `dataset_retention_table_swept` | 一张表掉了行 | INFO |
| `dataset_retention_anchored` | 拨开开关之后第一次锚定（附首次执行时刻） | INFO |
| `dataset_retention_capped` | 触到单趟行数上限，提前收工 | WARNING |
| `dataset_retention_table_failed` | 一张表这一趟没删完 | ERROR |
| `dataset_retention_reindex_skipped` | 一个 chunk 没拿到排他锁 | WARNING |
| `dataset_retention_reindex_failed` | 回收索引整段出错（清理本身已成功） | WARNING |
| `dataset_retention_chunk_rejected` | chunk 名形状不对，没拼进 DDL | WARNING |
| `dataset_retention_anchor_unreadable` / `_unwritable` | 锚点读/写不了 | WARNING |
| `dataset_retention_lease_acquired` / `_released` / `_lost` | 主的交接 | INFO / INFO / ERROR |
| `dataset_retention_tick_failed` | 一整趟出错 | ERROR |

稳态下每晚删 0 行才是正常的，故**什么都没发生的那一趟不记**——一天一条的流水会把真正
有内容的那几条埋掉。

## 16. 台账脏信号

大屏要的是「这张台账刚被写过」，不是「每 5 秒再查一遍」。写入侧往一个 Redis
集合里塞台账编码，大屏发布器按需原子取走。

```
键：platform:dataset:dirty     成员：台账 code
写入侧 SADD  ──→  发布器 SPOP（第 14 期）
```

四条决策：

1. **集合而不是列表**：一次提交改十行只该让下游取一次数。列表会让发布器白跑十遍。
2. **键写死不可配**：它是跨进程契约。让它可配等于让两份配置各认一个键，
   而现象只是「大屏不更新」——没有任何一侧会报错。
3. **报脏在事务提交之后**（`lib.db.after_commit` 登记的钩子里）。就地报脏是错的：
   提交还没落地时告诉发布器「有新数据了」，它抢先读到的是**旧值**，然后把旧值当
   新值推出去。这条错误的表现是「偶尔慢一拍」，几乎不会被怀疑到写入顺序上。
4. **报脏失败只记日志不抛**：数据已经落库了，为了一条通知把一次成功的写入变成
   500，是拿已经成功的事去赌一件本来就有兜底的事（发布器仍有兜底轮次）。

⚠ **每一条会改变这张表读出值的写入路径都要报脏**：录入 / 编辑 / 删除单行、
写与撤销人工修正、按列批量撤销、重算公式列。第 5 期的聚合采集器与第 6 期的回填
自开会话、不经请求级事务，须在自己提交之后直接调 `DatasetDirtyLog.mark`。
漏调的表现是大屏数值静默不更新，没有任何告警。

### 16.1 大屏这一侧（第 14 期）

大屏模块绑台账列，走的是**读路径**：新增第五种取数来源 `dataset`，
身份串 `ds:{台账code}:{列key}`。

四条决策：

1. **`subscribe` 一律拒绝，不做轮询。** 台账的行是采集器按周期写出来的，不是
   一条推流。前端自己起轮询会是**假的推送**：既复制了上面那套脏信号，又按
   「每个看大屏的人一份」放大——十个人看同一张大屏就是十条轮询。要现值的模块
   该绑点位。台账列的实时化等发布器那一侧接通，不在取数层伪造。
2. **身份串落在 `detailJson` 而不是 `nodeKey`。** 后者的口径写死是
   「`{sourceId}:{pointCode}`，按第一个冒号切分」，塞一个 `ds:` 串进去，
   那句注释就对五种来源里的一种是假的。
3. **拼接与解析各只有一处**（`datasetBindingKey` / `parseDatasetBindingKey`）。
   两端各写一份字面量时，写歪一个字符不会有任何报错，只是那条绑定永远取不到数
   ——而那与「台账里这一格确实是空」长得一样。
4. **线形按自身形状判别是哪一支，不看 `source_kind`。** `detail_json` 是自由
   JSONB，换过来源却没清干净取数说明时，以真正躺在里面的那个字段为准，
   比信一个可能对不上的枚举稳。

⚠ **来源集合是三处一致**：前端 `BINDING_SOURCE_KINDS`、后端
`apps/dashboard/source_kinds.py`、以及 `dashboard_bindings` 上那条 CHECK 约束。
只改前两处的话，界面配得出来而写库被拒，报的是一句没头没尾的 400。

> 发布器那一侧（SPOP 取走 + 按需推送）仍未接，故台账绑定目前只有读路径：
> 曲线取得到，现值要等推送接通。
