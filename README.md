# DigitalTwin

工业数字孪生平台。后端 6 个代码单元 / 9 个部署单元，前端一个 pnpm workspace。

> 上下文划分见 [`CONTEXT-MAP.md`](CONTEXT-MAP.md)，服务边界见
> [`docs/ARCHITECTURE_MICROSERVICES.md`](docs/ARCHITECTURE_MICROSERVICES.md)，
> 各语言的规范见 [`docs/agents/`](docs/agents/)。

## 目录

```
.github/       流水线与复合动作
docs/          规范与架构决策
server/        后端（uv workspace）：lib / domain / services
web/           前端（pnpm workspace）：packages / app
docker/        边缘网关与编排
scripts/       仓库级闸门脚本（scripts/gates/）
```

## CI

每次 push 与每个 PR 跑五段闸门：秒级检查 → 静态检查 → 测试（真 Postgres + Redis）
→ 契约与产物 → 汇总。分支保护只需把 `5·全部闸门` 设成必需检查。
规范条目与闸门的对照见 [`docs/agents/ci-gates.md`](docs/agents/ci-gates.md)。

```bash
scripts/ci-local.sh --fast    # 只跑闸门脚本，秒级
scripts/ci-local.sh --all     # 用 act 在容器里跑整条流水线
```

## 当前进度

- **auth-server + edge-gateway**：登录、令牌轮换、RBAC 三道闸、用户与角色管理、
  路由规则、审计，以及配套的登录页与权限门禁。
- **platform-server 的 `api` 角色**：空调台账、车间 / 房间空间配置，以及直读现场
  EMS 库的空调数据面（数据源绑定、达标范围、原始数据表格与聚合序列）。

其余服务按 [ARCHITECTURE §8](docs/ARCHITECTURE_MICROSERVICES.md#8-建设顺序) 的顺序接。

## 起一套本地环境

### 1. 配置

后端读环境变量或 `.env`，前缀 `AUTH_`。密钥类**没有默认值，缺失即拒绝启动**。

```bash
cd server/services/auth-server
cp .env.example .env
# 至少填：AUTH_POSTGRES_*、AUTH_REDIS_HOST
#         AUTH_JWT_SECRET / AUTH_EDGE_SIGNING_SECRET / AUTH_EDGE_SERVICE_KEY
#         （各 32 字节以上：openssl rand -hex 32）
#         AUTH_SEED_ADMIN_PASSWORD（只被种子脚本读）
```

### 2. 建表与种子

```bash
cd server/services/auth-server
uv run alembic upgrade head   # 建 auth schema 与全部表
uv run python -m scripts.seed # 权限码目录、内置角色、内置路由规则、种子管理员

cd ../platform-server
cp .env.example .env          # 至少填 PLATFORM_POSTGRES_*、PLATFORM_SQLSERVER_*
                              # 与 PLATFORM_EDGE_SIGNING_SECRET（与 auth 同值）
uv run alembic upgrade head   # 建 platform schema 与全部表

cd ../collector-server
cp .env.example .env          # 至少填 COLLECT_POSTGRES_*、COLLECT_REDIS_*
                              # 与 COLLECT_EDGE_SERVICE_KEY（与 auth 同值）
uv run alembic upgrade head   # 建 collect schema 与点位历史超表
```

⚠ **`collect` 是独立 schema，漏了它采集起不来。** 归档表是 TimescaleDB 超表，
建表时会 `CREATE EXTENSION timescaledb`——装不上就响亮失败，不会退化成普通大表
（那种退化要等到表涨到几亿行才会被发现）。

⚠ **加了端点就要重跑一次 `scripts.seed`。** 闸 1 的路由规则存在数据库里，种子脚本
全量覆盖内置规则；漏跑的表现是新端点在边缘一律 403，而直连服务端口却是好的——
现象与原因隔得极远。种子可重复执行，人工新建的规则不受影响。

种子只建**一个**管理员账号，密码取自 `AUTH_SEED_ADMIN_PASSWORD`；
账号已存在时**不改密码**。首次登录后请立即修改。

### 3. 起服务

```bash
cd server/services/auth-server     && uv run auth-server      # :8004
cd server/services/platform-server && uv run platform-server  # :8005
cd web && pnpm install && pnpm dev                            # :5173
```

⚠ 业务服务**不能单独对外服务**：它们读的是边缘调过 `/verify` 之后注入的签名身份头，
直连端口一律 401。要走通完整链路就起 `docker/compose.yml`，前端的 `/api` 代到边缘。

生产形态用 `docker/compose.yml`（边缘网关 + auth-server），
前端构建产物挂进 nginx。

## 闸门

```bash
# 后端
cd server
uv run black --check .
uv run ruff check .
uv run pyright
uv run pytest -q --cov --cov-branch

# 前端
cd web
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build

# 仓库结构
python3 scripts/check_structure.py
```

## 几条最容易踩的约定

- **HTTP 状态码必须真实**，信封里的 `code` 不取代它。恒 200 会让 nginx 限流、
  监控错误率、客户端重试策略全部失明。
- **`/verify` 先认证、再查规则**。空 `permission_codes` 是「任意已登录用户放行」，
  匿名可达性由边缘的免认证 location 保证。
- **`lib/` 里零项目名词**。判据是「把它整个目录拷到一个无关项目里还成不成立」。
- **迁移只做扩展步**：代码可回滚、数据库不回滚，所以「新结构 + 旧代码」必须可用。
- **前端样式一律 SCSS**，设计值只来自 `@dt/tokens` 的 CSS 变量。
