# ai-assistant

对话式助手。按用户当前所在的**工作面**装配技能，编排模型与工具，
把每一步如实推给前端。

## 跑起来

```bash
cd server/services/ai-assistant
uv run alembic upgrade head          # 建 assistant schema 与三张表
uv run ai-assistant                  # 起服务，默认 8006
```

配置见 `.env.example`。⚠ `ASSISTANT_MODEL_ENABLED=true` 时必须同时配
`ASSISTANT_MODEL_API_KEY`，否则**启动即失败**——这是刻意的，见 CONTEXT.md §3。

## 它不做什么

- 不直连别的服务的 schema。业务数据一律经 platform 的 HTTP 面拿。
- 不替用户保存。改画布的工具在**浏览器**里执行，落库由用户自己按。
- 不在公开大屏上出现。那是全站唯一的匿名面，不给它接模型。

## 导出 openapi

```bash
uv run python scripts/export_openapi.py            # 重新生成
uv run python scripts/export_openapi.py --check    # 与代码比对，CI 用
```
