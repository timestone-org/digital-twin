"""锁住探针语义与日志字段集。

⚠ liveness 不查依赖、readiness 查依赖但有超时；日志的 `event` 是稳定字面量，
可变部分一律进字段，否则同一类事件无法聚合计数、无法建告警。
"""

import asyncio
import json
import logging
from collections.abc import AsyncIterator

import httpx
import pytest

from lib.logging import bind_log_context, get_logger, reset_log_context
from lib.logging.logger import configure_logging
from lib.web import ReadinessProbe, Runtime, bootstrap, create_app


def _capture(*, level: str) -> list[dict[str, object]]:
    """装配日志器并挂一个只收结构化字段的处理器。

    ⚠ 不能用 caplog：`configure_logging` 会整体替换根处理器，把 caplog
    自己挂的那个也一起换掉，records 会恒为空。
    """
    configure_logging(service="svc", role="api", instance="i-1", level=level)
    collected: list[dict[str, object]] = []

    class _Sink(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            payload = getattr(record, "payload", None)
            if isinstance(payload, dict):
                collected.append(payload)

    logging.getLogger().addHandler(_Sink())
    return collected


@pytest.fixture
async def ready_app() -> AsyncIterator[tuple[httpx.AsyncClient, list[str]]]:
    called: list[str] = []

    async def healthy() -> bool:
        called.append("healthy")
        return True

    app = create_app(
        title="probe",
        prefix="/api/v1/p",
        runtime=Runtime(readiness_probes=(ReadinessProbe("db", healthy),)),
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://t"
        ) as client,
    ):
        yield client, called


async def test_liveness_answers_without_touching_dependencies(
    ready_app: tuple[httpx.AsyncClient, list[str]],
) -> None:
    client, called = ready_app
    response = await client.get("/api/v1/p/health")
    assert response.status_code == 200
    assert called == []


async def test_readiness_runs_the_probes(
    ready_app: tuple[httpx.AsyncClient, list[str]],
) -> None:
    client, called = ready_app
    response = await client.get("/api/v1/p/ready")
    assert response.status_code == 200
    assert called == ["healthy"]


async def test_readiness_is_not_ready_before_startup_completes() -> None:
    app = create_app(title="probe", prefix="/api/v1/p")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://t"
    ) as client:
        response = await client.get("/api/v1/p/ready")
    assert response.status_code == 503
    assert response.json()["reason"] == "starting"


async def test_a_failing_dependency_makes_the_instance_not_ready() -> None:
    async def broken() -> bool:
        return False

    app = create_app(
        title="probe",
        prefix="/api/v1/p",
        runtime=Runtime(readiness_probes=(ReadinessProbe("db", broken),)),
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://t"
        ) as client,
    ):
        response = await client.get("/api/v1/p/ready")
    assert response.status_code == 503
    assert response.json()["failed"] == ["db"]


async def test_a_hanging_probe_is_bounded_and_counts_as_failed() -> None:
    async def hang() -> bool:
        await asyncio.sleep(30)
        return True

    app = create_app(
        title="probe",
        prefix="/api/v1/p",
        runtime=Runtime(readiness_probes=(ReadinessProbe("slow", hang),)),
    )
    original = bootstrap.READINESS_PROBE_TIMEOUT_S
    bootstrap.READINESS_PROBE_TIMEOUT_S = 0.05
    try:
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://t",
            ) as client,
        ):
            response = await client.get("/api/v1/p/ready")
    finally:
        bootstrap.READINESS_PROBE_TIMEOUT_S = original
    assert response.status_code == 503


async def test_a_raising_probe_counts_as_failed() -> None:
    async def explode() -> bool:
        raise RuntimeError("down")

    app = create_app(
        title="probe",
        prefix="/api/v1/p",
        runtime=Runtime(readiness_probes=(ReadinessProbe("db", explode),)),
    )
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://t"
        ) as client,
    ):
        response = await client.get("/api/v1/p/ready")
    assert response.json()["failed"] == ["db"]


def test_log_line_carries_the_required_field_set() -> None:
    captured = _capture(level="INFO")
    logger = get_logger("test")
    token = bind_log_context(trace_id="t" * 32, span_id="s" * 16)
    logger.info("thing_happened", "人话", duration_ms=1.5)
    reset_log_context(token)
    payload = captured[-1]
    assert payload["event"] == "thing_happened"
    assert payload["service"] == "svc"
    assert payload["role"] == "api"
    assert payload["instance"] == "i-1"
    assert payload["trace_id"] == "t" * 32
    assert payload["duration_ms"] == 1.5
    assert payload["ts"].endswith("Z")


def test_error_field_is_structured_not_a_bare_string() -> None:
    captured = _capture(level="ERROR")
    get_logger("test").error("boom", "失败", error=ValueError("bad"))
    error = captured[-1]["error"]
    assert error["type"] == "ValueError"
    assert "bad" in error["message"]
    assert "ValueError" in error["stack"]


def test_json_formatter_emits_one_parsable_line() -> None:
    configure_logging(service="svc", role="api", instance="i-1")
    handler = logging.getLogger().handlers[0]
    record = logging.LogRecord("n", logging.INFO, "f", 1, "msg", None, None)
    record.payload = {"event": "e", "msg": "m"}
    line = handler.format(record)
    assert "\n" not in line
    assert json.loads(line)["event"] == "e"


def test_text_formatter_keeps_the_same_field_set() -> None:
    configure_logging(
        service="svc", role="api", instance="i-1", log_format="text"
    )
    handler = logging.getLogger().handlers[0]
    record = logging.LogRecord("n", logging.INFO, "f", 1, "msg", None, None)
    record.payload = {
        "ts": "2026-01-01T00:00:00.000Z",
        "level": "INFO",
        "event": "e",
        "msg": "m",
        "extra": 1,
    }
    line = handler.format(record)
    assert "e" in line
    assert "extra=1" in line


def test_debug_below_the_level_is_not_emitted() -> None:
    captured = _capture(level="INFO")
    get_logger("test").debug("noisy")
    assert captured == []
