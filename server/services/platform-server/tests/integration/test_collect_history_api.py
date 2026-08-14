"""点位历史读侧的对外契约：游标分页、时刻口径、聚合回显时区。

守的是「时序集合一律游标分页」——页码分页在持续写入的表上会静默重复与漏行。
"""

import uuid
from datetime import UTC, datetime

import httpx
import pytest
from conftest import CollectFakes

from integration.collect_helpers import HISTORIES, envelope, payload
from platform_server.apps.collect.errors import HistoryUnavailable

pytestmark = pytest.mark.requires_postgres

SOURCE_ID = uuid.UUID("0192f0c0-0000-7000-8000-0000000000f1")
NODE_KEY = f"{SOURCE_ID}:outlet_temp"
RANGE_START = "2026-08-01T00:00:00Z"
RANGE_END = "2026-08-02T00:00:00Z"


def archive_row(minute: int, value: float) -> dict[str, object]:
    """一行归档记录。

    Args: minute, value。
    """
    return {
        "source_id": SOURCE_ID,
        "point_code": "outlet_temp",
        "ts": datetime(2026, 8, 1, 0, minute, tzinfo=UTC),
        "value_num": value,
        "value_text": None,
        "quality": "good",
    }


def range_params(**overrides: object) -> dict[str, object]:
    """一次历史查询的 query 参数。

    Args: overrides。
    """
    params: dict[str, object] = {
        "node_keys": [NODE_KEY],
        "range_start": RANGE_START,
        "range_end": RANGE_END,
    }
    params.update(overrides)
    return params


async def test_a_page_carries_items_and_a_cursor(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    collect_fakes.history.rows = [archive_row(i, float(i)) for i in range(5)]
    response = await app_client.get(HISTORIES, params=range_params(limit=2))
    assert response.status_code == 200
    page = payload(response)
    assert len(page["items"]) == 2
    assert page["has_more"] is True
    assert page["next"] is not None
    assert page["items"][0]["node_key"] == NODE_KEY
    assert page["items"][0]["quality"] == "good"


async def test_the_last_page_has_no_cursor(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    collect_fakes.history.rows = [archive_row(0, 1.0)]
    response = await app_client.get(HISTORIES, params=range_params(limit=10))
    page = payload(response)
    assert page["has_more"] is False
    assert page["next"] is None


async def test_a_page_response_has_no_total(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    collect_fakes.history.rows = [archive_row(0, 1.0)]
    response = await app_client.get(HISTORIES, params=range_params())
    assert "total" not in payload(response)


async def test_timestamps_come_back_as_utc_with_a_z(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    collect_fakes.history.rows = [archive_row(30, 21.5)]
    response = await app_client.get(HISTORIES, params=range_params())
    assert payload(response)["items"][0]["ts"] == "2026-08-01T00:30:00.000Z"


async def test_a_naive_moment_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        HISTORIES, params=range_params(range_start="2026-08-01T00:00:00")
    )
    assert response.status_code == 400
    assert envelope(response)["code"] == 41115


async def test_an_inverted_range_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        HISTORIES,
        params=range_params(range_start=RANGE_END, range_end=RANGE_START),
    )
    assert response.status_code == 400
    assert envelope(response)["details"][0]["field"] == "range_end"


async def test_a_malformed_node_key_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        HISTORIES, params=range_params(node_keys=["没有冒号"])
    )
    assert response.status_code == 400
    assert envelope(response)["details"][0]["field"] == "node_keys[0]"


async def test_a_limit_over_the_cap_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(HISTORIES, params=range_params(limit=999))
    assert response.status_code == 400


async def test_an_unparsable_cursor_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        HISTORIES, params=range_params(after="不是游标")
    )
    assert response.status_code == 400


async def test_the_archive_is_read_from_the_collect_schema(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    collect_fakes.history.rows = [archive_row(0, 1.0)]
    await app_client.get(HISTORIES, params=range_params())
    assert "collect.point_history" in collect_fakes.history.last_sql


async def test_an_aggregate_echoes_the_configured_business_timezone(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    collect_fakes.history.rows = []
    response = await app_client.post(
        f"{HISTORIES}:aggregate",
        json={
            "node_keys": [NODE_KEY],
            "range_start": RANGE_START,
            "range_end": RANGE_END,
            "interval": "1d",
        },
    )
    assert response.status_code == 200
    result = payload(response)
    assert result["timezone"] == "Asia/Shanghai"
    assert result["aggregate"] == "avg"
    assert "timezone => :bucket_timezone" in collect_fakes.history.last_sql


async def test_an_aggregate_maps_the_buckets(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    collect_fakes.history.rows = [
        {
            "source_id": SOURCE_ID,
            "point_code": "outlet_temp",
            "bucket_start": datetime(2026, 8, 1, tzinfo=UTC),
            "bucket_value": 21.5,
            "sample_count": 60,
        }
    ]
    response = await app_client.post(
        f"{HISTORIES}:aggregate",
        json={
            "node_keys": [NODE_KEY],
            "range_start": RANGE_START,
            "range_end": RANGE_END,
            "interval": "1h",
            "aggregate": "max",
            "timezone": "UTC",
        },
    )
    bucket = payload(response)["items"][0]
    assert bucket["bucket_start"] == "2026-08-01T00:00:00.000Z"
    assert bucket["value"] == 21.5
    assert bucket["sample_count"] == 60


async def test_an_unknown_aggregate_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        f"{HISTORIES}:aggregate",
        json={
            "node_keys": [NODE_KEY],
            "range_start": RANGE_START,
            "range_end": RANGE_END,
            "interval": "1h",
            "aggregate": "median",
        },
    )
    assert response.status_code == 400
    assert envelope(response)["details"][0]["field"] == "aggregate"


async def test_a_malformed_interval_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        f"{HISTORIES}:aggregate",
        json={
            "node_keys": [NODE_KEY],
            "range_start": RANGE_START,
            "range_end": RANGE_END,
            "interval": "一小时",
        },
    )
    assert response.status_code == 400


async def test_a_zero_width_interval_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 入参正则只管形状，`0s` 过得去；不在这里拦，库里那句
    # 「interval must not be zero」会把一次输入错误报成 503
    response = await app_client.post(
        f"{HISTORIES}:aggregate",
        json={
            "node_keys": [NODE_KEY],
            "range_start": RANGE_START,
            "range_end": RANGE_END,
            "interval": "0s",
        },
    )
    assert response.status_code == 400
    assert envelope(response)["details"][0]["field"] == "interval"


async def test_an_unknown_timezone_is_refused(
    app_client: httpx.AsyncClient,
) -> None:
    # 时区是自由文本，直接进 time_bucket 的话写错一个字母就是 503
    response = await app_client.post(
        f"{HISTORIES}:aggregate",
        json={
            "node_keys": [NODE_KEY],
            "range_start": RANGE_START,
            "range_end": RANGE_END,
            "interval": "1h",
            "timezone": "Asia/Shangahi",
        },
    )
    assert response.status_code == 400
    assert envelope(response)["details"][0]["field"] == "timezone"


async def test_a_bad_aggregate_input_never_reaches_the_archive(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    # 400 的入参不该先打一次库：那既浪费一次扫描，也把错误藏进 503
    await app_client.post(
        f"{HISTORIES}:aggregate",
        json={
            "node_keys": [NODE_KEY],
            "range_start": RANGE_START,
            "range_end": RANGE_END,
            "interval": "0s",
        },
    )
    assert collect_fakes.history.queries == []


async def test_a_broken_archive_answers_503(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    collect_fakes.history.failure = HistoryUnavailable("历史数据暂时读不了")
    response = await app_client.get(HISTORIES, params=range_params())
    assert response.status_code == 503
    assert envelope(response)["code"] == 51103
