"""守拉计划这一跳：走内部面、带服务级密钥、任何失败都收敛成 PlanUnavailable。

⚠ 不在这一层重试：重试归主循环，逐层重试会相乘成雪崩。
"""

import httpx
import pytest

from collector_server.apps.collect.errors import PlanUnavailable
from collector_server.apps.collect.plan.client import PLAN_PATH, PlanClient

SERVICE_KEY = "collector-test-service-key-0123456789ab"
PLAN_BODY = {
    "code": 0,
    "message": "ok",
    "data": {
        "version": "v7",
        "sources": [
            {
                "source_id": "0192f000-0000-7000-8000-000000000001",
                "code": "line-1",
                "protocol": "opcua",
                "endpoint": "opc.tcp://127.0.0.1:4840/line-1",
                "read_mode": "subscribe",
                "points": [
                    {
                        "point_code": "outlet_temp",
                        "address": "ns=2;s=Temp1",
                        "sampling_interval_ms": 1000,
                    }
                ],
            }
        ],
    },
}


def _client(handler: object) -> PlanClient:
    made = PlanClient(
        base_url="http://platform-server:8005",
        service_key=SERVICE_KEY,
        timeout_s=5.0,
    )
    made._transport = httpx.MockTransport(handler)
    return made


async def test_plan_is_read_out_of_the_envelope_data() -> None:
    made = _client(lambda _request: httpx.Response(200, json=PLAN_BODY))
    plan = await made.fetch()
    assert plan.version == "v7"
    assert plan.sources[0].points[0].point_code == "outlet_temp"


async def test_request_goes_to_the_internal_path_with_the_service_key() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json=PLAN_BODY)

    await _client(handler).fetch()
    assert seen[0].url.path == PLAN_PATH
    assert seen[0].headers["X-Service-Key"] == SERVICE_KEY


@pytest.mark.parametrize(
    "status", [401, 500, 503], ids=["denied", "boom", "down"]
)
async def test_error_status_becomes_plan_unavailable(status: int) -> None:
    made = _client(lambda _request: httpx.Response(status, json={}))
    with pytest.raises(PlanUnavailable):
        await made.fetch()


async def test_malformed_body_becomes_plan_unavailable() -> None:
    made = _client(
        lambda _request: httpx.Response(200, json={"data": {"version": ""}})
    )
    with pytest.raises(PlanUnavailable):
        await made.fetch()


async def test_transport_failure_becomes_plan_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("连不上", request=request)

    with pytest.raises(PlanUnavailable):
        await _client(handler).fetch()
