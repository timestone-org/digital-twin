---
status: accepted
date: 2026-08-10
---

# ADR-0004：后端按 services → domain → lib 分层

`server/` 的依赖方向固定为 `services → domain → lib`。`lib` 只放零项目名词的通用基础设施，产品差异靠参数注入；`domain` 可含领域词，但不得含服务名、ORM、CRUD 或依赖注入，包之间保持扁平，且只有已有至少两个服务真实消费时才能进入。

通用鉴权头解析、闸 2 装配和幂等存储因此归 `lib`，跨服务领域形状归 `domain`，各服务保留薄绑定、事务和持久化。现行目录与机械约束见 [Python 项目结构](../agents/project-structure-python.md) 与 [lib README](../../server/lib/README.md)；本条合并原 ADR-0018。
