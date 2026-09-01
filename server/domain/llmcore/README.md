# llmcore

OpenAI 兼容端点的调用面。**零项目名词**——把这个目录整个拷进一个完全无关的
新项目里仍然成立。

两个消费方：`ai-assistant`（对话、看图、折叠摘要、订阅账号那一路）与
`knowledge-server`（嵌入、agentic 检索策略）。domain 的入场券正是「≥2 个服务
真实消费」（[ADR-0004](../../../docs/adr/0004-server分三层且domain承载领域共享包.md)、
[ADR-0032](../../../docs/adr/0032-知识库独立成代码单元且LLM客户端下沉domain.md)）。

## 它管什么

| 文件 | 管什么 |
|---|---|
| `endpoints.py` | 一档端点的形状（地址、密钥、模型名、超时、方言键），回落链由调用方算完 |
| `ports.py` | 一路模型来源长什么样（`ModelAdapter` / `EmbeddingAdapter` / `ModelChoice`） |
| `errors.py` | 失败分三档，**以及哪一档该让断路器打开** |
| `deltas.py` | 从流式分片里把正文与思考过程分两路捡出来 |
| `reasoning.py` | 覆写 langchain 的一个私有接缝，把第三方端点的 `reasoning_content` 捡回来 |
| `openai_compat.py` | 按量计费的对话端点那一路 |
| `openai_embedding.py` | 嵌入端点那一路 |

## 它不管什么

- **不认任何厂商名。** 端点、模型名、超时全由调用方从自己的配置里算好再传进来。
- **不读配置、不碰数据库、不出 HTTP 面。** domain 不许含 ORM 模型、CRUD 与依赖注入件。
- **不重试。** 一条链路只有一层负责重试，而那一层是各服务自己的编排层。
- **不持有断路器。** 断路器按 (档位, 用途) 逐格建，逐格建在哪一格是消费方的事。
