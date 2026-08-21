# platform-server 镜像。构建上下文取 server/，web/ 与 docs/ 天然不在其中。
#
# ⚠ 密钥绝不进镜像层：镜像层不可删除，某层 COPY 进来、后层 rm 掉，
# 文件仍在历史层里可被提取。全部走运行时环境变量。

FROM ghcr.io/astral-sh/uv:0.9.30-python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /src

# 先只拷元数据装依赖：源码改动不会让依赖层失效
COPY pyproject.toml uv.lock ./
COPY lib/pyproject.toml lib/
# ⚠ 依赖里有哪个 workspace 成员，这里就要拷它的 pyproject：`--frozen` 按锁文件
# 找本地成员，缺一个就是 `Distribution not found at file:///src/...`，
# 而报错发生在装依赖那层，与「谁依赖了它」隔着两个文件
COPY domain/timeseries/pyproject.toml domain/timeseries/
COPY domain/collectwire/pyproject.toml domain/collectwire/
COPY services/platform-server/pyproject.toml services/platform-server/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package platform-server --frozen --no-install-project --no-dev

COPY lib/ lib/
COPY domain/timeseries/ domain/timeseries/
COPY domain/collectwire/ domain/collectwire/
COPY services/platform-server/ services/platform-server/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package platform-server --frozen --no-dev


# glTF 压缩工具链。⚠ Python 侧没有可用的 glTF Draco 编码器，这是这个镜像里
# 出现 Node 的唯一原因（ADR-0022）。只有 worker 角色会用到它，但三个角色共用
# 一个镜像，故 api 与 publisher 也白背着——拆成两个镜像的代价是构建与部署各多一套
FROM node:22-bookworm-slim AS nodetools

WORKDIR /nodetools
# 先只拷清单：脚本改动不会让 npm 那层失效
COPY services/platform-server/nodetools/package.json \
     services/platform-server/nodetools/package-lock.json ./
# ⚠ `npm ci` 而不是 `npm install`：前者严格照锁文件装，后者会在锁文件与清单
# 不一致时**默默改锁文件**，于是镜像里装的和仓里锁的不是同一批
RUN npm ci --omit=dev --no-audit --no-fund
COPY services/platform-server/nodetools/compress-model.mjs ./


FROM python:3.12-slim-bookworm AS runtime

# 非 root 运行
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

ENV PATH="/src/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Node 运行时与压缩工具。⚠ 只拷 node 二进制与它要的动态库，不装整个
# nodejs 包：后者会把 npm、corepack 与一串文档一起拖进来
COPY --from=nodetools /usr/local/bin/node /usr/local/bin/node
COPY --from=nodetools --chown=app:app /nodetools /app/nodetools

COPY --from=builder --chown=app:app /src /src
# ⚠ 落在服务目录：alembic 与 `python -m scripts.<名>` 都按 CWD 找自己那份，
# 停在 /src 会让部署期的迁移/种子命令逐个失败
WORKDIR /src/services/platform-server

USER app
EXPOSE 8005

# 可执行名由 pyproject 的 [project.scripts] 提供，不再各写一份 entrypoint 脚本
CMD ["platform-server"]
