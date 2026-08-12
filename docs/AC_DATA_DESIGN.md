# 空调数据面设计

本文是「空调原始数据查看」这一期的实现规格。口径以本文为准，与既有规范冲突时
以 `docs/agents/` 下的规范为准并在此注明例外。

架构决策见 [ADR-0006](adr/0006-空调原始数据由平台直读外部EMS库.md)。

---

## 1. 通用语言

在 [platform-server CONTEXT §1](../server/services/platform-server/CONTEXT.md)
的车间 / 房间 / 空调 / 序号之上，本期新增四个词：

| 词 | 指什么 | 不叫什么 |
|---|---|---|
| **数据集** `dataset` | 一台空调可看的一类数据。本期只有一个：`raw_minute`（原始分钟数据） | 不叫数据源 / 表 |
| **数据源对象** `source_object` | 外部 EMS 库里承载某个数据集的那个视图名，例如 `KTStartData_K01` | 不叫表名 / 视图 |
| **绑定** `binding` | 「这台空调的这个数据集，读那个对象」这条对应关系 | 不叫关联 / 映射 |
| **指标** `metric` | 数据集里的一个可读量，例如 `workshop_temp_avg` | 不叫字段 / 列 / 点位 |
| **达标范围** `metric limit` | 一台空调某个指标的上下限，用于后期判定是否达标 | 不叫阈值 / 报警线 |

**`dataset` 是本期唯一的扩展轴。** 以后要看别的数据（能耗、报警、开停机记录），
是往数据集目录里加一项，而不是加一个页面。

---

## 2. 外部数据源的既有事实

2026-08-12 实测于 `EMS5.2`（Microsoft SQL Server 2019 15.0.2000.5）。这些是**外部
既成事实**，不是我们的设计，改不动，只能适配。

- 基表 `KTkgj`：401 列（`Ct` + `F1`…`F400`），主键是 `Ct` 的**聚簇索引**。
- 每台空调一个视图 `KTStartData_<device_id>`，把连续 19 个 `F` 列改名成有语义的列。
  第 n 台的温度列是 `F(1 + 19×(n−1))`：K01→`F1`、K02→`F20`、K09→`F153`、K17→`F305`。
- 在用的是 `K01`…`K17` 共 **17 个**；数据自 2023-01-01 起，每视图 1,898,978 行。
- **采样周期恰好 60 秒**（近 3000 行的相邻间隔全部是 60 s）。
- `CT` 是 `datetime`、`NOT NULL`、**全表无重复**（行数 == distinct 数）。
- 19 个指标列全是 `float(53)`、**全部可空**。
- 厂商自己的空调台账在 `KTInfo` 表：`device_id` / `Caption` / `workshop_name`。
  ⚠ 它的文本字段带尾随 `\r`，取用前必须 `strip()`。

### 2.1 三个必须绕开的坑

1. **`CT` 是 naive 的本地时（Asia/Shanghai），不是 UTC。** 库里没有时区信息。
   我们的对外口径一律 UTC（[api-contract §6](agents/api-contract.md)），因此
   适配层进出两个方向都要换算，且换算基准必须是配置项而不是硬编码。
2. **`KTStartData%` 这个前缀里混着非时序视图。** `06A699` / `6D139C` / `D5A3FA`
   只有 4 列且没有 `CT`。可绑定对象的发现**按列形状过滤**，不按名字。
3. **`fan_frequency` 为 `NULL` 不等于 0。** 兄弟项目把 NULL 折成 `0.0`（当作停机），
   于是数据断档会被读成一次停机 + 一次开机。本期是原始数据查看，**NULL 一律保持
   NULL 原样透出**，不补零、不插值。

---

## 3. 我们自己的数据（`platform` schema）

两张新表，都是扩展步，不动既有表。

### 3.1 `hvac_ac_data_bindings`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | `uuid` | pk，UUIDv7 |
| `ac_unit_id` | `uuid` | not null，fk → `platform.hvac_ac_units.id` |
| `dataset` | `text` | not null，`ck` 限定在数据集目录内 |
| `source_object` | `text` | not null，`ck length between 1 and 128` |
| `created_at` / `updated_at` | `timestamptz` | not null default now() |

- `uq_hvac_ac_data_bindings_ac_unit_id_dataset`：一台空调的一个数据集只能绑一个对象。
- `ix_hvac_ac_data_bindings_ac_unit_id`：外键列索引。
- ⚠ **不加 `source_object` 的唯一约束**：两台空调绑同一个视图是运维过渡期的常态，
  拦下来只会让人绕道改数据。

### 3.2 `hvac_ac_metric_limits`

| 列 | 类型 | 约束 |
|---|---|---|
| `id` | `uuid` | pk，UUIDv7 |
| `ac_unit_id` | `uuid` | not null，fk → `platform.hvac_ac_units.id` |
| `metric` | `text` | not null，`ck` 限定在指标目录内 |
| `lower_limit` | `numeric(8,2)` | **可空** |
| `upper_limit` | `numeric(8,2)` | **可空** |
| `created_at` / `updated_at` | `timestamptz` | not null default now() |

- `uq_hvac_ac_metric_limits_ac_unit_id_metric`。
- `ck_hvac_ac_metric_limits_bounds_ordered`：
  `lower_limit IS NULL OR upper_limit IS NULL OR lower_limit <= upper_limit`。
- `ck_hvac_ac_metric_limits_bounds_not_both_null`：`lower_limit IS NOT NULL OR upper_limit IS NOT NULL`
  ——两端都不限的那条记录没有意义，不如不存。
- ⚠ **单边为空表示该侧不限制**，不表示 0。本期界面只配 `workshop_temp_avg` 与
  `workshop_humidity_avg` 两项，但表结构按「指标 → 上下限」存，加指标不改表。

---

## 4. 数据集与指标目录

代码里的常量表，不是数据库表——它描述的是外部库的形状，随代码走版本。
位置：`apps/hvac/datasets.py`。

```
DATASET_RAW_MINUTE = "raw_minute"
```

19 个指标按 `key / 中文名 / 单位 / 分组` 登记，分组用于前端把温度类与湿度类分到
两条 Y 轴：

| 分组 `group` | 指标 |
|---|---|
| `temperature`（℃） | `workshop_temp_avg` `ac_temp_setpoint` `fresh_air_temp` `supply_air_temp` `return_air_temp` `mixed_air_temp` `chilled_water_supply_temp` `heat_steam_temp` `humidify_steam_temp` |
| `humidity`（%） | `workshop_humidity_avg` `ac_humidity_setpoint` `fresh_air_humidity` `supply_air_humidity` `return_air_humidity` `mixed_air_humidity` |
| `pressure`（kPa） | `chilled_water_supply_pressure` `heat_steam_pressure` `humidify_steam_pressure` |
| `frequency`（Hz） | `fan_frequency` |

**可配达标范围的指标**本期是 `workshop_temp_avg` 与 `workshop_humidity_avg` 两项，
由目录里的 `is_limitable: bool` 标出，界面据此渲染，不在前端硬编码。

**折线图默认指标**：`workshop_temp_avg` `workshop_humidity_avg`
`ac_temp_setpoint` `ac_humidity_setpoint`，由 `is_charted_by_default: bool` 标出。

⚠ 两个布尔字段的 `is_` 前缀是硬要求（`check_python_naming` 会拦下不带前缀的
写法），对外的 JSON 字段名与它们逐字相同。

---

## 5. 对外接口

全部挂在 `/api/v1/platform` 下，读 `ac:view`、写 `ac:manage`——沿用既有的两个权限码，
不新增。边缘的路由规则已按方法兜住 `/api/v1/platform/*`，无需改 auth-server。

### 5.1 目录

```
GET /ac-datasets
→ data: { items: [ { key, name, description,
                     metrics: [ { key, name, unit, group, is_limitable, is_charted_by_default } ] } ] }
```
前端的数据集页签与指标选择器都从这里渲染。**这是本期的扩展点**：加一个数据集，
前端不用改。

### 5.2 可绑定的数据源对象（发现）

```
GET /ac-datasets/{dataset}/source-objects        权限：ac:manage
→ data: { items: [ { name, caption, row_count_hint } ] }
```
实现：查外库 `INFORMATION_SCHEMA.COLUMNS`，用
`GROUP BY TABLE_NAME HAVING COUNT(DISTINCT COLUMN_NAME) = 20` 只返回**同时具备 `CT`
与全部 19 个指标列**的对象；`caption` 从 `KTInfo` 按对象名末段的 `device_id` 关联取
（取不到给 `null`），取用前 `strip()`。
⚠ 不按 `KTStartData%` 过滤——见 §2.1 第 2 条。

⚠ `row_count_hint` **恒为 `null`**：可绑定的都是视图，SQL Server 不为视图存行数统计，
真去数一次就是一次 190 万行的全扫描。字段留在契约里，等有便宜的估算来源再填。

⚠ 这条 GET 要 `ac:manage`，而边缘的闸 1 只按方法兜（`GET` → `ac:view`），故它是全仓
唯一一处**闸 2 严于闸 1** 的端点。方向是安全的，但反过来会是静默的越权洞，因此它
登记在 `tests/contract/test_route_matrix.py` 的 `STRICTER_THAN_GATE_ONE` 表里，另有
两条断言守着「只许收紧到 `ac:manage`」与「必须指向真实存在的路由」。

### 5.3 绑定

```
GET    /ac-units/{ac_unit_id}/data-bindings              → data: { items: [ Binding ] }
PUT    /ac-units/{ac_unit_id}/data-bindings/{dataset}    → data: Binding      幂等
DELETE /ac-units/{ac_unit_id}/data-bindings/{dataset}    → 204                幂等
```
`Binding = { dataset, source_object, created_at, updated_at }`。

`PUT` 的入参 `{ source_object }`。写入前**三道校验**，缺一不可：

1. 白名单正则 `re.fullmatch(r"[A-Za-z0-9_]{1,128}", value)`。
   ⚠ 用 `fullmatch` 不用 `match`：`$` 在 Python 里也匹配结尾换行，`"K01\n"` 会漏过。
   ⚠ 不放行 `-`：它不是合法的裸 T-SQL 标识符。
2. 在外库 `INFORMATION_SCHEMA` 里确实存在，且**列形状符合数据集要求**。
3. 拼进 SQL 时一律用方括号引用 `[KTStartData_K01]`。

三道都过不了 → `422`，错误码见 §7。

### 5.4 达标范围

```
GET /ac-units/{ac_unit_id}/metric-limits   → data: { items: [ MetricLimit ] }
PUT /ac-units/{ac_unit_id}/metric-limits   → data: { items: [ MetricLimit ] }   幂等·覆盖式
```
`MetricLimit = { metric, lower_limit: string|null, upper_limit: string|null }`。

⚠ **上下限是精确小数，按 [api-contract §6](agents/api-contract.md) 序列化成
JSON 字符串**（`"20.00"`），不是数字。前端禁止 `Number()` 后再做算术。

`PUT` 是覆盖式：请求里没出现的指标视为清除。两端都为 `null` 的条目按「不配置」
处理，直接删除该行而不是存一行空记录。

### 5.5 原始数据（表格，游标分页）

```
GET /ac-units/{ac_unit_id}/raw-samples
    ?from=<RFC3339>&to=<RFC3339>&after=<cursor>&limit=<1..200>
→ data: { items: [ { ts, <19 个指标>: number|null } ], next: string|null, has_more: bool }
```

- `from` / `to` **必填**，UTC RFC3339，闭开区间 `[from, to)`。
- `to - from` 上限 **31 天**，超了 `422`——不给一个能拉全表的入口。
- `limit` 默认 100、上限 200（[api-contract §5.2](agents/api-contract.md)）。
- **不返回 `total`**：算 190 万行表的区间计数要 69 ms，而游标翻页本身只要 5 ms，
  为一个用不上的数字把每次翻页拖慢十几倍不划算。
- 游标 `next` 是 base64 的 `{"ts": "<最后一行的 UTC RFC3339>"}`，客户端不许解析。
  ⚠ 因为 `CT` 无重复（§2），游标只需锚点不需去重序号；这条依赖写进契约测试，
  外库若哪天出现重复时间戳会红。

SQL 形状（`[obj]` 已按 §5.3 校验并引用）：

```sql
SELECT TOP (:row_limit) [CT], <19 列>
FROM [obj]
WHERE [CT] >= :anchor AND [CT] < :range_end
ORDER BY [CT] ASC
```
`anchor` = 游标里的时刻 + 1 秒（`CT` 精度到分钟，加 1 秒即可严格前进且不漏行），
首页时 `anchor = from`。多取一行判 `has_more`。

**禁止 `OFFSET`**：实测 `OFFSET 400000` 是 594 ms，游标式是 5 ms。

### 5.6 聚合序列（折线图）

```
GET /ac-units/{ac_unit_id}/raw-series
    ?from=&to=&metrics=<逗号分隔>&max_points=<100..2000，默认 1000>
→ data: { interval_minutes: number, metrics: [...],
          points: [ { ts, values: { <metric>: number|null } } ] }
```

- `interval_minutes` 由服务端按 `ceil((to-from)/max_points)` 向上取到档位
  `[1,5,10,15,30,60,120,360,720,1440]`，并**在响应里回显**
  （[api-contract §6.1](agents/api-contract.md)：聚合口径必须回显）。
- 桶内用 `AVG`，`NULL` 不参与平均；整桶全 `NULL` 则该指标给 `null`。
- `metrics` 必须是目录白名单内的 key，最多 8 个；越界 `422`。
- `to - from` 上限 **366 天**。

SQL 形状：

```sql
SELECT DATEADD(minute,
               (DATEDIFF(minute, '2000-01-01', [CT]) / :bucket_minutes)
                 * :bucket_minutes,
               '2000-01-01') AS bucket_ts,
       AVG([<metric>]) AS [<metric>], ...
FROM [obj] WHERE [CT] >= :range_start AND [CT] < :range_end
GROUP BY DATEDIFF(minute, '2000-01-01', [CT]) / :bucket_minutes
ORDER BY bucket_ts ASC
```
⚠ 用 `DATEDIFF` 不用 `DATEDIFF_BIG`：以 2000-01-01 为原点，分钟差到 2026 年约
1.4×10⁷，离 `int` 上限很远，而 `DATEDIFF` 的兼容性更宽。

`interval_minutes` 出参是 `PositiveInt`（openapi 里带 `exclusiveMinimum: 0`）：
0 分钟的桶没有意义，把它写进契约比留给读的人猜好。

---

## 6. 时区

**外库是 naive 的 Asia/Shanghai，对外一律 UTC。** 换算只在适配层一处发生：

- 入参：UTC → 源时区 → 去掉 tzinfo → 绑定为参数。
- 出参：naive → 附上源时区 → 转 UTC → `format_rfc3339`。

源时区是配置项 `PLATFORM_ACSOURCE_TIMEZONE`，默认 `Asia/Shanghai`。它是**取值差异
不是行为差异**，允许有默认值（非密钥类）。

⚠ Asia/Shanghai 自 1991 年起无夏令时，故不存在歧义时刻。换成有 DST 的时区时，
这条前提失效，必须补歧义处理——这行注释就是那个提醒。

---

## 7. 错误码

沿用空调域 `16`，接在既有 `41601`–`41608` 之后：

| 码 | HTTP | 含义 |
|---|---|---|
| `41609` | 404 | 数据集不存在 |
| `41610` | 404 | 这台空调没有绑定该数据集 |
| `41611` | 422 | 数据源对象名不合法或在外库中不存在 |
| `41612` | 422 | 数据源对象的列形状与数据集不符 |
| `41613` | 422 | 查询区间不合法（缺失、倒置、超出上限） |
| `41614` | 422 | 指标不在目录内 |
| `41615` | 422 | 游标不可解析 |
| `51601` | 503 | 外部数据源不可用（`is_retryable = True`） |

⚠ 闸门 `check_error_codes` 要求码的首位与 HTTP 状态首位一致，故 503 用 `5` 开头。

---

## 8. 运行时

- **超时**：登录 5 s、查询 15 s。落在
  [runtime-resilience §3.1](agents/runtime-resilience.md) 的「报表/聚合类 30 s，且
  用独立连接配置」一档，且 15 s < 边缘的 25 s 预算。
- **不重试**。一条链路只有一层负责重试，而这条链路上没有任何一层在重试；只读查询
  失败直接抛。
- **异常收敛**：驱动异常一律包成 `51601`，不裸露给上层
  （[runtime-resilience §1](agents/runtime-resilience.md)）。
- **就绪探针不含 EMS**（ADR-0006）。启动自检会 ping 一次并记日志，但**不阻断启动**。
- **降级方向：fail-closed，不返回陈旧数据**，故不需要陈旧标注。
- **日志**：每次取数的路由、状态与耗时由 `lib.web` 的访问日志中间件统一出，本模块
  不再为每条查询另记一条同义事件。模块自己的稳定字面量只有启动自检的
  `ac_source_selfcheck_passed` / `ac_source_selfcheck_failed`，与绑定变更的
  `ac_data_binding_set` / `ac_data_binding_cleared`。
  ⚠ 连接串与口令绝不进日志，只记 `host` 与 `database`
  （[observability §2.4](agents/observability.md)）。

## 9. 前端

- `@dt/ui` 补两件：`DtDateTimeInput`（值口径是 UTC RFC3339，显示按本地）与
  `DtLineChart`（echarts，**动态 import**，`onUnmounted` 里 `dispose()`）。
  ⚠ echarts 在 `check_bundle_budget.HEAVY` 里，进首屏 chunk 即红灯。
- 新页 `app/src/pages/Hvac/AcData/`，路由 `/hvac/ac-units/:acUnitId/data`，
  `meta.permissions = [acView]`。它是详情页、**不进 `NAV_ITEMS`**，靠 `AppShell`
  的 `backTo` 回台账。
- 台账页 `pages/Hvac/Units/`：行操作加「查看数据」，另加一个「数据与达标」弹窗
  （绑定 + 上下限）。⚠ `index.vue` 已 208 行，SFC 上限 300 行，新逻辑一律放
  page-private 组件与 composable。
- 取数竞态：时间段切换是
  [code-style-typescript §7.1](agents/code-style-typescript.md) 点名的快速切换场景，
  表格与图表两条取数路径都必须防竞态，且各要一条乱序返回的用例。
- 本期**不在图上画达标带**，达标范围只做配置与存储。

## 10. 本期有意没做

- **不落地、不缓存、不同步**（ADR-0006）。
- **不做跨空调聚合**（全场达标率之类）——那要逐台查外库 17 次，等有真实需求再说。
- **不在图表上体现达标范围**，只存不画。
- **不导入 `KTInfo` 的空调清单**：我们的台账是我们自己的，`KTInfo` 只在绑定下拉框里
  提供一个 `caption` 帮人认位置。
