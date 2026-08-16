# 项目结构：Python 服务

适用于本仓所有 Python 服务。前端见 [`project-structure-typescript.md`](project-structure-typescript.md)，镜像构建见 [`docker-build.md`](docker-build.md)。

## 1. 这份结构要解决的问题

多服务后端最容易走上的形态是**每个服务各自持有一份基础设施**（`core/` + `config/` + `utils/`）：日志器、响应包封、DB 会话、Redis 客户端、令牌签发、分布式锁，每个服务一份。

这个形态靠"改一处同步各处"的纪律维持，而这条纪律**不可能长期守住**。它没有任何自动执行手段：漏同步不会报错、不会有类型错误、CI 全绿。几个月之后得到的不是几份同步的副本，而是几份互不相同、没人知道哪份正确的代码——而分叉最常见的成因，恰恰是某个服务修过一个缺陷、其他服务没修。

安全相关的基础设施尤其危险：令牌校验、签名头编解码、选主租约，任何一份的语义漂移都是可利用的洞，而漂移是静默的。

因此本仓的第一条结构原则是：**基础设施只有一份，物理上不可能分叉。**

这条原则的代价是"一处改动波及全部服务"。这是**有意的交换**——分叉是静默的且无人察觉，波及是响亮的且在 CI 里立刻可见。使这个交换成立的前提是 §9 的测试水位。

## 2. 目标结构

后端整体收在 `server/`，与 `web/` 左右对称：两个世界各有自己的 workspace 根与锁文件，互不干扰。

```
/
├── CONTEXT-MAP.md
├── CLAUDE.md
├── docs/{adr,agents}/
├── docker/
│
├── server/                 ← 后端世界
│   ├── pyproject.toml      ← uv workspace 根，只声明成员，本身不是可安装包
│   ├── uv.lock             ← 后端唯一锁文件 ★
│   ├── lib/                ← 通用基础设施，唯一真源、零项目名词 ★
│   │   ├── pyproject.toml
│   │   ├── README.md
│   │   └── src/lib/
│   ├── domain/             ← 领域共享包，可含项目名词、不含 ORM 模型（ADR-0004）
│   │   ├── formula/
│   │   └── timeseries/
│   └── services/           ← 可部署单元，一个目录一个代码单元
│       ├── auth-server/
│       ├── platform-server/
│       ├── collector-server/
│       ├── realtime-hub/
│       └── ai-assistant/
│
└── web/                    ← 前端世界（pnpm workspace）
    ├── package.json
    ├── packages/
    └── app/
```

```toml
# server/pyproject.toml
[tool.uv.workspace]
members = ["lib", "domain/*", "services/*"]
```

> 本文档后续出现的路径，除非另有说明，**均相对 `server/`**。

`lib/`、`domain/` 与 `services/` 同在 `server/` 内部：基础设施、领域共享包、可部署单元，三者的区分在目录上一眼可见，而它们又都只是后端的组成部分，不再与 `web/` 抢顶层位置。

`domain/` 装的是**多个服务共用、但确实带项目名词**的领域代码（台账公式引擎、点位历史编解码、采集控制面的跨进程线形）。它进不了 `lib`（违反零项目名词铁律），也不该复制到每个服务里。入场券极窄：**必须已经有 ≥ 2 个服务真实消费它**，"将来可能共用"不构成理由。完整约束见 [ADR-0004](../adr/0004-server分三层且domain承载领域共享包.md)。

**一份 `uv.lock` 覆盖整个后端**：各服务不可能再出现依赖版本不一致；而 `uv sync --package <service>` 仍然只安装该服务实际用到的那一支——共享锁定，不共享安装。

把后端收进 `server/` 还顺带解决了镜像构建的上下文问题：Python 服务的构建上下文取 `server/`，`web/`、`docs/`、`.git/` 天然不在其中，见 [`docker-build.md`](docker-build.md)。

## 3. `lib` 的第一铁律：零项目名词

**`lib` 里不允许出现任何与本项目相关的名词。** 不是"尽量少"，是零。

禁止出现的词（含中英文、含大小写变体、含缩写）：

```
数字孪生 / 孪生 / twin / digitaltwin
大屏 / 看板 / dashboard
点位 / opcua / plc / 采集
台账 / dataset / 归档 / archive
报表 / report / 建模 / modeling
以及任何本产品的服务名、表名、权限码、业务状态名
```

判据不是"这段代码只有本项目在用"，而是**"把它整个目录拷到一个完全无关的新项目里，还成不成立"**。

这条规则的目的不是洁癖：一旦 `lib` 里出现 `dashboard_cache.py` 或 `SERVICE_NAME = "platform-server"`，这个包就同时既想被复用、又搬不走，最后只能起一个带产品前缀的名字——那就退回到起点了。

### 3.1 差异靠参数化，不靠硬编码

项目相关的取值一律**由调用方注入**，`lib` 只提供机制。

| ❌ 写死在 `lib` 里 | ✅ 参数化 |
|---|---|
| `SERVICE_NAME = "platform-server"` | `PushClient(service_name=...)` |
| `HEADER = "X-Auth-Permissions"` | `HeaderCodec(header_name=..., secret=...)` |
| `SUCCESS = 0 / ERROR = 1` | `ResponseCodes(success=..., error=...)`，有中性默认值 |
| `TOKEN_PREFIX = "sk-"` | `TokenHasher(prefix=...)` |
| `PUBLIC_VIEWER_FIXED_TOPICS = {...}` | 由服务侧注册进 topic 表 |

### 3.2 自动执行

这条规则必须由 CI 执行，不能靠评审记忆：

```bash
# 结构检查：lib/ 内出现项目名词即失败
grep -rniE '数字孪生|孪生|twin|dashboard|大屏|看板|opcua|点位|台账|dataset|归档|报表|modeling' server/lib/src/ \
  && { echo "lib 内出现项目名词"; exit 1; } || exit 0
```

同样必须检查 **`lib` 不许 import 任何 `services/`**——反向依赖是环的起点，也让 `lib` 无法被独立测试和搬走。

## 4. `lib` 的内容

```
lib/src/lib/
├── config/
│   ├── base.py         ← Settings 基类与装载顺序（pydantic-settings）
│   └── sources.py      ← 分环境覆盖规则
├── logging/            ← 上下文日志器
├── errors/             ← 异常基类与 HTTP 映射
├── web/
│   ├── response.py     ← 统一响应包装与分页（状态码可注入）
│   ├── middleware.py   ← 请求上下文、日志、异常兜底
│   └── bootstrap.py    ← create_app() 工厂，见 §6
├── db/
│   ├── engine.py       ← 引擎与会话工厂
│   ├── base.py         ← ORM 声明基类
│   ├── mixins.py       ← 时间戳、软删等列混入
│   └── crud.py         ← 通用 CRUD 基类
├── cache/              ← Redis 客户端、JSON 缓存管理器
├── ratelimit/          ← 限流器基类（具体限流场景由服务注册）
├── coordination/
│   ├── lock.py         ← 分布式锁
│   └── leader.py       ← 单主选举与租约续期
├── pubsub/             ← 发布订阅封装
├── messaging/
│   └── push.py         ← 跨服务推送客户端（service_name / channel 注入）
├── ws/
│   ├── manager.py      ← 连接与订阅管理（topic 语义由服务注册）
│   └── registry.py
├── auth/
│   ├── jwt.py          ← 令牌签发与校验（纯算法）
│   ├── password.py     ← 口令散列与校验
│   ├── context.py      ← 调用者身份载体
│   └── header_codec.py ← 签名头编解码（头名/密钥/上限注入）
├── runtime/
│   └── params.py       ← 运行时可变参数机制（参数定义由服务给）
├── lifespan.py         ← 启动/关停钩子编排
├── utils/              ← 无状态纯函数：crypto、时间、类型
└── testing/            ← 共享测试假件与工厂
```

依赖按 extras 切分，让只需要一部分的项目不必装全套：

```toml
[project.optional-dependencies]
db    = ["sqlalchemy>=2.0", "asyncpg>=0.30"]
redis = ["redis>=7.0"]
web   = ["fastapi>=0.135"]
auth  = ["python-jose>=3.3", "passlib>=1.7"]
```

`lib/testing/` 放在 `src/` 内是为了能被各服务的测试引用（与前端 `packages/*/src/testing/` 同一处理），它是测试设施而非被测代码，**排除出覆盖率统计**，生产代码引用由结构检查拦截。

## 5. 三层之间怎么放：判例

写一段新代码时，从下往上问：它能不能拷到无关项目？能，进 `lib`。不能但被两个以上服务真实消费？进 `domain`。都不是？留在服务里。

下面几类是最容易放错的，各给一条判例。

### 5.1 纯技术件——直接进 `lib`

日志器、CRUD 基类、DB 会话工厂、Redis 客户端与缓存管理、限流器基类、生命周期编排、中间件、异常基类、加解密与时间工具、配置基类。

这些天然中立，不需要任何改造。**它们绝不允许在服务里再出现一份**——哪怕只是"这个服务需要稍微不一样的行为"：稍微不一样用参数表达，不用副本表达。

### 5.2 通用与专有混在一件事里——先拆开再放

这是最常见的一类，写的时候不拆，之后就搬不动了。

| 一件事 | 拆法 |
|---|---|
| **认证** | 纯算法（JWT 签发与校验、口令散列）→ `lib/auth/`；**读用户表的 FastAPI 依赖注入件留在 `auth-server`**。⚠ 混在一个文件里会让基础设施反向依赖业务层，那是环的起点。 |
| **响应包封** | 包封与分页 → `lib/web/response.py`；业务码约定（`SUCCESS`/`ERROR` 取值）做成可注入，`lib` 给中性默认值。 |
| **WebSocket 连接管理** | 连接与订阅管理 → `lib/ws/manager.py`；主题语义、消息枚举、载荷模型留在 `realtime-hub`，经注册接口传入。 |

判据：**这段代码需要知道本项目的任何一个具体取值吗？** 需要的那部分留在服务，剩下的进 `lib`。

### 5.3 通用能力但容易写死取值——参数化后再放

| 能力 | 必须注入的东西 |
|---|---|
| 签名头编解码 | 头名、HMAC 密钥、体积上限、字段布局。fail-closed 语义**不注入**——那是通用的安全默认值，不是项目特性。 |
| 跨服务推送客户端 | 调用方服务名、频道名、兜底地址。**服务名一旦硬编码，这个文件就必然被复制**。 |
| 运行时可变参数 | 机制进 `lib/runtime/params.py`，参数定义留在服务。 |

### 5.4 只有一个服务用，但仍是基础设施

分布式锁与选主租约是典型：今天只有采集侧用，但它与任何业务无关，判据（"拷到无关项目还成不成立"）成立，因此进 `lib/coordination/`。

**"只有一个消费方"是 `domain` 的排除条件，不是 `lib` 的。** `lib` 的判据只有中立性一条。

> ⚠ 选主是全仓最贵的一处基础设施：写错会在物理设备上叠加重复会话。抢锁、续约 CAS、fence 令牌、Redis 不可达时的降级、门控三态——每一条都要有测试锁死，且假件与真实现之间必须有契约测试（见 [`testing-standard-python.md`](testing-standard-python.md) §1 L3）。

### 5.5 不进 `lib` 的

| 项 | 去向 | 理由 |
|---|---|---|
| 令牌表、用户表等业务表 | 属主服务的 `models/` | 这是**业务数据**，不是基础设施。`lib` 只提供散列器与列混入。 |
| 各业务模块的配置类（点位、台账、归档、报告…） | 各自的服务 | 名字本身就是项目名词 |
| 具体限流场景（登录、注册） | 服务侧按 `lib/ratelimit` 基类实例化 | 限流策略属于业务决策 |
| 角色与权限码的语义 | 服务侧 | `lib/auth/context.py` 只出载体结构，不认识具体权限码 |
| 台账公式求值、时序编解码、跨服务线形口径 | `domain/`（见 [ADR-0004](../adr/0004-server分三层且domain承载领域共享包.md)） | 带项目名词，进不了 `lib`；被多服务消费，不该复制 |

**拿不准时的默认答案是留在服务里。** 从服务上移到 `lib` 或 `domain` 是一次机械移动；从共享层往下拆要改所有调用方。

## 6. 服务包结构与入口函数

```
services/<service>/
├── pyproject.toml          ← 依赖 lib，声明入口脚本
├── alembic.ini
├── README.md
├── CONTEXT.md
├── src/<service_pkg>/
│   ├── __main__.py         ← 入口函数
│   ├── app.py              ← 装配本服务的 FastAPI 实例
│   ├── settings.py         ← 继承 lib.config.base.Settings，只加本服务字段
│   └── apps/<feature>/     ← 业务功能模块 ★
│       ├── api/  services/  crud/  models/  schemas/
│       ├── permissions.py
│       └── exceptions.py
├── migrations/versions/    ← 本服务独占的迁移链
├── scripts/
├── docs/adr/
└── tests/{unit,integration,contract,e2e}/
```

服务目录下**不再有 `core/`、`config/`、`utils/`**。出现即为回归，由结构检查拦截。

`lib` 提供统一装配工厂，服务只声明差异：

```python
# lib/src/lib/web/bootstrap.py
def create_app(
    *,
    settings: BaseSettings,
    routers: Sequence[APIRouter],
    lifespan_hooks: Sequence[LifespanHook] = (),
) -> FastAPI:
    """按统一约定装配 FastAPI 实例：中间件、异常映射、响应包装、健康检查。

    Args: settings, routers, lifespan_hooks。
    """
```

```python
# services/auth-server/src/auth_server/__main__.py
def main() -> None:
    """auth-server 进程入口。"""
    run(build_app, settings=Settings())
```

```toml
[project.scripts]
auth-server = "auth_server.__main__:main"

[tool.uv.sources]
lib = { workspace = true }
```

每个服务各有一个可执行名，容器 `CMD` 直接用它，不再需要各写一份 entrypoint 脚本拼 uvicorn 命令行。**中间件顺序、异常映射、响应包装这些"必须全服务一致"的东西，由 `create_app` 单点保证**，不再指望几份代码碰巧写得一样。

同一个服务可以按**运行角色**跑出多个进程（`ROLE=api|worker|publisher`），入口函数据此决定装配哪些后台任务。角色是部署维度，不是代码维度——**不为角色另建服务目录**，理由见 [ADR-0002](../adr/0002-重任务用运行角色而非独立服务.md)。

## 7. 依赖方向

```
  services/<svc>/apps/**   ──▶   domain/*   ──▶   lib   ──▶   （第三方库）
        api/ ─▶ services/ ─▶ crud/ ─▶ models/
                    └────────▶ schemas/   （任何层都可读）
```

八条铁律，由结构检查自动执行：

1. **`lib` 不许 import 任何 `domain/` 或 `services/`。**
2. **`lib` 内不许出现项目名词**（§3）。
3. **服务之间不许互相 import。** 跨服务只走 HTTP / WebSocket / 消息通道 / 只读 SQL。
4. **`apps/<A>` 不许 import `apps/<B>` 的内部**，只走 B 的 `services/__init__.py` 公开面。
5. **`lib.utils` 是叶子**，不许 import `lib` 的其它子包。
6. **服务下不许出现 `core/`、`config/`、`utils/` 顶层包。**
7. **`domain/*` 不许 import `services/`，也不许互相 import**（保持扁平，否则它会长成第二个服务层）。
8. **`domain/*` 不许含 ORM 模型、CRUD 与 FastAPI 依赖注入件**——含了就等于两个服务共享数据库写路径，[ADR-0003](../adr/0003-一库多schema且写独占读放行.md) 的写独占会静默失效。

## 8. 数据库迁移与数据所有权

迁移链**按服务独立**，各自单头（single head），并各自绑定一个 schema（`version_table_schema`）。`lib` 与 `domain` 提供 ORM 基类、列混入与表结构契约，**都不定义任何表**，没有自己的迁移链。

数据所有权的总口径见 [ADR-0003](../adr/0003-一库多schema且写独占读放行.md)：一个 database、每服务一个 schema，**写独占、读放行**，且禁止跨 schema 的 JOIN / 外键 / 事务。

**一张表被多个服务读**：它仍然只有一个属主，由属主定义并出迁移；其他服务按 ADR-0003 的只读口径读，或改走属主 API。**跨服务共享数据库写路径是分布式单体的典型症状**，比重复代码更难拆。

## 9. `lib` 与 `domain` 的质量要求

它们的缺陷会同时命中多个服务，因此按最高档要求：

- 行覆盖 ≥ 95%、分支 ≥ 90%（见 [`testing-standard-python.md`](testing-standard-python.md) §4.1）。
- 公开面即契约。破坏性变更必须在**同一个提交里**改完全部调用方——这正是单仓的好处，但也意味着不能悄悄改。
- `lib` 自带 `README.md` 与独立可跑的测试，随时可以整个目录拷走。

> ⚠ §1 那个「用波及换分叉」的交换，成立的前提就是这条测试水位。共享层没有高覆盖，这套结构只是把几个小风险合并成一个大风险。

## 10. 反模式

- **`lib` 里出现项目名词**：见 §3，由 CI 拦截。
- **`lib` 里出现服务分支**：`if service_name == "auth"` 说明这段代码根本不共享，应留在服务里或做成钩子参数。
- **`lib` 变成第二个上帝模块**：什么都往里塞。判据是"拷到无关项目还成不成立"。
- **跨服务共享数据库表**：绕过 API 直连别的服务的表。基础设施可以共享，**数据所有权不可以**。
- **上帝模块 `apps/common/`**：共用的框架件进 `lib`，跨服务共用的领域件进 `domain`，服务内跨模块共用的说明边界切错了。
- **贫血 service 层**：`services/` 只是原样转发 `crud/`。
- **在 `api/` 里写业务**：路由函数超过约 20 行几乎一定是业务漏进了 HTTP 层。
- **脚本进生产路径**：`scripts/` 下的东西不许被 `apps/` import。
