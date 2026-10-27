"""BDM HTTP 边界的请求方式、响应校验、大小上限与凭据隔离。"""

import json

import httpx
import pytest
from pydantic import BaseModel, SecretStr

from platform_server.apps.modeling.services.bdm_client import (
    BdmClient,
    BdmConnection,
    BdmReadFailed,
)

SECRET = "test-bdm-client-key-" + "x" * 32


class Reading(BaseModel):
    value: int


def connection() -> BdmConnection:
    return BdmConnection(
        base_url="https://bdm.example.test",
        api_key=SecretStr(SECRET),
        timezone="Asia/Shanghai",
        timeout_s=1,
        load_timeout_s=5,
    )


@pytest.mark.parametrize("method", ["GET", "POST"])
async def test_request_preserves_method_auth_and_trace(method: str) -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.method == method
        assert request.url.host == "bdm.example.test"
        assert request.url.path == "/api/bdm/training-data/points"
        assert request.headers["X-API-Key"] == SECRET
        assert request.headers["traceparent"]
        assert request.url.params["page"] == "2"
        if method == "POST":
            assert json.loads(request.content) == {"pointIds": ["p1"]}
        return httpx.Response(200, json={"code": 200, "data": {"value": 7}})

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        result = await client.read(
            "/points",
            Reading,
            params={"page": 2},
            payload={"pointIds": ["p1"]} if method == "POST" else None,
        )
    assert result.value == 7


@pytest.mark.parametrize("status", [302, 400, 401, 403, 404, 500, 503])
async def test_http_failure_is_redacted_and_never_retried(status: int) -> None:
    destinations: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        destinations.append(str(request.url))
        return httpx.Response(
            status,
            headers={"Location": "https://other.example.test/"},
            json={"code": status, "message": SECRET},
        )

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(BdmReadFailed) as caught:
            await client.read("/points", Reading)
    assert destinations == [
        "https://bdm.example.test/api/bdm/training-data/points"
    ]
    assert SECRET not in str(caught.value)


@pytest.mark.parametrize(
    "payload",
    [
        {"code": 500, "data": {"value": 7}},
        {"code": 200, "data": None},
        {"code": 200, "data": {"value": "invalid"}},
        {"data": {"value": 7}},
    ],
)
async def test_invalid_business_envelope_is_rejected(
    payload: dict[str, object],
) -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(BdmReadFailed):
            await client.read("/points", Reading)


@pytest.mark.parametrize(
    ("content_type", "content"),
    [
        ("text/html", b"<html>upstream error</html>"),
        ("application/json", b"not json"),
        ("application/json", b" " * 2_000_001),
    ],
)
async def test_non_json_and_oversized_responses_are_rejected(
    content_type: str, content: bytes
) -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, headers={"content-type": content_type}, content=content
        )

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(BdmReadFailed):
            await client.read("/points", Reading)


@pytest.mark.parametrize("error", [httpx.ReadTimeout, httpx.ConnectError])
async def test_transport_errors_do_not_expose_credentials(
    error: type[httpx.HTTPError],
) -> None:
    methods: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        methods.append(request.method)
        raise error(SECRET)

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(BdmReadFailed, match="超时") as caught:
            await client.read("/points", Reading)
    assert methods == ["GET"]
    assert SECRET not in str(caught.value)
