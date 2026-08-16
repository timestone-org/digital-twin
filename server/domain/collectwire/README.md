# collectwire —— 采集控制面的跨进程线形

采集计划的形状、命令总线的信封、快照的键与字段、运行态表的表名与列名。
**常量 + pydantic 形状**：零 ORM 模型、零 CRUD、零依赖注入件、零 IO。

## 为什么要有它

platform 与 collector 之间有四条真实的缝。它们不能靠 import 彼此的代码维系
（服务之间不许互相 import），此前只能两侧各写一份口径，再拿"读对方源码做正则
比对"的测试把两份复述钉在一起。

这类漂移的共同点是**静默**：

| 缝 | 漂了会怎样 |
|---|---|
| 采集计划 | 消费侧 `extra="ignore"` 且字段带缺省——少发一个字段既不报错也不 422，只让该点位按缺省跑 |
| 命令总线 | 键名或动作名对不上，每一次命令都白等到超时 |
| 快照 | 字段名对不上，发布循环"什么都读不到"，与"现在确实没有值"分不开 |
| 运行态 | 列名对不上，配置页上每个数据源都显示"还不知道"，与"采集进程没起来"分不开 |

两个服务真实消费，这正是
[ADR-0004](../../../docs/adr/0004-server分三层且domain承载领域共享包.md)
要求的 `domain` 入场券；把这四条缝收成模块的理由见
[ADR-0017](../../../docs/adr/0017-采集控制面的跨进程线形收进domain共享包.md)。

## 谁消费它

| 侧 | 用来做什么 |
|---|---|
| 平台（api 角色） | 构建并下发计划、发命令等应答、读快照与运行态 |
| 采集运行时 | 解析计划、消费命令回应答、写快照与运行态 |

## 边界

- **不许含 ORM 模型、CRUD 与 FastAPI 依赖注入件**——含了就等于两个服务共享数据库写路径，
  [ADR-0003](../../../docs/adr/0003-一库多schema且写独占读放行.md) 的写独占会静默失效。
- **不许出现服务名**：它知道"采集计划"是什么，不知道"谁在跑它"。
- **不许 import 别的 `domain/*` 与任何服务**，保持扁平。本包因此只给不带 schema
  前缀的表名——schema 名是各服务自己的配置，点位历史的口径在 `domain/timeseries`。
- **不为未来协议预留字段**（ADR-0011）：形状只覆盖 OPC UA 今天需要的能力。

## 内容

| 模块 | 提供什么 |
|---|---|
| `plan` | `CollectPlan` / `PlanSource` / `PlanPoint`、采样周期下限、两种读模式 |
| `commands` | 请求与应答键、`reply_key`、动作与状态字面量、采集侧回的稳定 `reason` |
| `snapshot` | 快照键前缀、`snapshot_key`、哈希值里的三个字段名 |
| `state` | 运行态表名与列名、三档状态、三档错误分类 |

设计口径见 [`docs/COLLECT_DESIGN.md`](../../../docs/COLLECT_DESIGN.md) §4、§5，
质量水位见 [`project-structure-python.md`](../../../docs/agents/project-structure-python.md) §9
（行覆盖 ≥ 95%、分支 ≥ 90%）。

## 本地命令

```bash
uv run --package collectwire pytest -q --cov=collectwire --cov-branch
```
