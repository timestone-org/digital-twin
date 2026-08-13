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
COPY services/platform-server/pyproject.toml services/platform-server/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package platform-server --frozen --no-install-project --no-dev

COPY lib/ lib/
COPY services/platform-server/ services/platform-server/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package platform-server --frozen --no-dev


FROM python:3.12-slim-bookworm AS runtime

# 非 root 运行
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

ENV PATH="/src/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

COPY --from=builder --chown=app:app /src /src
# ⚠ 落在服务目录：alembic 与 `python -m scripts.<名>` 都按 CWD 找自己那份，
# 停在 /src 会让部署期的迁移/种子命令逐个失败
WORKDIR /src/services/platform-server

USER app
EXPOSE 8005

# 可执行名由 pyproject 的 [project.scripts] 提供，不再各写一份 entrypoint 脚本
CMD ["platform-server"]
