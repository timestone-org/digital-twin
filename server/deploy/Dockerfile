# 专用部署镜像执行全部属主迁移，不包含业务运行时的重工具链。
FROM ghcr.io/astral-sh/uv:0.9.30-python3.12-bookworm-slim AS builder

ENV UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /src

COPY pyproject.toml uv.lock ./
COPY lib/pyproject.toml lib/
COPY domain/collectwire/pyproject.toml domain/collectwire/
COPY domain/llmcore/pyproject.toml domain/llmcore/
COPY domain/timeseries/pyproject.toml domain/timeseries/
COPY services/auth-server/pyproject.toml services/auth-server/
COPY services/platform-server/pyproject.toml services/platform-server/
COPY services/collector-server/pyproject.toml services/collector-server/
COPY services/opcua-server/pyproject.toml services/opcua-server/
COPY services/realtime-hub/pyproject.toml services/realtime-hub/
COPY services/ai-assistant/pyproject.toml services/ai-assistant/
COPY services/knowledge-server/pyproject.toml services/knowledge-server/

RUN --mount=type=cache,target=/root/.cache/uv \
    uv export --frozen --no-dev --no-emit-workspace \
      --package lib --package llmcore --package auth-server \
      --extra db --extra auth --extra crypto --extra s3 --extra web \
      --output-file /tmp/migration-requirements.txt >/dev/null \
 && uv venv /src/.venv \
 && uv pip install --python /src/.venv/bin/python --require-hashes \
      --requirements /tmp/migration-requirements.txt

FROM python:3.12-slim-bookworm AS runtime
RUN groupadd --gid 10001 app \
 && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

ENV PATH="/src/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH="/src/lib/src:/src/domain/collectwire/src:/src/domain/llmcore/src:/src/domain/timeseries/src:/src/services/auth-server/src:/src/services/platform-server/src:/src/services/collector-server/src:/src/services/opcua-server/src:/src/services/realtime-hub/src:/src/services/ai-assistant/src:/src/services/knowledge-server/src"

WORKDIR /src
COPY --from=builder --chown=app:app /src/.venv /src/.venv
COPY --chown=app:app lib/src/ lib/src/
COPY --chown=app:app domain/collectwire/src/ domain/collectwire/src/
COPY --chown=app:app domain/llmcore/src/ domain/llmcore/src/
COPY --chown=app:app domain/timeseries/src/ domain/timeseries/src/
COPY --chown=app:app services/auth-server/src/ services/auth-server/src/
COPY --chown=app:app services/auth-server/migrations/ services/auth-server/migrations/
COPY --chown=app:app services/auth-server/alembic.ini services/auth-server/alembic.ini
COPY --chown=app:app services/auth-server/scripts/seed.py services/auth-server/scripts/seed.py
COPY --chown=app:app services/platform-server/src/ services/platform-server/src/
COPY --chown=app:app services/platform-server/migrations/ services/platform-server/migrations/
COPY --chown=app:app services/platform-server/alembic.ini services/platform-server/alembic.ini
COPY --chown=app:app services/platform-server/scripts/seed.py services/platform-server/scripts/seed.py
COPY --chown=app:app services/collector-server/src/ services/collector-server/src/
COPY --chown=app:app services/collector-server/migrations/ services/collector-server/migrations/
COPY --chown=app:app services/collector-server/alembic.ini services/collector-server/alembic.ini
COPY --chown=app:app services/opcua-server/src/ services/opcua-server/src/
COPY --chown=app:app services/opcua-server/migrations/ services/opcua-server/migrations/
COPY --chown=app:app services/opcua-server/alembic.ini services/opcua-server/alembic.ini
COPY --chown=app:app services/realtime-hub/src/ services/realtime-hub/src/
COPY --chown=app:app services/realtime-hub/migrations/ services/realtime-hub/migrations/
COPY --chown=app:app services/realtime-hub/alembic.ini services/realtime-hub/alembic.ini
COPY --chown=app:app services/ai-assistant/src/ services/ai-assistant/src/
COPY --chown=app:app services/ai-assistant/migrations/ services/ai-assistant/migrations/
COPY --chown=app:app services/ai-assistant/alembic.ini services/ai-assistant/alembic.ini
COPY --chown=app:app services/knowledge-server/src/ services/knowledge-server/src/
COPY --chown=app:app services/knowledge-server/migrations/ services/knowledge-server/migrations/
COPY --chown=app:app services/knowledge-server/alembic.ini services/knowledge-server/alembic.ini
COPY --chown=app:app deploy/migrate.py deploy/migrate.py

USER app
ENTRYPOINT ["python", "/src/deploy/migrate.py"]
