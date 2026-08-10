# 数据库规范

适用于全部 Python 服务。数据所有权见 [ADR-0003](../adr/0003-一库多schema且写独占读放行.md)，迁移链的组织见 [`project-structure-python.md`](project-structure-python.md) §8。

数据库是系统里**唯一不能回滚的东西**。代码发错了可以重新部署，迁移执行错了、类型选错了、时区存错了，都要靠数据修复来收拾，而数据修复本身又是一次高风险操作。因此这份规范比其它几份更接近"硬性规定"而非"约定"。

---

## 1. 命名

| 对象 | 约定 | 例 |
|---|---|---|
| schema | 服务名去掉 `-server` | `auth` `platform` `collect` `realtime` `assistant` |
| 表 | `<域前缀>_<复数名词>`，snake_case | `dt_dashboards` `ds_records` `opcua_nodes` |
| 列 | snake_case，不带表名前缀 | `created_at`，不是 `dashboard_created_at` |
| 布尔列 | `is_` / `has_` 前缀 | `is_enabled` `has_children` |
| 时间列 | `_at` 后缀（时刻）/ `_on`（日期） | `created_at` `effective_on` |
| 外键列 | `<单数被引表>_id` | `dashboard_id` |
| 主键约束 | `pk_<表>` | `pk_dt_dashboards` |
| 外键约束 | `fk_<表>_<列>` | `fk_dt_bindings_dashboard_id` |
| 唯一约束 | `uq_<表>_<列…>` | `uq_ds_records_table_id_row_key` |
| 检查约束 | `ck_<表>_<语义>` | `ck_ds_columns_kind_valid` |
| 索引 | `ix_<表>_<列…>` | `ix_dt_bindings_node_id` |

⚠ **约束与索引必须显式命名**。让 alembic autogenerate 生成随机名的后果是：将来的迁移无法可靠地引用它（`op.drop_constraint` 需要名字），而不同环境生成的名字可能不同，于是同一份迁移在测试环境能跑、生产跑不了。

在 ORM 声明基类里配置命名约定（`MetaData(naming_convention=...)`），让它自动成立，而不是靠每个人记得写 `name=`。

---

## 2. 每张表的必备结构

```python
id          UUID        primary key          # 见 §2.1
created_at  timestamptz not null default now()
updated_at  timestamptz not null default now()   # 由 ORM 或触发器维护
```

### 2.1 主键类型

**默认用 UUID（v7 优先，退而 v4）**，理由：多服务、多副本并发写入时不需要中心化取号；对外暴露的 id 不泄漏业务量（自增 id 会告诉竞争对手你有多少个客户）。

选 v7 是因为它**按时间前缀有序**，B-tree 插入是追加而不是随机页分裂——v4 在大表上会显著推高写放大与索引膨胀。

例外：**点位历史这类超大追加表用 `bigint` 自增或干脆无代理主键**（以 `(node_key, ts)` 为主键），UUID 在十亿行量级的空间与索引代价不划算。

⚠ 内容寻址的 id 用 **`uuid5`**（确定性），不是 `uuid4`——它让"同一份输入重复导入"天然幂等，这是内置数据播种与跨环境同步的基础。

### 2.2 软删

**默认不做软删**。要做时用 `deleted_at timestamptz null`，且必须同时满足：

- 所有查询默认过滤 `deleted_at IS NULL`——由一处统一的查询基类保证，不靠每个人记得加条件；
- 唯一约束改为**部分唯一索引**（`WHERE deleted_at IS NULL`），否则删掉的行会永久占用唯一值；
- 有明确的最终清理策略。

⚠ 软删是那种"加起来很容易、去掉极难"的决定。除非有明确的恢复或审计需求，否则真删 + 审计日志（见 [`observability.md`](observability.md) §8）更简单也更诚实。

---

## 3. 类型口径

| 用途 | 类型 | 禁止 |
|---|---|---|
| 时刻 | `timestamptz`，**存 UTC** | `timestamp`（无时区）——一旦落库就再也说不清它是哪个时区的 |
| 日期 | `date` | 用字符串存日期 |
| 精确小数（台账值、金额、公式结果） | `numeric(p,s)`，精度显式 | `float`/`double`——0.1 无法精确表示，累加漂移 |
| 测量值（点位实时值/历史值） | `double precision` | —— |
| 枚举 | `varchar` + `CHECK` 约束，或应用层枚举 | **原生 `ENUM` 类型**——加值要迁移、删值几乎不可能、改序静默改语义 |
| 标识 | `uuid` | 用 `varchar` 存 UUID（占三倍空间且无类型校验） |
| 结构化附加数据 | `jsonb` | `json`（不可索引）、`text` 存 JSON |
| 文本 | `text` | `varchar(n)` 除非真有业务上限——PG 里两者性能相同，长度限制只带来迁移麻烦 |

### 3.1 JSONB 的使用规则

`jsonb` 用于**形状会演进、且不作为主要查询维度**的数据（大屏配置、模块参数、算子入参）。

三条硬约束：

1. **必须有应用层 schema 校验**（Pydantic），写入前校验。`jsonb` 不是"什么都能塞"的借口。
2. **不许把关系放进 jsonb**：外键关系用真正的列和外键约束，否则删除守卫、级联、引用完整性全部失效。
3. **需要按某个内部字段频繁过滤时，把它提升为真正的列**（可以冗余存储），而不是给 jsonb 加一堆表达式索引。

---

## 4. 索引

- **每个外键列必须有索引**。PG 不会自动建，而缺它会让父表的删除操作全表扫子表。
- 复合索引的**列序按选择性从高到低**，且要匹配实际查询的前缀。
- 只查一部分行时用**部分索引**（`WHERE is_enabled`），比全量索引小得多。
- 大表加索引**必须 `CONCURRENTLY`**（见 §5.4）。
- 索引不是越多越好：每个索引都是一份写放大。**新增索引要能说出它服务于哪条具体查询**。

---

## 5. 零停机迁移

这是本文的核心。默认前提：**迁移执行时，旧版本代码仍在运行**（滚动发布期间新旧副本并存）。因此任何迁移都必须让**新旧两版代码同时可用**。

### 5.1 扩展—收缩模式

所有结构变更拆成两次发布：

```
发布 N   ： 扩展（加新结构，新旧代码都能跑）
           ↓  双写 / 回填 / 切读
发布 N+1 ： 收缩（删旧结构）
```

绝不允许一次发布里既加新的又删旧的——那中间必然有一段时间某一版代码是坏的。

### 5.2 逐项操作规则

| 操作 | 做法 |
|---|---|
| **加列** | 必须**可空**或带**非 volatile 默认值**。带 volatile 默认（如 `now()`、`gen_random_uuid()`）会重写全表并持有 ACCESS EXCLUSIVE 锁 |
| **删列** | 两步：先发布不再引用该列的代码 → 下个发布再 `DROP COLUMN` |
| **改列名** | **禁止**。用「加新列 → 双写 → 回填 → 切读 → 删旧列」四次发布完成 |
| **改类型** | 同改名。原地 `ALTER TYPE` 会重写全表并锁表 |
| **加 NOT NULL** | 三步：`ADD CONSTRAINT ck CHECK (col IS NOT NULL) NOT VALID` → `VALIDATE CONSTRAINT`（只取 SHARE UPDATE EXCLUSIVE 锁）→ `SET NOT NULL` → 删除临时 CHECK |
| **加唯一约束** | 先 `CREATE UNIQUE INDEX CONCURRENTLY` → 再 `ALTER TABLE ADD CONSTRAINT … USING INDEX` |
| **加外键** | `ADD CONSTRAINT … NOT VALID` → 稍后 `VALIDATE CONSTRAINT`，避免全表校验期间锁住写入 |
| **加索引** | `CREATE INDEX CONCURRENTLY`（注意：它不能在事务里跑，见 §5.4） |
| **删表** | 先改名为 `_deprecated_<原名>` 观察一个发布周期，确认无访问再删 |

### 5.3 数据回填不进迁移

**迁移文件里禁止写长事务的数据回填**（`UPDATE` 全表、`INSERT … SELECT` 大量行）。它会：持锁到迁移结束、把迁移时长变成不可预测、失败后回滚代价巨大、且无法中断续跑。

回填走**独立的批处理任务**（platform 的 `worker` 角色），分批提交、可中断、可重入、有进度日志。迁移只负责结构。

### 5.4 执行期的自我保护

每个迁移的开头设置超时，防止它排在一个长事务后面把整张表的访问堵死：

```python
def upgrade() -> None:
    op.execute("SET lock_timeout = '3s'")
    op.execute("SET statement_timeout = '60s'")
    ...
```

⚠ `lock_timeout` 不是可选项：一个拿不到锁的 `ALTER TABLE` 会**排队**，而排在它后面的所有普通查询也会一起排队——单个迁移语句就能把一张热表的全部访问冻住。宁可迁移失败重试，不可全站等待。

⚠ `CREATE INDEX CONCURRENTLY` **不能在事务块内执行**。alembic 默认每个迁移一个事务，需要该迁移单独设置 `autocommit`（`with op.get_context().autocommit_block():`）。它还可能失败后留下**无效索引**，迁移里要先 `DROP INDEX IF EXISTS` 再建。

### 5.5 可逆性

- 每个迁移都要有 `downgrade`，且 CI 跑 `upgrade → downgrade → upgrade`（见 [`testing-standard-python.md`](testing-standard-python.md) §9）。
- **不可逆的迁移**（删列、缩窄类型）必须在 `downgrade` 里显式 `raise` 并写明原因，不许留一个假装能回滚的空实现——假的可逆性比明确的不可逆更危险。
- 迁移前的备份点由部署流程保证，不由迁移自己负责。

### 5.6 多 schema 的迁移边界

每个服务的 alembic 绑定自己的 `version_table_schema`，只操作自己的 schema。

⚠ **一个服务的迁移里出现另一个 schema 的名字，即为设计错误**——它意味着写权限越界。这条要由 CI 扫描迁移文件执行。

---

## 6. 事务边界

| 规则 | 说明 |
|---|---|
| **一个 HTTP 请求一个事务**，由依赖注入统一开启与提交 | 业务代码不自己 `commit()` |
| **service 层是事务边界的主人**，crud 层不提交 | crud 只做数据访问，谁调用谁决定边界 |
| **事务里禁止外部 IO** | HTTP 调用、对象存储上传、发消息——它们的耗时不可控，会把数据库连接与锁一起长期占住 |
| **提交后的副作用用钩子** | 发通知、推 WebSocket、投递队列任务，必须在事务**提交成功之后**执行 |

⚠ 最常见的错误是"为了先拿到 id 而提前 commit，再继续做后续操作"。这会让一次逻辑操作变成两个事务：前半段已经落库、后半段失败，数据处于中间态且没有任何回滚手段。**要拿 id 用 `flush()`，不是 `commit()`。**

⚠ 第二常见的是在事务里投递队列任务：消费者可能在事务提交前就拿到任务，读到的却是尚未提交的数据——这是一个**取决于调度时机的间歇性 bug**，最难复现。

---

## 7. 查询规则

- **禁止 N+1**：关联数据用 `selectinload` / `joinedload` 显式加载。核心路径要有断言 SQL 次数不随结果集增长的测试。
- **一切列表查询必须分页**，没有例外。`SELECT * FROM t` 在开发环境永远很快。
- **禁止在查询里做本可以在数据库外做的循环**：`for id in ids: get(id)` 一律改成 `WHERE id = ANY(:ids)`。
- **跨 schema 只读查询**要用只读连接（见 ADR-0003），并对被读的表建契约测试锁住列口径。
- 长查询设 `statement_timeout`，避免一个慢查询拖垮连接池。
- **连接池上限按服务配置**并监控，所有服务的上限之和必须小于实例的 `max_connections`。

---

## 8. TimescaleDB 专项

点位历史是超表，规则与普通表不同：

| 项 | 约定 |
|---|---|
| 分区间隔 | 按写入速率选，目标是**单个 chunk 能装进内存**（经验值：一周或一天） |
| 主键 | 时间列必须在主键/唯一约束里，否则无法建超表 |
| 压缩 | 超过热区（如 7 天）的 chunk 自动压缩；**压缩后的 chunk 不可直接 UPDATE/DELETE**，改数据要先解压 |
| 保留 | 保留策略显式配置，且**默认关闭**——静默删除历史数据是不可逆的 |
| 连续聚合 | 用于固定粒度的高频查询；它有刷新延迟，**不能用于"必须看到最新一秒"的场景** |
| 迁移 | 对超表的 DDL 会作用到全部 chunk，代价随数据量增长。加列同样遵守 §5.2 |

⚠ 归档写入是**批量 + 幂等**的：以 `(node_key, ts)` 为冲突键 `ON CONFLICT DO NOTHING/UPDATE`，让重复投递不产生重复行。采集侧的重试、leader 切换、消费者重启都会造成重复投递，幂等是唯一的防线。

---

## 9. 反模式

- **`timestamp` 不带时区**：落库即失去口径，事后无法修复。
- **原生 `ENUM`**：改一次值就是一次锁表迁移。
- **迁移里回填全表**：把发布时长变成不可预测，失败还难以续跑。
- **改列名 / 原地改类型**：滚动发布期间必然有一版代码是坏的。
- **提前 `commit()` 拿 id**：把一次操作切成两个事务。
- **在事务里投递队列任务或发 HTTP**：间歇性读到未提交数据。
- **靠应用层保证唯一性**（先查再插）：并发下必然重复，唯一约束才是唯一可靠的手段。
- **给 jsonb 里的关系加表达式索引**，而不是把它提升为真正的列与外键。
- **一个服务的迁移动别的 schema**：写权限越界，见 §5.6。
</content>
