"""报告 API 的精度、时间、映射体积与请求预算边界。"""

import asyncio
from decimal import Decimal

import httpx
import pytest
from pydantic import ValidationError
from unit.report.api_source_fakes import connection, read, source

from platform_server.apps.report.errors import (
    ReportApiReadFailed,
    ReportInvalid,
)
from platform_server.apps.report.services import api_request
from platform_server.apps.report.services.api_source import (
    ApiSourceReader,
)


@pytest.mark.parametrize(
    "value", ["1e999999999", "1e-999999999", "9" * 101, " " * 129]
)
async def test_numeric_range_cannot_exhaust_output_memory(value):
    with pytest.raises(ReportInvalid, match="精度或范围"):
        await read({"data": {"value": value}})


@pytest.mark.parametrize(
    "stamp", ["2026-09-30T15:59:59Z", "2026-10-31T16:00:00Z"]
)
async def test_timestamp_outside_half_open_period_is_explicit_error(stamp):
    with pytest.raises(ReportInvalid, match="超出所选报告期"):
        await read(
            {"data": {"time": stamp, "value": 1}},
            wanted=source(time_pointer="/time"),
        )


async def test_request_budget_cancels_slow_transport_without_retry(monkeypatch):
    calls = 0

    async def handle(_request):
        nonlocal calls
        calls += 1
        await asyncio.Event().wait()
        return httpx.Response(200)

    monkeypatch.setattr(api_request, "REQUEST_TIMEOUT_S", 0.01)
    reader = ApiSourceReader(
        [connection()], transport=httpx.MockTransport(handle)
    )
    with pytest.raises(ReportApiReadFailed, match="超时"):
        await reader.fetch([source()], "2026-10", "month", "UTC")
    assert calls == 1


async def test_compressed_response_rejected_before_unbounded_decoding():
    response = httpx.Response(
        200,
        headers={"Content-Encoding": "br"},
        content=b"unsupported compression",
    )
    reader = ApiSourceReader(
        [connection()], transport=httpx.MockTransport(lambda _: response)
    )
    with pytest.raises(ReportInvalid, match="未压缩"):
        await reader.fetch([source()], "2026-10", "month", "UTC")


async def test_json_depth_limit_prevents_unbounded_response_traversal():
    content = b'{"deep":' * 66 + b"1" + b"}" * 66
    reader = ApiSourceReader(
        [connection()],
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, content=content)
        ),
    )
    with pytest.raises(ReportInvalid, match="深度上限"):
        await reader.fetch([source()], "2026-10", "month", "UTC")


async def test_total_source_limit_is_rejected_before_any_request():
    reader = ApiSourceReader(
        [connection()],
        transport=httpx.MockTransport(
            lambda _: pytest.fail("over-budget source request")
        ),
    )
    with pytest.raises(ReportInvalid, match="10 个"):
        await reader.fetch(
            [source(code=f"s{index}") for index in range(11)],
            "2026-10",
            "month",
            "UTC",
        )


@pytest.mark.parametrize("length", [61, 64])
def test_source_code_leaves_room_for_virtual_table_prefix(length):
    with pytest.raises(ValidationError, match="60"):
        source(code="a" * length)
    assert source(code="a" * 60).code == "a" * 60


async def test_mapped_text_cell_is_bounded_before_preview_or_snapshot():
    wanted = source(
        columns=[
            {
                "key": "text",
                "name": "文本",
                "pointer": "/text",
                "data_type": "text",
            }
        ]
    )
    with pytest.raises(ReportInvalid, match=r"文本.*10000"):
        await read({"data": {"text": "长" * 10_001}}, wanted=wanted)


async def test_repeated_mapping_cannot_amplify_response_beyond_two_mb():
    wanted = source(
        columns=[
            {
                "key": f"c{index}",
                "name": f"字段{index}",
                "pointer": "/text",
                "data_type": "text",
            }
            for index in range(50)
        ]
    )
    with pytest.raises(ReportInvalid, match=r"映射.*2 MB"):
        await read({"data": [{"text": "长" * 10_000}] * 2}, wanted=wanted)


async def test_small_text_bool_and_decimal_mapping_remain_valid():
    wanted = source(
        columns=[
            {
                "key": "text",
                "name": "文本",
                "pointer": "/text",
                "data_type": "text",
            },
            {
                "key": "ok",
                "name": "正常",
                "pointer": "/ok",
                "data_type": "boolean",
            },
            {
                "key": "value",
                "name": "读数",
                "pointer": "/value",
                "data_type": "number",
            },
        ]
    )
    result = await read(
        {"data": {"text": "长" * 10_000, "ok": False, "value": "1.25"}},
        wanted=wanted,
    )
    assert result["api:usage"].rows[0].values == {
        "text": "长" * 10_000,
        "ok": False,
        "value": Decimal("1.25"),
    }


async def test_invalid_unicode_text_has_safe_mapping_error():
    wanted = source(
        columns=[
            {
                "key": "text",
                "name": "文本",
                "pointer": "/text",
                "data_type": "text",
            }
        ]
    )
    reader = ApiSourceReader(
        [connection()],
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200, content=b'{"data":{"text":"\\ud800"}}'
            ),
        ),
    )
    with pytest.raises(ReportInvalid, match="Unicode"):
        await reader.fetch([wanted], "2026-10", "month", "UTC")


async def test_invalid_user_period_is_validation_failure_before_http():
    reader = ApiSourceReader(
        [connection()],
        transport=httpx.MockTransport(
            lambda _: pytest.fail("invalid period should not make request"),
        ),
    )
    with pytest.raises(ReportInvalid, match="报告期"):
        await reader.fetch([source()], "2026/10", "month", "UTC")
