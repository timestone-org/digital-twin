# realtime-hub 镜像。构建上下文取 server/，web/ 与 docs/ 天然不在其中。
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
COPY services/realtime-hub/pyproject.toml services/realtime-hub/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package realtime-hub --frozen --no-install-project --no-dev

COPY lib/ lib/
COPY services/realtime-hub/ services/realtime-hub/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package realtime-hub --frozen --no-dev


FROM python:3.12-slim-bookworm AS runtime

# 非 root 运行
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

ENV PATH="/src/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# ⚠ 运行期的工作目录是**服务目录**而不是 /src：`alembic.ini` 在这里，
# 站在 /src 上跑 `alembic upgrade head` 会以「No 'script_location' key found」
# 失败——而部署手册里那条命令正是这么写的。可执行入口是 console script，
# 从哪个目录起都一样，所以换到这里没有代价。
WORKDIR /src/services/realtime-hub
COPY --from=builder --chown=app:app /src /src

USER app

EXPOSE 8000

# 可执行名由 pyproject 的 [project.scripts] 提供，不再各写一份 entrypoint 脚本
CMD ["realtime-hub"]
