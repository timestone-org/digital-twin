"""取数面的 HTTP 形状：发现、表格翻页、聚合序列与它们的错误码。

⚠ 外库一律是假件（conftest 的 `ac_source`），但 SQL 文本、时区换算与行映射走
的都是真实现——这一层验的是「口径接对了」，不是「驱动能连上」。
"""

from collections.abc import Callable
from datetime import datetime
from typing import Protocol

import httpx
import pytest

from lib.errors import DependencyUnavailable
from platform_server.apps.hvac.catalog import AC_VIEW

PREFIX = "/api/v1/platform"
DATASET = "raw_minute"
OBJECT = "KTStartData_K01"
MISSING_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
# 上海比 UTC 早 8 小时：库里的 08:00 就是 UTC 的 00:00
WINDOW = "from=2026-08-12T00:00:00Z&to=2026-08-12T06:00:00Z"

SignHeaders = Callable[..., dict[str, str]]


def source_time(text: str) -> datetime:
    """外库那边的 naive 当地时。

    ⚠ 外库的时间列没有时区信息，这正是被测的口径本身，不是漏标。
    Args: text（`YYYY-MM-DDTHH:MM:SS`）。
    """
    return datetime.fromisoformat(text)


class FakeSource(Protocol):
    """conftest 里那个假外库的形状。

    ⚠ 不从 tests.conftest 导入：`tests` 这个包名在 workspace 里被每个服务各占
    一份，跨服务解析到谁全看 sys.path 顺序。
    """

    columns: dict[str, dict[str, str]]
    captions: list[dict[str, object]]
    samples: list[dict[str, object]]
    buckets: list[dict[str, object]]
    queries: list[tuple[str, dict[str, object]]]
    failure: Exception | None


async def bound_unit(client: httpx.AsyncClient, label: str) -> str:
    """建一台空调并把它绑到默认的数据源对象上。

    Args: client, label。
    """
    workshop = await client.post(
        f"{PREFIX}/workshops", json={"name": f"{label}车间"}
    )
    room = await client.post(
        f"{PREFIX}/rooms",
        json={
            "workshop_id": workshop.json()["data"]["id"],
            "name": f"{label}房",
        },
    )
    unit = await client.post(
        f"{PREFIX}/ac-units",
        json={
            "serial": f"AC-{label}",
            "name": f"{label}机",
            "room_id": room.json()["data"]["id"],
        },
    )
    assert unit.status_code == 201, unit.text
    ac_unit_id = str(unit.json()["data"]["id"])
    bound = await client.put(
        f"{PREFIX}/ac-units/{ac_unit_id}/data-bindings/{DATASET}",
        json={"source_object": OBJECT},
    )
    assert bound.status_code == 200, bound.text
    return ac_unit_id


def sample_row(minute: int, temperature: float | None) -> dict[str, object]:
    """外库回来的一行的形状：naive 当地时 + 测点值。

    Args: minute, temperature。
    """
    return {
        "CT": source_time(f"2026-08-12T08:{minute:02d}:00"),
        "workshop_temp_avg": temperature,
        "fan_frequency": None,
    }


async def test_discovery_filters_by_column_shape_not_by_name(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 同前缀下混着几个只有 4 列、连时间列都没有的非时序视图
    response = await app_client.get(
        f"{PREFIX}/ac-datasets/{DATASET}/source-objects"
    )
    assert response.status_code == 200, response.text
    names = [item["name"] for item in response.json()["data"]["items"]]
    assert names == ["KTStartData_K01", "KTStartData_K02", "KTStartData_K03"]


async def test_discovery_strips_the_trailing_carriage_return_from_captions(
    app_client: httpx.AsyncClient, ac_source: FakeSource
) -> None:
    # ⚠ 厂商的文本字段带尾随回车符，不去掉就永远对不上设备号
    ac_source.captions.append({"device_id": "K01\r", "Caption": "一车间东\r"})
    response = await app_client.get(
        f"{PREFIX}/ac-datasets/{DATASET}/source-objects"
    )
    items = {
        item["name"]: item["caption"]
        for item in response.json()["data"]["items"]
    }
    assert items["KTStartData_K01"] == "一车间东"
    assert items["KTStartData_K02"] is None


async def test_discovery_needs_the_manage_code_not_just_view(
    app_client: httpx.AsyncClient, sign: SignHeaders
) -> None:
    # 它暴露的是外库的结构，故比同方法的其它读端点更严
    response = await app_client.get(
        f"{PREFIX}/ac-datasets/{DATASET}/source-objects",
        headers=sign([AC_VIEW]),
    )
    assert response.status_code == 403
    assert response.json()["code"] == 40106


async def test_binding_rejects_an_object_absent_from_the_external_source(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await bound_unit(app_client, "缺对象")
    response = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/data-bindings/{DATASET}",
        json={"source_object": "KTStartData_K99"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == 41611


async def test_binding_rejects_an_object_whose_shape_does_not_match(
    app_client: httpx.AsyncClient, ac_source: FakeSource
) -> None:
    ac_source.columns["06A699"] = {"CT": "datetime", "F1": "float"}
    unit = await bound_unit(app_client, "形状不符")
    response = await app_client.put(
        f"{PREFIX}/ac-units/{unit}/data-bindings/{DATASET}",
        json={"source_object": "06A699"},
    )
    assert response.status_code == 422
    assert response.json()["code"] == 41612


async def test_raw_samples_return_utc_timestamps_and_keep_nulls(
    app_client: httpx.AsyncClient, ac_source: FakeSource
) -> None:
    ac_source.samples.extend([sample_row(0, 23.5), sample_row(1, None)])
    unit = await bound_unit(app_client, "取数")
    response = await app_client.get(
        f"{PREFIX}/ac-units/{unit}/raw-samples?{WINDOW}"
    )
    assert response.status_code == 200, response.text
    items = response.json()["data"]["items"]
    assert items[0]["ts"] == "2026-08-12T00:00:00.000Z"
    assert items[0]["workshop_temp_avg"] == 23.5
    assert items[1]["workshop_temp_avg"] is None
    assert items[0]["fan_frequency"] is None


async def test_raw_samples_never_report_a_total(
    app_client: httpx.AsyncClient, ac_source: FakeSource
) -> None:
    # ⚠ 190 万行表上算一次区间计数要 69 ms，而翻一页只要 5 ms
    ac_source.samples.append(sample_row(0, 20.0))
    unit = await bound_unit(app_client, "无总数")
    body = (
        await app_client.get(f"{PREFIX}/ac-units/{unit}/raw-samples?{WINDOW}")
    ).json()
    assert set(body["data"]) == {"items", "next", "has_more"}


async def test_raw_samples_page_forward_without_repeating_a_row(
    app_client: httpx.AsyncClient, ac_source: FakeSource
) -> None:
    ac_source.samples.extend(sample_row(minute, 20.0) for minute in range(3))
    unit = await bound_unit(app_client, "翻页")
    first = await app_client.get(
        f"{PREFIX}/ac-units/{unit}/raw-samples?{WINDOW}&limit=2"
    )
    page = first.json()["data"]
    assert page["has_more"] is True
    assert len(page["items"]) == 2
    second = await app_client.get(
        f"{PREFIX}/ac-units/{unit}/raw-samples?{WINDOW}"
        f"&limit=2&after={page['next']}"
    )
    assert second.status_code == 200, second.text
    anchor = ac_source.queries[-1][1]["anchor"]
    # 锚点必须严格晚于上一页最后一行，否则那一行会被翻两次
    assert anchor == source_time("2026-08-12T08:01:01")


async def test_raw_samples_reject_a_window_longer_than_a_month(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await bound_unit(app_client, "超月")
    response = await app_client.get(
        f"{PREFIX}/ac-units/{unit}/raw-samples"
        "?from=2026-01-01T00:00:00Z&to=2026-03-01T00:00:00Z"
    )
    assert response.status_code == 422
    assert response.json()["code"] == 41613


async def test_raw_samples_reject_an_unparsable_cursor(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await bound_unit(app_client, "坏游标")
    response = await app_client.get(
        f"{PREFIX}/ac-units/{unit}/raw-samples?{WINDOW}&after=!!!"
    )
    assert response.status_code == 422
    assert response.json()["code"] == 41615


async def test_raw_samples_need_a_binding_first(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await bound_unit(app_client, "未绑定")
    await app_client.delete(f"{PREFIX}/ac-units/{unit}/data-bindings/{DATASET}")
    response = await app_client.get(
        f"{PREFIX}/ac-units/{unit}/raw-samples?{WINDOW}"
    )
    assert response.status_code == 404
    assert response.json()["code"] == 41610


async def test_an_unknown_ac_unit_is_reported_as_such(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.get(
        f"{PREFIX}/ac-units/{MISSING_ID}/raw-samples?{WINDOW}"
    )
    assert response.status_code == 404
    assert response.json()["code"] == 41603


async def test_raw_series_echo_the_bucket_width_they_chose(
    app_client: httpx.AsyncClient, ac_source: FakeSource
) -> None:
    ac_source.buckets.append(
        {
            "bucket_ts": source_time("2026-08-12T08:00:00"),
            "workshop_temp_avg": 22.25,
        }
    )
    unit = await bound_unit(app_client, "序列")
    response = await app_client.get(
        f"{PREFIX}/ac-units/{unit}/raw-series?{WINDOW}"
        "&metrics=workshop_temp_avg&max_points=100"
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    # 6 小时 = 360 分钟，360/100 向上取到 5 分钟这一档
    assert data["interval_minutes"] == 5
    assert data["metrics"] == ["workshop_temp_avg"]
    assert data["points"] == [
        {
            "ts": "2026-08-12T00:00:00.000Z",
            "values": {"workshop_temp_avg": 22.25},
        }
    ]


async def test_raw_series_reject_a_metric_outside_the_catalog(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await bound_unit(app_client, "未知指标")
    response = await app_client.get(
        f"{PREFIX}/ac-units/{unit}/raw-series?{WINDOW}&metrics=room_pressure"
    )
    assert response.status_code == 422
    assert response.json()["code"] == 41614


async def test_raw_series_reject_a_point_budget_over_the_cap(
    app_client: httpx.AsyncClient,
) -> None:
    unit = await bound_unit(app_client, "点数超限")
    response = await app_client.get(
        f"{PREFIX}/ac-units/{unit}/raw-series?{WINDOW}"
        "&metrics=workshop_temp_avg&max_points=5000"
    )
    assert response.status_code == 400
    assert response.json()["code"] == 40001


@pytest.mark.parametrize(
    ("label", "query"),
    [
        ("表格", f"raw-samples?{WINDOW}"),
        ("序列", f"raw-series?{WINDOW}&metrics=workshop_temp_avg"),
    ],
    ids=["samples", "series"],
)
async def test_an_unreachable_source_is_a_retryable_503(
    app_client: httpx.AsyncClient,
    ac_source: FakeSource,
    label: str,
    query: str,
) -> None:
    unit = await bound_unit(app_client, f"不可用{label}")
    # ⚠ 不返回陈旧数据兜底：查不到就明确说查不到（ADR-0006）
    ac_source.failure = DependencyUnavailable("外库挂了")
    response = await app_client.get(f"{PREFIX}/ac-units/{unit}/{query}")
    assert response.status_code == 503
    assert response.json()["code"] == 51601
