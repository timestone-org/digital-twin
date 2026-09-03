"""要登录的那几路此刻登没登录——问 platform 的内部凭据面（ADR-0041）。

守的是降级方向：「还没登录」如实报未连接（界面据此指向模型管理页），
而「平台此刻不可达」**仍报已连接**——报未连接的话，平台抖一下会让界面说
「去登录一次」，而那一次登录同样打不通平台。
"""

import datetime as dt
from typing import Any

import httpx
import pytest

from ai_assistant.llm.logins import PlatformLogins
from llmcore import CodexTokenClient


def _body() -> dict[str, Any]:
    later = dt.datetime.now(dt.UTC) + dt.timedelta(minutes=30)
    return {
        "code": 0,
        "message": "ok",
        "trace_id": "t",
        "data": {
            "access_token": "at-1",
            "expires_at": later.isoformat(),
            "account_id": "acc-1",
        },
    }


def _logins(answer: httpx.Response | Exception) -> PlatformLogins:
    def handle(_request: httpx.Request) -> httpx.Response:
        if isinstance(answer, Exception):
            raise answer
        return answer

    client = CodexTokenClient(
        base_url="http://platform", service_key="k" * 32, timeout_s=1.0
    )
    client.use_transport(httpx.MockTransport(handle))
    return PlatformLogins(tokens=client)


async def test_a_lane_that_leases_a_token_reads_as_connected() -> None:
    made = await _logins(httpx.Response(200, json=_body())).status("p1")
    assert made.is_connected is True


@pytest.mark.parametrize(
    "answer",
    [
        httpx.Response(404, json={"code": 42408, "message": "x"}),
        httpx.Response(409, json={"code": 42411, "message": "x"}),
    ],
    ids=["never-logged-in", "reconnect-needed"],
)
async def test_a_lane_without_a_usable_login_reads_as_not_connected(
    answer: httpx.Response,
) -> None:
    made = await _logins(answer).status("p1")
    assert made.is_connected is False


async def test_a_platform_blip_does_not_turn_into_go_log_in_again(
    # 报未连接的话，界面会说「去登录一次」，而那一次登录同样打不通平台
) -> None:
    made = await _logins(httpx.ConnectError("refused")).status("p1")
    assert made.is_connected is True
