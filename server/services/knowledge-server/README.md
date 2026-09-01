# knowledge-server

知识库。它拥有自己的文档、块与向量，对上出检索面，对内跑摄取管线。

设计见 [`docs/KNOWLEDGE_BASE_DESIGN.md`](../../../docs/KNOWLEDGE_BASE_DESIGN.md)，
决策见 ADR-0032 至 ADR-0035。

## 跑起来

```bash
cd server/services/knowledge-server
uv run alembic upgrade head              # 建 knowledge schema 与五张表
uv run knowledge-server                  # api 角色，默认 8009
KNOWLEDGE_APP_ROLE=worker uv run knowledge-server   # worker 角色，跑摄取
```

配置见 `.env.example`。

## 启用加速索引（可选）

向量的持久真相是 `kb_chunk_vectors.embedding`（bytea），**任何环境都有**。
pgvector 那一路是**可选的加速物化**，不由迁移建：

```bash
uv run python -m knowledge_server.index --enable-pgvector
```

装不上就别装——服务启动时会探测，探测不到就走
`BruteForceIndex`（应用层余弦），并在 `/capabilities` 里如实写着「未启用加速索引」。
理由见 [ADR-0034](../../../docs/adr/0034-向量索引走端口并按扩展探测选实现.md)。

## 它不做什么

- **不读别的服务的库。** 外部系统来源经对方的 HTTP 面拿数据。
- **不回调 ai-assistant。** 助手是它的消费方，不是它的依赖。
- **不自动重试失败的摄取。** 一份解不动的文档重试一万次也解不动，
  失败即写 `failed` + 一句人话，由人在界面上按「重新解析」。

## 导出 openapi

```bash
uv run python scripts/export_openapi.py            # 重新生成
uv run python scripts/export_openapi.py --check    # 与代码比对，CI 用
```
