---
status: accepted
date: 2026-07-14
---

# ADR-0001：前端采用 source-only pnpm workspace

可复用能力放在 `web/packages/*`，应用装配放在 `web/app`；workspace 包由应用的 Vite 构建直接编译源码，不各自发布 `dist`。依赖必须无环，`app` 是终点，包不得依赖应用或被深路径引用。

这保留单仓、单锁文件和一次构建的开发体验，同时用包边界换取独立测试与替换能力。能力只有出现真实第二个消费者后才从页面提升，现行分层见 [web 上下文](../../CONTEXT.md)。
