# knowledge-server 镜像。构建上下文取 server/，web/ 与 docs/ 天然不在其中。
#
# ⚠ 密钥绝不进镜像层：镜像层不可删除，某层 COPY 进来、后层 rm 掉，
# 文件仍在历史层里可被提取。全部走运行时环境变量。
#
# ⚠ 同一份镜像跑两个角色（api / worker），由 KNOWLEDGE_APP_ROLE 分叉。
# 不为运行角色另建镜像：代码单元 ≠ 部署单元（ADR-0002）。

FROM ghcr.io/astral-sh/uv:0.9.30-python3.12-bookworm-slim AS builder

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /src

# 先只拷元数据装依赖：源码改动不会让依赖层失效
COPY pyproject.toml uv.lock ./
COPY lib/pyproject.toml lib/
COPY domain/llmcore/pyproject.toml domain/llmcore/
COPY services/knowledge-server/pyproject.toml services/knowledge-server/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package knowledge-server --frozen --no-install-project --no-dev

COPY lib/ lib/
COPY domain/llmcore/ domain/llmcore/
# 只拷运行期需要的服务文件；测试、覆盖率产物和本地配置都不进入镜像层。
COPY services/knowledge-server/src/ services/knowledge-server/src/
COPY services/knowledge-server/migrations/ services/knowledge-server/migrations/
COPY services/knowledge-server/alembic.ini services/knowledge-server/alembic.ini
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --package knowledge-server --frozen --no-dev


FROM python:3.12-slim-bookworm AS runtime

# DOCX 原件预览由 worker 派生 PDF（ADR-0054）。同镜像跑 api/worker，故只装一份。
# 只装 Writer 的 nogui 变体；中文字体决定现场手册会不会变成方框。
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      fonts-noto-cjk \
      libreoffice-writer-nogui \
 && rm -rf /var/lib/apt/lists/* \
 && soffice --headless --version

# 非 root 运行
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

ENV PATH="/src/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# builder 可带测试来完成 workspace 安装，运行层只取虚拟环境与生产源码。
COPY --from=builder --chown=app:app /src/.venv /src/.venv
COPY --from=builder --chown=app:app /src/lib/src /src/lib/src
COPY --from=builder --chown=app:app /src/domain/llmcore/src /src/domain/llmcore/src
COPY --from=builder --chown=app:app /src/services/knowledge-server/src /src/services/knowledge-server/src
COPY --from=builder --chown=app:app /src/services/knowledge-server/migrations /src/services/knowledge-server/migrations
COPY --from=builder --chown=app:app /src/services/knowledge-server/alembic.ini /src/services/knowledge-server/alembic.ini
# ⚠ 落在服务目录：alembic 按 CWD 找自己那份迁移，停在 /src 会让部署期迁移失败
WORKDIR /src/services/knowledge-server

USER app
EXPOSE 8009

# 可执行名由 pyproject 的 [project.scripts] 提供，不再各写一份 entrypoint 脚本
CMD ["knowledge-server"]
