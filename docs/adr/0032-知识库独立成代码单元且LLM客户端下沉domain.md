---
status: accepted
date: 2026-09-01
---

# ADR-0032：知识库独立成代码单元，共享模型与对话机制进入 llmcore

`knowledge-server` 独立持有 `knowledge` schema，并以同一代码单元的 `api` 与 `worker` 角色隔离在线请求和摄取重活。它与 `ai-assistant` 互不 import、互不代理，也不形成双向同步 RPC。

两者真实共用的无状态模型调用和产品无关对话机制放在 `server/domain/llmcore`：模型适配器、回合与工具协议、SSE 事件和持久化端口。该包不含 ORM、具体提示词或业务工具；每个服务仍使用自己的 schema、会话存储、提示词和工具集。前端共享通用回合驱动，但页面语义各自维护。

本条合并原 ADR-0037；边界与部署细节见 [知识库上下文](../../server/services/knowledge-server/CONTEXT.md) 和 [llmcore](../../server/domain/llmcore/README.md)。
