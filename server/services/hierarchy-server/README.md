# 层级图服务

可选计量层级图工具，持有 `hierarchy` schema。功能与案例验收见
[设计](../../../docs/HIERARCHY_DESIGN.md)，数据边界见 [上下文](CONTEXT.md)。

```sh
# 在仓库根更新前端，再启用服务。
corepack pnpm@11.21.0 --dir web install --frozen-lockfile
corepack pnpm@11.21.0 --dir web build
cd docker
docker compose --profile hierarchy up -d --build auth-server hierarchy-server
docker compose restart edge-gateway
docker compose exec edge-gateway nginx -t

# 服务目录中单独执行自身迁移、启动或验证。
cd ../server/services/hierarchy-server
uv run alembic upgrade head
uv run hierarchy-server
uv run pytest -q
uv run python scripts/export_openapi.py
uv run python scripts/export_types.py --check
```

连接与签名密钥以 `HIERARCHY_` 前缀注入，模板见 `.env.example`；Compose 将公共
数据库、Redis、身份密钥映射到本服务。监听端口 8010，对外 API 前缀
`/api/v1/hierarchy`。所有业务端点需要边缘签名身份；项目列表和历史按账号隔离。

创建支持 `Idempotency-Key`，修改和恢复必须携带当前 `revision`。版本冲突返回
409，前端保留本地草稿；导入创建新项目。保存与历史快照在同一事务中完成，最多
保留最近 50 版，恢复追加新版本。`/health` 不访问依赖，`/ready` 验证存储可用。

单元测试不需要数据库；集成测试使用独立测试 PostgreSQL 与 Redis，默认端口
55432 / 56379，连接可用 `HIERARCHY_POSTGRES_*` 与 `HIERARCHY_REDIS_*` 覆盖。
不要将集成测试连接到业务数据库。迁移只创建本服务表；应用回滚保留 schema。
