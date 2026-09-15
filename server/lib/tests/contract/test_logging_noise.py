"""默认日志保留状态变化与故障，详细通信和成功请求只在 DEBUG 输出。"""

import json
import logging

import httpx
import pytest
from fastapi import Response

from lib.logging import configure_logging, get_logger
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
