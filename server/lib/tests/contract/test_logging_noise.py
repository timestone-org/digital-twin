"""默认日志保留状态变化与故障，详细通信和成功请求只在 DEBUG 输出。"""

import json
import logging

import httpx
import pytest
from fastapi import Response
from starlette.background import BackgroundTask

from lib.logging import configure_logging, get_logger
from lib.logging.context import bind_log_context, reset_log_context
from lib.web import create_app


@pytest.mark.parametrize("level", ["INFO", "WARNING", "ERROR", "DEBUG"])
@pytest.mark.parametrize("explicit_level", [logging.NOTSET, logging.DEBUG])
def test_standard_logging_respects_noise_policy(
    level: str,
    explicit_level: int,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configure_logging(service="svc", role="api", instance="one", level=level)
    external = logging.getLogger("external.transport")
    monkeypatch.setattr(external, "level", explicit_level)
    external.setLevel(explicit_level)
    external.debug("packet")
    external.info("publish callback")
    external.warning("connection lost")
    external.error("transport failed")
    get_logger("application").info("service_started")
    output = capsys.readouterr().out
    assert ("packet" in output) == (level == "DEBUG")
    assert ("publish callback" in output) == (level == "DEBUG")
    assert ("connection lost" in output) == (level != "ERROR")
    assert "transport failed" in output
    assert ("service_started" in output) == (level in {"INFO", "DEBUG"})


@pytest.mark.parametrize("level", ["INFO", "DEBUG"])
@pytest.mark.parametrize("status", [200, 204, 302, 400, 404, 500, 503])
async def test_access_logs_keep_failures_and_debug_successes(
    level: str, status: int, capsys: pytest.CaptureFixture[str]
) -> None:
    configure_logging(service="svc", role="api", instance="one", level=level)
    app = create_app(title="test", prefix="/api/v1/test")

    @app.get("/result")
    async def result() -> Response:
        return Response(status_code=status)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.get("/result")
    records = [
        json.loads(line) for line in capsys.readouterr().out.splitlines()
    ]
    access = [record for record in records if record["event"] == "http_request"]
    if status < 400 and level == "INFO":
        assert access == []
    else:
        assert len(access) == 1
        expected = (
            "ERROR"
            if status >= 500
            else "WARNING" if status >= 400 else "DEBUG"
        )
        assert access[0]["level"] == expected
        assert access[0]["status"] == status
        assert access[0]["trace_id"]


async def test_an_unhandled_crash_still_leaves_an_access_line(
    capsys: pytest.CaptureFixture[str],
) -> None:
    """⚠ 真崩溃是最要紧的那种 5xx，访问日志里没有它，按 status 计数的告警
    就数不到。"""
    configure_logging(service="svc", role="api", instance="one", level="INFO")
    app = create_app(title="test", prefix="/api/v1/test")

    @app.get("/boom")
    async def boom() -> Response:
        raise RuntimeError("崩了")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    ) as client:
        response = await client.get("/boom")
    records = [
        json.loads(line) for line in capsys.readouterr().out.splitlines()
    ]
    access = [record for record in records if record["event"] == "http_request"]
    assert response.status_code == 500
    assert len(access) == 1
    assert access[0]["status"] == 500
    assert access[0]["level"] == "ERROR"
    assert access[0]["route"] == "/boom"
    assert access[0]["trace_id"] == response.json()["trace_id"]
    failure = next(
        record for record in records if record["event"] == "unhandled_exception"
    )
    assert (failure["trace_id"], failure["span_id"]) == (
        access[0]["trace_id"],
        access[0]["span_id"],
    )
    assert (
        response.headers["traceparent"]
        == f"00-{failure['trace_id']}-{failure['span_id']}-01"
    )


async def test_background_crash_uses_the_sent_span_and_request_identity(
    capsys: pytest.CaptureFixture[str],
) -> None:
    configure_logging(service="svc", role="api", instance="one", level="DEBUG")
    app = create_app(title="test", prefix="/api/v1/test")

    async def after_send() -> None:
        raise RuntimeError("late fixture failure")

    @app.get("/late")
    async def late() -> Response:
        return Response("sent", background=BackgroundTask(after_send))

    ambient = bind_log_context(user_id="outer-task", route="outer-job")
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://test",
            timeout=10,
        ) as client:
            response = await client.get("/late")
    finally:
        reset_log_context(ambient)
    assert response.status_code == 200
    entries = [
        json.loads(line) for line in capsys.readouterr().out.splitlines()
    ]
    error = next(
        row for row in entries if row.get("event") == "unhandled_exception"
    )
    access = next(row for row in entries if row.get("event") == "http_request")
    header = response.headers["traceparent"]
    assert header == f"00-{error['trace_id']}-{error['span_id']}-01"
    assert header == f"00-{access['trace_id']}-{access['span_id']}-01"
    assert error.get("user_id") != "outer-task"
    assert access.get("user_id") != "outer-task"
