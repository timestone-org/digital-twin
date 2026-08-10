# auth-server

认证、RBAC 权限判定、路由规则与边缘鉴权端点。对外前缀 `/api/v1/auth`，端口 8004。

设计与不变量见 [`CONTEXT.md`](CONTEXT.md)。对外契约以仓库里的
[`openapi.json`](openapi.json) 为准，它由 CI 校验与代码一致。

## 结构

```
src/auth_server/
├── __main__.py      进程入口（可执行名 auth-server）
├── app.py           装配 FastAPI（中间件与异常映射由 lib.web.create_app 单点给）
├── container.py     组合根：配置 → 各协作对象
├── settings.py      继承 lib 的配置基类，只加本服务字段
└── apps/auth/
    ├── catalog.py   权限码目录 / 内置角色 / 内置路由规则（全系统唯一真源）
    ├── deps.py      闸 2：require(...) 与会话、身份注入
    ├── errors.py    领域异常（错误码领域号 01）
    ├── api/         路由；只取参 → 调 service → 包封
    ├── services/    业务与事务边界，含 guards（授权不变式）与 matching（闸 1）
    ├── crud/        数据访问，不提交
    ├── models/      ORM，绑定 auth schema
    └── schemas/     对外模型
migrations/          本服务独占的迁移链，绑定 auth schema
scripts/             种子与 openapi 导出（不许被 apps/ import）
tests/{unit,integration,contract,e2e}
```

## 命令

```bash
uv run alembic upgrade head    # 建表
uv run auth-seed               # 权限码、内置角色、路由规则、种子管理员
uv run auth-server             # 起服务
uv run auth-openapi            # 重新导出 openapi.json
uv run auth-openapi --check    # CI：与代码不一致即失败

uv run pytest -q                              # 全量
uv run pytest tests/unit tests/contract -q    # 不需要数据库的两层
AUTH_TEST_SKIP_DB=true uv run pytest -q       # 显式跳过打真库的层
```

## 测试分层

- `tests/unit` —— 纯逻辑：闸 1 判定、授权不变式、令牌轮换、入参校验。毫秒级。
- `tests/contract` —— 闸 1 与闸 2 的口径一致性、权限码字面量、目录不变式。
  这一层守的是**违反时不会报错、只会静默出错**的那些约定。
- `tests/integration` —— 打**真实 Postgres**。每条用例包在一个回滚事务里。
  SQLite 上全绿的迁移与查询可以在生产直接失败，所以这一层不用 SQLite。

> ⚠ `tests/conftest.py` 里的散列器必须与种子账号**同参**：参数不同会让每次
> 登录都判 `needs_rehash` 为真，于是每条用例都去 UPDATE 同一行口令散列，
> 跨用例抢锁并偶发 lock timeout。

## 配置

变量名 `AUTH_<组>_<键>`，全量见 [`.env.example`](.env.example)。

密钥类（`AUTH_JWT_SECRET` / `AUTH_EDGE_SIGNING_SECRET` / `AUTH_EDGE_SERVICE_KEY`）
**没有默认值**，缺失或短于 32 字节即拒绝启动——弱默认的密钥等于没有密钥。
