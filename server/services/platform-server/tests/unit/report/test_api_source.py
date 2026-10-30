"""报告 API 的出站访问、报告期展开、精确映射与有界失败。"""

import asyncio
import json
import socket
from datetime import UTC, datetime
from decimal import Decimal
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError
from unit.report.api_source_fakes import connection, read, source

from lib.errors.handlers import register_exception_handlers
from platform_server.apps.report.errors import (
    ReportApiReadFailed,
    ReportInvalid,
)
from platform_server.apps.report.services.api_source import (
    ApiSourceReader,
    fetch_api_sources,
)


@pytest.mark.parametrize(
    "path",
    [
        "https://evil.test/data",
        "//evil.test",
        "/../data",
        "/%2e%2e/data",
        "/%252e%252e/data",
        "/ok?token=secret",
        "/ok#fragment",
        "/\\evil",
        "/%2fmetadata",
        "/a/./b",
        "/a\nb",
    ],
)
def test_template_path_cannot_override_deployment_target(path):
    with pytest.raises(ValidationError, match="API 路径"):
        source(path=path)


@pytest.mark.parametrize(
    "changes",
    [
        {"query": {"api_key": "secret"}},
        {"query": {"accessToken": "secret"}},
        {"method": "POST", "body": {"nested": [{"password": "secret"}]}},
        {"body": {"factory": "one"}},
        {"columns": [{"key": "x", "name": "x", "pointer": "/bad~3"}]},
    ],
)
def test_template_config_rejects_secrets_and_invalid_pointers(changes):
    with pytest.raises(ValidationError):
        source(**changes)


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://user:secret@example.test",
        "http://169.254.169.254/meta",
        "http://100.100.100.200/meta",
        "http://[fd00:ec2::254]/meta",
        "http://127.0.0.1/?x=1",
        "https://example.test/#part",
    ],
)
def test_deployment_connection_rejects_metadata_and_url_secrets(endpoint):
    with pytest.raises(ValidationError):
        connection(base_url=endpoint)


async def test_decimal_zero_null_and_json_pointer_escaping_are_preserved():
    result = await read(
        {
            "data": [
                {"value": "9007199254740993.125"},
                {"value": 0},
                {"value": None},
            ]
        }
    )
    rows = result["api:usage"].rows
    assert [row.values["value"] for row in rows] == [
        Decimal("9007199254740993.125"),
        Decimal(0),
        None,
    ]
    assert rows[0].ts == datetime(2026, 9, 30, 16, tzinfo=UTC)
    escaped = source(
        columns=[{"key": "v", "name": "v", "pointer": "/a~1b/~0x"}]
    )
    assert (await read({"data": {"a/b": {"~x": "1.50"}}}, wanted=escaped))[
        "api:usage"
    ].rows[0].values["v"] == Decimal("1.50")


async def test_one_request_expands_offset_post_body_and_keeps_original_host():
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(
            200, content=b'{"data":{"value":1.234567890123456789}}'
        )

    wanted = source(
        offset=-1,
        method="POST",
        query={"period": "{{period}}", "since": "{{start}}"},
        body={"until": "{{end}}", "nested": ["{{timezone}}"]},
    )
    result = await ApiSourceReader(
        [connection()], transport=httpx.MockTransport(handle)
    ).fetch(
        [wanted],
        "2026-10",
        "month",
        "Asia/Shanghai",
    )
    assert len(calls) == 1
    assert calls[0].url.params["period"] == "2026-09"
    assert calls[0].url.params["since"] == "2026-08-31T16:00:00.000Z"
    assert json.loads(calls[0].content) == {
        "until": "2026-09-30T16:00:00.000Z",
        "nested": ["Asia/Shanghai"],
    }
    assert calls[0].headers["host"] == "10.0.0.8"
    assert calls[0].headers["X-API-Key"] == "fixture-only-key"
    assert result["api:usage"].rows[0].values["value"] == Decimal(
        "1.234567890123456789"
    )


async def test_datetime_rows_sorted_and_scalar_text_boolean_mapping():
    wanted = source(
        time_pointer="/time",
        columns=[
            {
                "key": "label",
                "name": "名称",
                "pointer": "/label",
                "data_type": "text",
            },
            {
                "key": "ok",
                "name": "正常",
                "pointer": "/ok",
                "data_type": "boolean",
            },
        ],
    )
    result = await read(
        {
            "data": [
                {
                    "time": "2026-10-02T08:00:00+08:00",
                    "label": "二",
                    "ok": False,
                },
                {"time": "2026-10-01T00:00:00Z", "label": "一", "ok": True},
            ]
        },
        wanted=wanted,
    )
    assert [row.values["label"] for row in result["api:usage"].rows] == [
        "一",
        "二",
    ]
    assert result["api:usage"].rows[0].values["ok"] is True


@pytest.mark.parametrize(
    ("payload", "changes", "message"),
    [
        ({"data": {"other": 1}}, {}, "缺少"),
        ({"data": 12}, {}, "对象或数组"),
        ({"data": [{"value": 1}] * 1001}, {}, "1000 行"),
        ({"data": {"value": "NaN"}}, {}, "有限数值"),
        ({"data": {"value": True}}, {}, "类型不匹配"),
        (
            {"data": {"value": 1, "time": "2026-10-01T00:00:00"}},
            {"time_pointer": "/time"},
            "带时区",
        ),
    ],
)
async def test_response_errors_are_explicit(payload, changes, message):
    with pytest.raises(ReportInvalid, match=message):
        await read(payload, wanted=source(**changes))


@pytest.mark.parametrize(
    ("response", "message", "error_type"),
    [
        (
            httpx.Response(
                302, headers={"Location": "http://169.254.169.254/"}
            ),
            "HTTP 302",
            ReportApiReadFailed,
        ),
        (
            httpx.Response(401, text="token=do-not-expose"),
            "HTTP 401",
            ReportApiReadFailed,
        ),
        (
            httpx.Response(500, text="secret upstream stack"),
            "HTTP 500",
            ReportApiReadFailed,
        ),
        (httpx.Response(200, text="not JSON"), "合法 JSON", ReportInvalid),
        (httpx.Response(200, content=b"x" * 2_000_001), "2 MB", ReportInvalid),
    ],
)
async def test_network_errors_do_not_expose_response_or_follow_redirects(
    response, message, error_type
):
    requests = []

    def handle(request):
        requests.append(request)
        return response

    reader = ApiSourceReader(
        [connection()], transport=httpx.MockTransport(handle)
    )
    with pytest.raises(error_type, match=message) as caught:
        await reader.fetch([source()], "2026-10", "month", "Asia/Shanghai")
    assert len(requests) == 1
    assert "secret" not in str(caught.value)
    assert "do-not-expose" not in str(caught.value)


async def test_dns_is_validated_once_then_ip_is_pinned_with_tls_hostname(
    monkeypatch,
):
    resolver = AsyncMock(
        return_value=[
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.8", 443))
        ]
    )
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", resolver)
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"data": {"value": 1}})

    reader = ApiSourceReader(
        [connection(base_url="https://energy.example:8443/base")],
        transport=httpx.MockTransport(handle),
    )
    await reader.fetch([source()], "2026-10", "month", "UTC")
    assert resolver.await_count == 1
    assert calls[0].url.host == "10.0.0.8"
    assert calls[0].headers["host"] == "energy.example:8443"
    assert calls[0].extensions["sni_hostname"] == "energy.example"


async def test_dns_metadata_answer_is_rejected_before_network(monkeypatch):
    resolver = AsyncMock(
        return_value=[
            (
                socket.AF_INET,
                socket.SOCK_STREAM,
                6,
                "",
                ("169.254.169.254", 443),
            )
        ]
    )
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", resolver)
    reader = ApiSourceReader(
        [connection(base_url="https://energy.example")],
        transport=httpx.MockTransport(
            lambda _: pytest.fail("blocked target was requested")
        ),
    )
    with pytest.raises(ReportInvalid, match="出站访问规则"):
        await reader.fetch([source()], "2026-10", "month", "UTC")


async def test_missing_connection_and_unknown_variables_fail_before_request():
    with pytest.raises(ReportInvalid, match="未配置"):
        await ApiSourceReader([]).fetch([source()], "2026-10", "month", "UTC")
    with pytest.raises(ValidationError, match="不支持"):
        source(query={"period": "{{unknown}}"})


async def test_empty_sources_do_not_require_connection_or_network():
    assert await fetch_api_sources([], [], "2026-10", "month", "UTC") == {}


@pytest.mark.parametrize(
    "headers",
    [
        {"Host": "evil.test"},
        {"Cookie": "session=secret"},
        {"X-Key": "line\r\ninjected"},
        {"X-Key": "one", "x-key": "two"},
    ],
)
def test_connection_headers_reject_injection_routing_and_case_collisions(
    headers,
):
    with pytest.raises(ValidationError):
        connection(headers=headers)


async def test_root_array_and_array_pointer_are_supported_without_fake_rows():
    wanted = source(
        rows_pointer="",
        columns=[
            {"key": "v", "name": "v", "pointer": "/0", "data_type": "number"},
        ],
    )
    result = await read([["1.25"], [None]], wanted=wanted)
    assert [row.values["v"] for row in result["api:usage"].rows] == [
        Decimal("1.25"),
        None,
    ]
    assert (await read([], wanted=wanted))["api:usage"].rows == ()
    with pytest.raises(ReportInvalid, match="缺少"):
        await read([[]], wanted=wanted)


@pytest.mark.parametrize(
    ("content", "message"),
    [
        (b'{"data":{"value":NaN}}', "非有限数值"),
        (
            b'{"data":{"value":1e999999999999999999999999999999999}}',
            "合法 JSON",
        ),
        (b'{"data":{"value":"bad"}}', "有效数值"),
        (b'{"data":{"value":1,"time":"2026-10-40T00:00:00Z"}}', "有效时间"),
    ],
)
async def test_invalid_json_numbers_and_calendar_dates_are_rejected(
    content, message
):
    reader = ApiSourceReader(
        [connection()],
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, content=content)
        ),
    )
    wanted = source(time_pointer="/time") if b'"time"' in content else source()
    with pytest.raises(ReportInvalid, match=message):
        await reader.fetch([wanted], "2026-10", "month", "UTC")


@pytest.mark.parametrize("upstream_status", [401, 503])
async def test_upstream_failure_uses_real_http_503(upstream_status):
    app = FastAPI()
    register_exception_handlers(app)
    reader = ApiSourceReader(
        [connection()],
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                upstream_status, text="private upstream body"
            )
        ),
    )

    @app.post("/preview")
    async def preview_request():
        await reader.fetch([source()], "2026-10", "month", "UTC")
        return {"status": "ok"}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/preview")
    assert response.status_code == 503
    assert response.json()["code"] == 51302
    assert str(upstream_status) in response.json()["message"]
    assert "数据来源「能耗」" in response.json()["message"]
    assert "private upstream" not in response.text


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        (httpx.ConnectError("Authorization=private-token"), "连接失败"),
        (httpx.ReadTimeout("Authorization=private-token"), "取数超时"),
        (socket.gaierror("private DNS target"), "连接失败"),
    ],
)
async def test_transport_failures_are_safe_dependency_errors(failure, message):
    calls = 0

    def handle(_request):
        nonlocal calls
        calls += 1
        raise failure

    reader = ApiSourceReader(
        [connection()], transport=httpx.MockTransport(handle)
    )
    with pytest.raises(ReportApiReadFailed, match=message) as caught:
        await reader.fetch([source()], "2026-10", "month", "UTC")
    assert caught.value.http_status == 503
    assert caught.value.code == 51302
    assert "数据来源「能耗」" in str(caught.value)
    assert "private" not in str(caught.value)
    assert calls == 1


async def test_empty_dns_answer_is_a_dependency_error(monkeypatch):
    monkeypatch.setattr(
        asyncio.get_running_loop(), "getaddrinfo", AsyncMock(return_value=[])
    )
    reader = ApiSourceReader(
        [connection(base_url="https://energy.example")],
        transport=httpx.MockTransport(
            lambda _: pytest.fail("unresolved target was requested")
        ),
    )
    with pytest.raises(ReportApiReadFailed, match="未能解析"):
        await reader.fetch([source()], "2026-10", "month", "UTC")
