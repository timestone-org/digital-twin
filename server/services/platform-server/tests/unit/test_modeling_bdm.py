"""BDM 取数的单标识请求、分页、时间对齐及失败闭合。"""

import json
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime

import httpx
import pytest
from pydantic import SecretStr, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.modeling.operators.base import PREFETCHED_KEY
from platform_server.apps.modeling.operators.bdm import (
    BdmSource,
    BdmSourceConfig,
)
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.services import bdm_frame, run_dispatch
from platform_server.apps.modeling.services.bdm_client import (
    BdmClient,
    BdmConnection,
    BdmReadFailed,
)
from platform_server.apps.modeling.services.bdm_frame import load_frame

NOW = datetime(2026, 10, 26, tzinfo=UTC)
SECRET = "test-bdm-credential-" + "x" * 32


def connection() -> BdmConnection:
    return BdmConnection(
        base_url="https://bdm.example.test",
        api_key=SecretStr(SECRET),
        timezone="Asia/Shanghai",
        timeout_s=1,
        load_timeout_s=5,
    )


def config(**overrides: object) -> BdmSourceConfig:
    values: dict[str, object] = {
        "kind": "point",
        "identifiers": ["p1", "p2"],
        "since": "2026-10-24T16:00:00Z",
        "until": "2026-10-25T16:00:00Z",
        "row_limit": 10,
    }
    return BdmSourceConfig.model_validate(values | overrides)


def success(data: object) -> httpx.Response:
    return httpx.Response(
        200, json={"code": 200, "message": "ok", "data": data}
    )


async def test_single_identifiers_are_paged_and_aligned_in_utc() -> None:
    seen: list[tuple[str, int]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        assert request.headers["X-API-Key"] == SECRET
        assert "traceparent" in request.headers
        query = json.loads(request.content)
        assert len(query["pointIds"]) == 1
        identifier = query["pointIds"][0]
        offset = query["offset"]
        seen.append((identifier, offset))
        assert query["startTime"] == "2026-10-25 00:00:00"
        assert query["endTime"] == "2026-10-26 00:00:00"
        samples = {
            ("p1", 0): [{"ct": "2026-10-25 01:00:00", "value": 12}],
            ("p1", 1): [{"ct": "2026-10-25 00:00:00", "value": None}],
            ("p2", 0): [{"ct": "2026-10-25 00:00:00", "value": "3.5"}],
        }[(identifier, offset)]
        series: dict[str, object] = {
            "pointId": identifier,
            "code": identifier,
            "name": identifier,
            "tableType": "Tech",
            "samples": samples,
        }
        if identifier == "p1" and offset == 0:
            series["nextOffset"] = 1
        return success({"kind": "point", "series": [series]})

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        frame = await load_frame(client, config(), now=NOW)
    assert seen == [("p1", 0), ("p1", 1), ("p2", 0)]
    assert frame.keys == ("p1", "p2")
    assert frame.rows == ((None, 3.5), (12.0, None))
    assert frame.index == (1792857600000, 1792861200000)
    assert not frame.provenance.is_truncated
    operator = BdmSource(config())
    assert operator.run({PREFETCHED_KEY: frame})["frame"] is frame
    assert operator.report()


async def test_redirects_are_rejected_without_forwarding_credentials() -> None:
    seen: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(302, headers={"Location": "https://other.test/"})

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(BdmReadFailed) as caught:
            await load_frame(client, config(identifiers=["p1"]), now=NOW)
    assert len(seen) == 1
    assert SECRET not in str(caught.value)


@pytest.mark.parametrize("identifiers", [[], [""], ["p1", "p1"], ["x"] * 11])
def test_invalid_identifiers_are_rejected(identifiers: list[str]) -> None:
    with pytest.raises(ValidationError):
        config(identifiers=identifiers)


def series_response(
    samples: list[dict[str, object]], **extra: object
) -> httpx.Response:
    return success(
        {
            "kind": "point",
            "series": [
                {
                    "pointId": "p1",
                    "code": "P1",
                    "name": "温度",
                    "samples": samples,
                    **extra,
                }
            ],
        }
    )


async def test_latest_rows_are_retained_and_truncation_is_visible() -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["limit"] == 2
        return series_response(
            [
                {"ct": "2026-10-25 01:00:00", "value": "12"},
                {"ct": "2026-10-25 00:00:00", "value": "11"},
            ]
        )

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        frame = await load_frame(
            client, config(identifiers=["p1"], row_limit=1), now=NOW
        )
    assert frame.rows == ((12.0,),)
    assert frame.provenance.is_truncated


async def test_invalid_numbers_become_missing_and_are_counted() -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return series_response(
            [
                {"ct": "2026-10-25 03:00:00", "value": "bad"},
                {"ct": "2026-10-25 02:00:00", "value": "NaN"},
                {"ct": "2026-10-25 01:00:00", "value": None},
                {"ct": "2026-10-25 00:00:00", "value": 0},
            ]
        )

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        frame = await load_frame(client, config(identifiers=["p1"]), now=NOW)
    assert frame.rows == ((0.0,), (None,), (None,), (None,))
    assert frame.columns[0].coerce_failed == 2


async def test_identical_duplicates_are_deduplicated() -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return series_response(
            [
                {"ct": "2026-10-25 00:00:00", "value": 1},
                {"ct": "2026-10-25 00:00:00", "value": 1},
            ]
        )

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        frame = await load_frame(client, config(identifiers=["p1"]), now=NOW)
    assert frame.rows == ((1.0,),)


async def test_conflicting_duplicate_timestamps_fail_closed() -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return series_response(
            [
                {"ct": "2026-10-25 00:00:00", "value": 1},
                {"ct": "2026-10-25 00:00:00", "value": 2},
            ]
        )

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(BdmReadFailed, match="冲突值"):
            await load_frame(client, config(identifiers=["p1"]), now=NOW)


@pytest.mark.parametrize("offset", [0, 100_001])
async def test_invalid_pagination_is_rejected(offset: int) -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return series_response(
            [{"ct": "2026-10-25 00:00:00", "value": 1}], nextOffset=offset
        )

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(BdmReadFailed, match="分页"):
            await load_frame(client, config(identifiers=["p1"]), now=NOW)


@pytest.mark.parametrize("status", [400, 401, 403, 404, 500, 503])
async def test_upstream_errors_do_not_expose_body_or_credential(
    status: int,
) -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json={"code": status, "message": SECRET})

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(BdmReadFailed) as caught:
            await load_frame(client, config(identifiers=["p1"]), now=NOW)
    assert SECRET not in str(caught.value)


@pytest.mark.parametrize(
    "payload",
    [
        {"code": 500, "data": {}},
        {"code": 200, "data": {}},
        {"code": 200, "data": {"kind": "point", "series": []}},
    ],
)
async def test_http_200_is_not_enough(payload: dict[str, object]) -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(BdmReadFailed):
            await load_frame(client, config(identifiers=["p1"]), now=NOW)


async def test_text_values_and_empty_series_are_preserved() -> None:
    def respond(request: httpx.Request) -> httpx.Response:
        identifier = json.loads(request.content)["propertyIds"][0]
        return success(
            {
                "kind": "raw",
                "series": [
                    {
                        "propertyId": identifier,
                        "nodeName": "空压机",
                        "propertyName": "状态",
                        "samples": (
                            [{"ct": "2026-10-25 00:00:00", "value": "运行"}]
                            if identifier == "p1"
                            else []
                        ),
                    }
                ],
            }
        )

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        frame = await load_frame(
            client, config(kind="raw", value_type="string"), now=NOW
        )
    assert frame.rows == (("运行", None),)
    assert frame.columns[0].name == "空压机 · 状态"
    assert frame.columns[0].dtype == "string"


@pytest.mark.parametrize(
    ("granularity", "ct"), [("day", "2026-10-25"), ("month", "2026-10")]
)
async def test_formula_series_are_requested_singly(
    granularity: str, ct: str
) -> None:
    identifiers: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        assert len(payload["codes"]) == 1
        assert "offset" not in payload
        identifier = payload["codes"][0]
        identifiers.append(identifier)
        return success(
            {
                "kind": "formula",
                "series": [
                    {
                        "code": identifier,
                        "name": identifier,
                        "samples": [
                            {"ct": ct, "value": 4 if identifier == "p1" else 8}
                        ],
                    }
                ],
            }
        )

    options = config(
        kind="formula", granularity=granularity, since="2026-09-30T16:00:00Z"
    )
    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        frame = await load_frame(client, options, now=NOW)
    assert identifiers == ["p1", "p2"]
    assert frame.rows == ((4.0, 8.0),)


async def test_history_windows_are_split_into_seven_day_segments() -> None:
    windows: list[tuple[str, str]] = []

    def respond(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        windows.append((payload["startTime"], payload["endTime"]))
        return series_response([])

    options = config(identifiers=["p1"], since="2026-10-17T16:00:00Z")
    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        frame = await load_frame(client, options, now=NOW)
    assert windows == [
        ("2026-10-19 00:00:00", "2026-10-26 00:00:00"),
        ("2026-10-18 00:00:00", "2026-10-19 00:00:00"),
    ]
    assert frame.rows == ()


async def test_oversized_response_is_rejected() -> None:
    def respond(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b" " * 2_000_001,
            headers={"content-type": "application/json"},
        )

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(BdmReadFailed, match="大小上限"):
            await load_frame(client, config(identifiers=["p1"]), now=NOW)


async def test_transport_timeout_is_explicit_and_is_not_retried() -> None:
    requests: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request.method)
        raise httpx.ReadTimeout(SECRET)

    async with BdmClient(
        connection(), transport=httpx.MockTransport(respond)
    ) as client:
        with pytest.raises(BdmReadFailed, match="超时") as caught:
            await load_frame(client, config(identifiers=["p1"]), now=NOW)
    assert SECRET not in str(caught.value)
    assert requests == ["POST"]


class TrackedSessions:
    def __init__(self) -> None:
        self.is_active = False

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        self.is_active = True
        try:
            async with AsyncSession() as session:
                yield session
        finally:
            self.is_active = False


async def test_external_requests_happen_after_the_database_session_closes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sessions = TrackedSessions()

    def respond(_request: httpx.Request) -> httpx.Response:
        assert not sessions.is_active
        return series_response([])

    def client(options: BdmConnection) -> BdmClient:
        return BdmClient(options, transport=httpx.MockTransport(respond))

    monkeypatch.setattr(bdm_frame, "BdmClient", client)
    graph = PipelineGraph.model_validate(
        {
            "format_version": "1.0",
            "edges": [],
            "nodes": [
                {
                    "id": "source",
                    "operator": "bdm_source",
                    "config": config(identifiers=["p1"]).model_dump(),
                    "position": {"left": 0, "top": 0},
                }
            ],
        }
    )
    claimed = run_dispatch._Claimed(
        graph=graph,
        is_redelivery=False,
        pipeline_id=uuid.UUID(int=1),
        is_keeping_frames=False,
    )
    sources = await run_dispatch._load_sources(sessions, claimed, connection())
    assert sources.frames["source"].rows == ()
    assert sources.failures == {}
