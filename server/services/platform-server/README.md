# platform-server

业务平台。当前只有一个功能模块 `apps/hvac`：**空调台账**、**车间 / 房间空间配置**
与**空调数据面**（直读现场 EMS 库里的原始数据）。

| 项 | 取值 |
|---|---|
| 对外前缀 | `/api/v1/platform` |
| 端口 | 8005 |
| 数据 schema | `platform`（写独占，见 [ADR-0003](../../../docs/adr/0003-一库多schema且写独占读放行.md)） |
| 外部依赖 | 现场 EMS 的 SQL Server，**只读**（见 [ADR-0009](../../../docs/adr/0009-空调原始数据由平台直读外部EMS库.md)） |
| 运行角色 | `api`（本期只有它；`worker` / `publisher` 见 [ADR-0002](../../../docs/adr/0002-重任务用运行角色而非独立服务.md)） |

边界、通用语言与不变量见 [`CONTEXT.md`](CONTEXT.md)。

## 本地跑

```bash
cp .env.example .env      # 填 Postgres、EMS 库与 PLATFORM_EDGE_SIGNING_SECRET
uv sync --package platform-server
uv run alembic upgrade head
uv run platform-server
```

⚠ **本服务不能单独对外服务**：它读的是 edge-gateway 调过 auth-server `/verify`
之后注入的签名身份头，直连 8005 端口一律 401。本地要走通完整链路就起
`docker/compose.yml`，前端的 `/api` 代到边缘（默认 8080）而不是某个服务端口。

## 命令

```bash
uv run pytest                                  # 四层测试
# ⚠ 用 `python -m`：每个服务都有一个同名的顶层 `scripts` 包，装进同一个
# workspace venv 会互相遮蔽，故由 CWD 决定用哪份，不另立可执行名
uv run python -m scripts.export_openapi         # 重新导出 openapi.json
uv run python -m scripts.export_openapi --check # 与代码比对（CI 用）
uv run alembic upgrade head
uv run alembic downgrade base
```
