# collector-server 镜像。构建上下文取 server/，web/ 与 docs/ 天然不在其中。
#
# ⚠ 密钥绝不进镜像层：镜像层不可删除，某层 COPY 进来、后层 rm 掉，
# 文件仍在历史层里可被提取。全部走运行时环境变量。
#
# ⚠ 这个容器必须能路由到工控网段（host network / macvlan / 宿主机静态路由），
# 属节点级部署前置条件，见 ARCHITECTURE §7。

FROM ghcr.io/astral-sh/uv:0.9.30-python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /src

# 先只拷元数据装依赖：源码改动不会让依赖层失效
COPY pyproject.toml uv.lock ./
COPY lib/pyproject.toml lib/
COPY domain/timeseries/pyproject.toml domain/timeseries/
COPY services/collector-server/pyproject.toml services/collector-server/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package collector-server --frozen --no-install-project --no-dev

COPY lib/ lib/
COPY domain/timeseries/ domain/timeseries/
COPY services/collector-server/ services/collector-server/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package collector-server --frozen --no-dev


FROM python:3.12-slim-bookworm AS runtime

# 非 root 运行
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

ENV PATH="/src/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# ⚠ 运行期的工作目录是**服务目录**而不是 /src：`alembic.ini` 在这里，
# 站在 /src 上跑 `alembic upgrade head` 会以「No 'script_location' key found」
# 失败——而部署手册里那条命令正是这么写的。
WORKDIR /src/services/collector-server
COPY --from=builder --chown=app:app /src /src

USER app

# 只有探针。采集的输入是内部 HTTP 与 Redis，输出是快照与 collect schema
EXPOSE 8007

# 可执行名由 pyproject 的 [project.scripts] 提供
CMD ["collector-server"]
