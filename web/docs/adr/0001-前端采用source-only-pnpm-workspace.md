# ADR-0001：前端采用 source-only pnpm workspace，应用壳是依赖终点

- 状态：已采纳
- 日期：2026-07-14
- 来源：从 Claude 项目 memory `web-re-refactor` 迁入；当前结构与 `docs/agents/project-structure-typescript.md` 已核对

## 背景

前端同时包含基础组件、设计令牌、权限、数据源、2D/3D 渲染、大屏模块和应用页面。全部放在应用源码下时，公共能力会反向依赖页面状态，模块之间也能通过深路径绕过公开接口；拆成各自独立构建和发布的包，又会增加版本发布、产物联调与本地开发成本。

## 决策

`web/` 使用一个 pnpm workspace：可复用能力放在 `packages/*`，应用装配放在 `app/`。workspace 包保持 source-only，由应用的 Vite 构建直接编译源码，不单独发布构建产物。

依赖保持单向无环，`app` 是终点；`packages/*` 不依赖 `app`，调用方只经包的 `exports` 公开面引用。能力从页面开始，在出现真实的第二个消费者后才提升到 `features/` 或 workspace 包，不预建“将来可能复用”的包。

## 理由与取舍

这一结构用编译期依赖边界换取可独立测试和可替换的能力模块，同时保留单仓、单锁文件和一次应用构建的开发体验。代价是包边界与依赖方向必须由结构闸持续校验；source-only 包也不能假设自身会先产出 `dist/`。
