# timeseries —— 点位历史的共享口径

点位身份、归档列的编解码、质量位分档与宽表列名。**纯函数 + 常量**：零 ORM 模型、零 CRUD、
零依赖注入件、零 IO。

## 谁消费它

| 侧 | 用来做什么 |
|---|---|
| 采集运行时（写） | 把驱动送出的四元组编成 `value_num` / `value_text` 两列并写进宽表 |
| 平台（读） | 按 `node_key` 查历史、把两列读回一个值、下发大屏绑定 |

两个服务真实消费，这正是 [ADR-0004](../../../docs/adr/0004-server分三层且domain承载领域共享包.md)
要求的 `domain` 入场券。

## 边界

- **不许含 ORM 模型、CRUD 与 FastAPI 依赖注入件**——含了就等于两个服务共享数据库写路径，
  [ADR-0003](../../../docs/adr/0003-一库多schema且写独占读放行.md) 的写独占会静默失效。
- **不许出现服务名**：它知道"点位"是什么，不知道"谁在跑它"。
- **不许 import 别的 `domain/*` 与任何服务**，保持扁平。
- 建表的 DDL 在采集侧迁移里，读侧查询在平台里，两边引用本包的同一份列名常量——
  这样"列名改了而另一侧没改"是 import 错误，不是运行期空结果。

## 内容

| 模块 | 提供什么 |
|---|---|
| `node_key` | `compose_node_key` / `split_node_key`（按**第一个**冒号切）与 `InvalidNodeKey` |
| `value` | `split_value` / `read_value`——归档两列的编解码，往返等价 |
| `quality` | `Quality` 三档字面量联合与 `normalize_quality`（认不出判 `bad`） |
| `schema` | 宽表的 schema/表名、列名元组、主键、分区列、chunk 跨度、段键 |

口径的完整设计见 [`docs/COLLECT_DESIGN.md`](../../../docs/COLLECT_DESIGN.md) §2、§3、§6，
质量水位见 [`project-structure-python.md`](../../../docs/agents/project-structure-python.md) §9
（行覆盖 ≥ 95%、分支 ≥ 90%）。

## 本地命令

```bash
uv run --package timeseries pytest -q --cov=timeseries --cov-branch
```
