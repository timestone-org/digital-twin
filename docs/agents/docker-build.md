# 镜像构建与部署

如何让每个服务的镜像**只装该装的东西**。结构前提见 [`project-structure-python.md`](project-structure-python.md)。

## 1. 两个不同的问题

"不相关文件进了镜像"其实是两件事，机制不同，必须分开治：

| | 是什么 | 由谁控制 | 症状 |
|---|---|---|---|
| **构建上下文** | 发送给 Docker daemon 的文件集合 | `.dockerignore` + `context:` | 构建慢、传几百 MB、缓存频繁失效 |
| **镜像内容** | 最终镜像里真实存在的文件 | `COPY` 指令 + 多阶段构建 | 镜像臃肿、攻击面变大、泄漏源码或密钥 |

**`.dockerignore` 管不住镜像内容，`COPY` 也管不住上下文大小。** 两个都要治。

最容易被忽略的是前者：`COPY services/auth-server/ .` 看起来很精确，但如果上下文是仓库根且没有 `.dockerignore`，daemon 仍然会先收到整个仓库——包括 `node_modules/`、`.venv/`、`.git/`。构建日志里那句 `Sending build context to Docker daemon  480MB` 就是这个。

**第一刀是选对 `context`**：后端取 `server/`、前端取 `web/`，两边天然看不见对方，剩下的才交给 `.dockerignore` 处理各自内部的噪音。

## 2. 构建上下文

### 2.1 全局 `.dockerignore`

Python 服务的构建上下文取 **`server/`**（workspace 根，构建要能看到 `pyproject.toml` 与 `uv.lock`），因此这份 `.dockerignore` 放在 `server/.dockerignore`。

取 `server/` 而非仓库根，本身就排掉了 `web/`、`docs/`、`.git/` 这三个最占体积的目录——**上下文裁剪的第一刀是选对 `context`，不是写规则**。

采用**默认全排除、再显式放行**的写法，比逐条列黑名单更安全——新增的临时目录默认不会溜进去：

```dockerignore
# ---- 默认全部排除 ----
*

# ---- 显式放行 workspace 构建所需 ----
!pyproject.toml
!uv.lock
!lib/
!domain/
!services/

# ---- 放行内再排除（!规则不能撤销父目录的排除，故需逐条剔除）----
**/.venv
**/__pycache__
**/*.pyc
**/.pytest_cache
**/.ruff_cache
**/.mypy_cache
**/tests/
**/docs/
**/*.md
**/.env
**/.env.*
**/logs
**/*.log
```

`web/`、`docs/`、`.git/`、`node_modules/` 根本不在 `server/` 内，无需规则即已排除。这份 `.dockerignore` 处理的是 `server/` **内部**的噪音：`.venv`、`__pycache__`、测试与文档。

> ⚠ `.dockerignore` 的 `!` **无法把已被排除的父目录里的文件重新放行**。写了 `**/tests/` 之后再写 `!libs/dt-core/tests/` 是无效的。需要例外时，调整排除规则本身，别指望 `!` 兜底。

### 2.2 按 Dockerfile 分别配置上下文

BuildKit 支持**每个 Dockerfile 独立的忽略文件**：文件名是 `<Dockerfile 路径>.dockerignore`。

```
docker/
├── python-service.Dockerfile
├── python-service.Dockerfile.dockerignore    ← 只对这个 Dockerfile 生效
├── web.Dockerfile
└── web.Dockerfile.dockerignore
```

存在同名文件时它**覆盖**该 context 根的 `.dockerignore`（不是叠加）。

因为 `server/` 与 `web/` 已经是两个互不相见的 context，这个机制在当前布局下并非必需——`server/.dockerignore` 与 `web/.dockerignore` 各管一边就够了。留在这里是备用手段：**当同一个 context 要服务多个诉求不同的 Dockerfile 时**（例如后端将来加一个只装迁移工具的轻量镜像），用它做差异化裁剪，而不是把规则挤进同一份文件靠注释区分。

### 2.3 别为每个服务各写一份上下文规则

Python 服务的源码是 KB 量级，全部服务进上下文也就几 MB；真正撑爆上下文的是 `.venv` / `node_modules` / `.git`，前两者由 §2.1 排除，后者根本不在 `server/` 内。

**为每个服务单独做上下文裁剪收益极小、维护成本很高**。用一份共享 Dockerfile + 一份上下文规则，镜像内容的精确控制交给 §3 的 `COPY` 与 `--package`。

## 3. 一份 Dockerfile 服务全部微服务

每个服务各写一份 Dockerfile 与一份 entrypoint 脚本，是与每个服务各持一份 `core/` 完全相同的问题：几份文件长得几乎一样，改一处要同步几处，而漏同步不会报错。用 `ARG` 参数化成一份：

```dockerfile
# docker/python-service.Dockerfile
# 全部 Python 微服务共用。由 ARG SERVICE 决定装配哪一个。

# ============ 构建阶段 ============
FROM python:3.12-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

ARG SERVICE

# ---- 依赖层 ----
# 只拷 workspace 元数据。uv.lock 覆盖全仓，故所有成员的 pyproject.toml 都要在场，
# 否则 --frozen 会因 workspace 与锁文件不一致而失败。这些文件仅几 KB，
# 且改动频率远低于源码，能让依赖层长期命中缓存。
COPY pyproject.toml uv.lock ./
COPY lib/pyproject.toml                            lib/
COPY domain/formula/pyproject.toml                 domain/formula/
COPY domain/timeseries/pyproject.toml              domain/timeseries/
COPY services/auth-server/pyproject.toml           services/auth-server/
COPY services/platform-server/pyproject.toml       services/platform-server/
COPY services/collector-server/pyproject.toml      services/collector-server/
COPY services/realtime-hub/pyproject.toml          services/realtime-hub/
COPY services/ai-assistant/pyproject.toml          services/ai-assistant/

# 只解析该服务这一支依赖树：platform-server 的 scikit-learn 不会进 auth-server 镜像。
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --package "${SERVICE}" --no-install-workspace

# ---- 源码层 ----
# 只拷共享层与目标服务。其余服务的源码永远不进镜像。
# domain 全量拷入：它是几个小包，且 uv sync --package 只会装该服务声明的那几个。
COPY lib/                 lib/
COPY domain/              domain/
COPY services/${SERVICE}/ services/${SERVICE}/

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --package "${SERVICE}"

# ============ 运行阶段 ============
FROM python:3.12-slim AS runtime

ARG SERVICE
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

# 运行时依赖，不含编译器
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/*

# 非 root 运行
RUN useradd --create-home --uid 10001 appuser
WORKDIR /app

COPY --from=builder --chown=appuser:appuser /app/.venv               /app/.venv
COPY --from=builder --chown=appuser:appuser /app/lib                 /app/lib
COPY --from=builder --chown=appuser:appuser /app/domain              /app/domain
COPY --from=builder --chown=appuser:appuser /app/services/${SERVICE} /app/services/${SERVICE}

USER appuser
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD curl -fsS http://localhost:8000/healthz || exit 1

# 入口即 §5 声明的 console script，不再需要 entrypoint 脚本拼命令行
ENV SERVICE_BIN=${SERVICE}
CMD ["sh", "-c", "exec ${SERVICE_BIN}"]
```

三处关键点：

1. **`uv sync --package ${SERVICE}`** 是依赖隔离的执行者。共享一份 `uv.lock` 保证版本一致，但只安装这一支依赖树——`platform-server` 的 `scikit-learn`、`matplotlib` 不会出现在 `auth-server` 镜像里。
2. **依赖层与源码层分离**。元数据先拷、依赖先装，源码改动不会让依赖层缓存失效。
3. **多阶段丢弃构建期产物**。编译器、`uv`、构建缓存全部留在 builder 阶段，运行镜像里没有。

## 4. compose 接线

```yaml
x-python-build: &python-build
  context: ../server
  dockerfile: ../docker/python-service.Dockerfile

services:
  auth-server:
    build:
      <<: *python-build
      args: { SERVICE: auth-server }

  realtime-hub:
    build:
      <<: *python-build
      args: { SERVICE: realtime-hub }

  platform-server:
    build:
      <<: *python-build
      args: { SERVICE: platform-server }

  collector-server:
    build:
      <<: *python-build
      args: { SERVICE: collector-server }

  ai-assistant:
    build:
      <<: *python-build
      args: { SERVICE: ai-assistant }
```

`context: ../server` 指向 uv workspace 根——构建要能看到 `pyproject.toml` 与 `uv.lock`。`dockerfile` 用 `../docker/` 是因为它相对 `context` 解析，而 Dockerfile 放在 `docker/` 下与其它编排文件同处。

前端构建则取 `context: ../web`，两边互不相见。

## 5. 验证镜像里到底装了什么

规则写了不等于生效。以下检查应当进 CI，**镜像内容要被断言，不能靠肉眼**：

```bash
# 1) 上下文有多大（构建日志首行；BuildKit 用 --progress=plain 查看 load build context）
docker build --progress=plain -f docker/python-service.Dockerfile \
  --build-arg SERVICE=auth-server server/ 2>&1 | grep -i 'transferring context'

# 2) 镜像里不该出现别的服务
docker run --rm auth-server:latest sh -c 'ls /app/services'
# 期望只有 auth-server 一项

# 3) 断言重依赖没有混入（auth-server 不该有 sklearn / matplotlib / torch）
docker run --rm auth-server:latest sh -c \
  'ls /app/.venv/lib/python3.12/site-packages | grep -Ei "sklearn|scikit|matplotlib|torch" && exit 1 || exit 0'

# 4) 断言不以 root 运行
test "$(docker run --rm auth-server:latest id -u)" = "10001"

# 5) 镜像体积上限（防止长期劣化）
docker image inspect auth-server:latest --format '{{.Size}}'
```

第 2、3、4 条应当写成 CI 里的硬断言。镜像体积设上限阈值，超限即失败——没有闸门，镜像只会越来越大。

## 6. 不许进镜像的东西

- **`.env` 与任何真实凭据**。配置经环境变量或密钥管理注入运行时，不烘进镜像层。**镜像层是不可删除的**——某一层 `COPY` 进来、后一层 `rm` 掉，文件仍留在历史层里可被提取。
- **`.git/`**：含全部历史与可能已删除的密钥。
- **测试代码与测试依赖**：`--no-dev` + `.dockerignore` 排除 `**/tests/`。
- **编译工具链**：留在 builder 阶段。
- **其他服务的源码**：由 §3 的 `COPY services/${SERVICE}/` 保证。

## 7. 落地前必须验证的两处

本文的 Dockerfile 是设计，尚未在真实构建中跑过。第一次落地时重点确认：

1. **`uv sync --frozen --package` 在只拷贝部分源码时能否通过 workspace 一致性检查。** 依赖层只有各成员的 `pyproject.toml`、没有源码，`--frozen` 可能因 workspace 与锁文件不一致而失败。退路是改用 `uv export --package ${SERVICE} --no-dev` 生成 requirements 再安装。
2. **`--no-install-workspace` 的行为**（uv 版本间差异较大）：它应当只装第三方依赖、不装 workspace 成员本身，让源码层的第二次 `uv sync` 来装。

验证通过后，§5 的五条检查全部进 CI，此后镜像内容由断言守住，不再靠肉眼。
