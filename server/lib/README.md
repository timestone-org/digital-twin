# lib —— 通用基础设施

后端唯一的一份基础设施。**零项目名词**：把整个目录拷进一个完全无关的新项目里必须仍然成立。
产品差异一律由调用方注入（服务名、头名、密钥、错误码取值、限流场景）。

约束与判例见 [`../../docs/agents/project-structure-python.md`](../../docs/agents/project-structure-python.md) §3–§5，
质量水位见同文 §9（行覆盖 ≥ 95%、分支 ≥ 90%）。

## 内容

| 子包 | 提供什么 |
|---|---|
| `config` | `Settings` 基类与装载顺序（pydantic-settings） |
| `logging` | 结构化 JSON 日志器与请求上下文 |
| `errors` | 异常基类、可重试标注、FastAPI 异常映射 |
| `web` | 统一响应信封、分页、中间件、`create_app()` 工厂 |
| `db` | 声明基类与命名约定、列混入、异步引擎与会话、通用 CRUD、外部只读 SQL 源 |
| `cache` | Redis 客户端与 JSON 缓存管理器 |
| `ratelimit` | 固定窗口限流器基类（限流场景由服务注册） |
| `auth` | JWT 签发与校验、口令散列、调用者身份载体、签名头编解码 |
| `lifespan` | 启动/关停钩子编排 |
| `utils` | 无状态纯函数：时间、标识、文本。**叶子包，不许 import 其它子包** |
| `testing` | 共享测试假件，排除出覆盖率统计 |

## 依赖 extras

```
db     sqlalchemy / asyncpg / alembic
mssql  pymssql（外部只读 SQL 源，自带 FreeTDS，不依赖系统 ODBC）
redis  redis
web    fastapi / uvicorn
auth   pyjwt / argon2-cffi
```

## 本地命令

```bash
uv run --package lib pytest -q --cov=lib --cov-branch
```
