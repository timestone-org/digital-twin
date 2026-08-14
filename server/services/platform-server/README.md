# platform-server

业务平台。三个功能模块：`apps/hvac`（**空调台账**、**车间 / 房间空间配置**、
**空调数据面**，直读现场 EMS 库里的原始数据）、`apps/dashboard`（**大屏组态**的
配置面）、`apps/collect`（**采集配置面**：数据源、点位、采集计划下发、点位历史
读侧）。采集**运行时**在 `collector-server`，切线见
[ADR-0001](../../../docs/adr/0001-采集运行时独立成服务而配置面留在平台.md)。

| 项 | 取值 |
|---|---|
| 对外前缀 | `/api/v1/platform` |
| 端口 | 8005 |
| 数据 schema | `platform`（写独占，见 [ADR-0003](../../../docs/adr/0003-一库多schema且写独占读放行.md)） |
| 外部依赖 | 现场 EMS 的 SQL Server，**只读**（见 [ADR-0009](../../../docs/adr/0009-空调原始数据由平台直读外部EMS库.md)）；`collect` schema 的归档宽表与 Redis 快照，**跨服务只读**；`realtime` schema 的订阅表，**跨 schema 只读**；Redis 命令总线（发起端）；realtime-hub 的内部推送端点 |
| 内部面 | `/internal/v1/platform/collect-plan`，服务级密钥 `X-Service-Key`，边缘对 `/internal/` 一律 deny |
| 运行角色 | `api`（HTTP）、`worker`（队列消费）、`publisher`（大屏实时发布，**全局单活、无端口无探针**），见 [ADR-0002](../../../docs/adr/0002-重任务用运行角色而非独立服务.md) |

边界、通用语言与不变量见 [`CONTEXT.md`](CONTEXT.md)。

## 本地跑

```bash
cp .env.example .env      # 填 Postgres、EMS 库、Redis 与两个密钥
                          # PLATFORM_EDGE_SIGNING_SECRET / PLATFORM_EDGE_SERVICE_KEY
uv sync --package platform-server
uv run alembic upgrade head
uv run platform-server                          # api 角色
PLATFORM_APP_ROLE=publisher uv run platform-server   # 大屏实时发布循环
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
