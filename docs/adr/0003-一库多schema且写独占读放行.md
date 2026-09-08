---
status: accepted
date: 2026-08-10
---

# ADR-0003：一库多 schema，写独占、读放行

后端共享一个 PostgreSQL database，每个有状态代码单元独占自己的 schema。只有属主服务可以写入和迁移；跨 schema 只允许通过独立只读权限读取，并禁止跨 schema JOIN、外键和事务，也不共享 ORM 模型。

这在保留写隔离、迁移归属和未来分库能力的同时，避免大批量只读数据被迫绕经 HTTP。schema 与服务清单由 [微服务架构](../ARCHITECTURE_MICROSERVICES.md) 维护，ADR 不再复制易过时的库存表。
