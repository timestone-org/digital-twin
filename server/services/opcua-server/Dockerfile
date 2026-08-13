# opcua-server 镜像。构建上下文取 server/，web/ 与 docs/ 天然不在其中。
#
# ⚠ 密钥绝不进镜像层：镜像层不可删除，某层 COPY 进来、后层 rm 掉，
# 文件仍在历史层里可被提取。全部走运行时环境变量。
#
# ⚠ 服务器私钥不在镜像里，也不在数据库里——它只在 OPCUA_PKI_DIR 指向的
# 挂载卷上。镜像换了、库备份外流了，私钥都不跟着走。

FROM ghcr.io/astral-sh/uv:0.9.30-python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /src

# 先只拷元数据装依赖：源码改动不会让依赖层失效
COPY pyproject.toml uv.lock ./
COPY lib/pyproject.toml lib/
COPY services/opcua-server/pyproject.toml services/opcua-server/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package opcua-server --frozen --no-install-project --no-dev

COPY lib/ lib/
COPY services/opcua-server/ services/opcua-server/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package opcua-server --frozen --no-dev


FROM python:3.12-slim-bookworm AS runtime

# 非 root 运行
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

ENV PATH="/src/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    OPCUA_PKI_DIR=/var/lib/opcua/pki

# ⚠ 运行期的工作目录是**服务目录**而不是 /src：`alembic.ini` 在这里，
# 站在 /src 上跑 `alembic upgrade head` 会以「No 'script_location' key found」
# 失败——而部署手册里那条命令正是这么写的。可执行入口是 console script，
# 从哪个目录起都一样，所以换到这里没有代价。
WORKDIR /src/services/opcua-server
COPY --from=builder --chown=app:app /src /src

# PKI 目录要能被非 root 写：自签证书在首次启动时生成
RUN mkdir -p /var/lib/opcua/pki && chown -R app:app /var/lib/opcua

USER app

# HTTP 管理面。opc.tcp 的实例端口段由编排层直接映射，不经边缘网关，
# 故不在这里 EXPOSE——端口池是部署期常量，见 CONTEXT.md §2。
EXPOSE 8008

# 可执行名由 pyproject 的 [project.scripts] 提供，不再各写一份 entrypoint 脚本
CMD ["opcua-server"]
