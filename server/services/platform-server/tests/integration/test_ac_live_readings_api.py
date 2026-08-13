"""房间当下读数的 HTTP 形状：窗口、时区、运行位与缺测口径。

⚠ 外库是假件（conftest 的 `ac_source`），但 SQL 文本、时区换算与行映射走的都是
真实现——这一层验的是「口径接对了」，不是「驱动能连上」。
"""

import uuid
from collections.abc import Callable
from datetime import datetime
from typing import Any, Protocol

import httpx
import pytest

from lib.errors import DependencyUnavailable

PREFIX = "/api/v1/platform"
DATASET = "raw_minute"
OBJECT = "KTStartData_K01"
SECOND_OBJECT = "KTStartData_K02"
MISSING_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
# 回看窗 15 分钟加上右端多留的 1 分钟
WINDOW_MINUTES = 16

SignHeaders = Callable[..., dict[str, str]]

pytestmark = pytest.mark.requires_postgres


class FakeSource(Protocol):
    """conftest 里那个假外库的形状。

    ⚠ 不从 tests.conftest 导入：`tests` 这个包名在 workspace 里被每个服务各占
    一份，跨服务解析到谁全看 sys.path 顺序。
    """

    samples: list[dict[str, object]]
    queries: list[tuple[str, dict[str, object]]]
    failure: Exception | None


def source_time(text: str) -> datetime:
    """外库那边的 naive 当地时。

    ⚠ 外库的时间列没有时区信息，这正是被测的口径本身，不是漏标。
    Args: text（`YYYY-MM-DDTHH:MM:SS`）。
    """
    return datetime.fromisoformat(text)


def sample_row(**over: Any) -> dict[str, object]:
    """外库回来的一行：naive 当地时 + 五个面板读数 + 风机频率。

    Args: over（覆盖任意一列）。
    """
    row: dict[str, object] = {
        "CT": source_time("2026-08-12T08:05:00"),
        "workshop_temp_avg": 24.5,
        "workshop_humidity_avg": 55.0,
        "fresh_air_temp": 30.0,
        "fresh_air_humidity": 70.0,
        "chilled_water_supply_temp": 7.5,
        "fan_frequency": 42.0,
    }
    row.update(over)
    return row


def zeroed_row(at: str) -> dict[str, object]:
    """采集整行清零的一行：测点全 0，车间温度为 0 就是那个判定位。

    Args: at（外库那边的当地时）。
    """
    row = sample_row(CT=source_time(at))
    return {key: (value if key == "CT" else 0.0) for key, value in row.items()}


async def seed_room(client: httpx.AsyncClient, label: str) -> str:
    """建一个空房间并返回它的 id。

    Args: client, label。
    """
    workshop = await client.post(
        f"{PREFIX}/workshops",
        json={"name": f"{label}车间{uuid.uuid4().hex[:6]}"},
    )
    assert workshop.status_code == 201, workshop.text
    room = await client.post(
        f"{PREFIX}/rooms",
        json={
            "workshop_id": workshop.json()["data"]["id"],
            "name": f"{label}房",
        },
    )
    assert room.status_code == 201, room.text
    return str(room.json()["data"]["id"])


async def add_unit(
    client: httpx.AsyncClient,
    room_id: str,
    *,
    serial: str,
    source_object: str | None = OBJECT,
) -> str:
    """往房间里加一台空调；给了对象名就顺手绑上原始数据。

    Args: client, room_id, serial, source_object（None 即不绑）。
    """
    unit = await client.post(
        f"{PREFIX}/ac-units",
        json={"serial": serial, "name": serial, "room_id": room_id},
    )
    assert unit.status_code == 201, unit.text
    ac_unit_id = str(unit.json()["data"]["id"])
    if source_object is not None:
        bound = await client.put(
            f"{PREFIX}/ac-units/{ac_unit_id}/data-bindings/{DATASET}",
            json={"source_object": source_object},
        )
        assert bound.status_code == 200, bound.text
    return ac_unit_id


async def one_unit_room(
    client: httpx.AsyncClient, label: str
) -> tuple[str, str]:
    """一个房间加一台绑好的空调，返回 (房间 id, serial)。

    Args: client, label。
    """
    room = await seed_room(client, label)
    serial = f"AC-{uuid.uuid4().hex[:8]}"
    await add_unit(client, room, serial=serial)
    return room, serial


async def read_units(
    client: httpx.AsyncClient, room_id: str
) -> list[dict[str, Any]]:
    """取一个房间的当下读数并返回机组数组。

    Args: client, room_id。
    """
    response = await client.get(f"{PREFIX}/rooms/{room_id}/live-readings")
    assert response.status_code == 200, response.text
    units: list[dict[str, Any]] = response.json()["data"]["units"]
    return units


async def test_the_last_row_in_the_window_is_reported_in_utc(
    app_client: httpx.AsyncClient, ac_source: FakeSource
) -> None:
    """报的是窗内最后一行，时刻换算成 UTC。"""
    ac_source.samples.extend(
        [
            sample_row(
                CT=source_time("2026-08-12T08:04:00"), workshop_temp_avg=20.0
            ),
            sample_row(CT=source_time("2026-08-12T08:05:00")),
        ]
    )
    room, serial = await one_unit_room(app_client, "读数")
    response = await app_client.get(f"{PREFIX}/rooms/{room}/live-readings")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["lookback_minutes"] == 15
    assert data["as_of"].endswith("Z")
    unit = data["units"][0]
    assert unit["serial"] == serial
    # 上海比 UTC 早 8 小时：库里的 08:05 就是 UTC 的 00:05
    assert unit["sampled_at"] == "2026-08-12T00:05:00.000Z"
    assert unit["readings"] == {
        "workshop_temp_avg": 24.5,
        "workshop_humidity_avg": 55.0,
        "fresh_air_temp": 30.0,
        "fresh_air_humidity": 70.0,
        "chilled_water_supply_temp": 7.5,
    }


async def test_the_window_asked_of_the_source_is_local_and_fifteen_minutes(
    app_client: httpx.AsyncClient, ac_source: FakeSource
) -> None:
    """⚠ 递给外库的两端必须是 naive 当地时，且正好覆盖回看窗。"""
    ac_source.samples.append(sample_row())
    room, _ = await one_unit_room(app_client, "窗口")
    await read_units(app_client, room)
    params = ac_source.queries[-1][1]
    anchor, range_end = params["anchor"], params["range_end"]
    assert isinstance(anchor, datetime)
    assert isinstance(range_end, datetime)
    assert anchor.tzinfo is None
    assert (range_end - anchor).total_seconds() == WINDOW_MINUTES * 60


@pytest.mark.parametrize(
    ("frequency", "expected"),
    [(None, None), (0.0, False), (42.0, True)],
    ids=["null", "stopped", "running"],
)
async def test_a_null_frequency_is_unknown_not_stopped(
    app_client: httpx.AsyncClient,
    ac_source: FakeSource,
    frequency: float | None,
    expected: bool | None,
) -> None:
    """⚠ 频率为 NULL 是「不知道」，判成停机会把断档读成一次真实的停机。"""
    ac_source.samples.append(sample_row(fan_frequency=frequency))
    room, _ = await one_unit_room(app_client, f"频率{frequency}")
    units = await read_units(app_client, room)
    assert units[0]["is_running"] is expected


async def test_a_temperature_spike_is_reported_as_missing(
    app_client: httpx.AsyncClient, ac_source: FakeSource
) -> None:
    """超出可信区间的温度按缺测；同一行里的湿度不受牵连。"""
    ac_source.samples.append(
        sample_row(workshop_temp_avg=273305.0, fresh_air_temp=-99.0)
    )
    room, _ = await one_unit_room(app_client, "尖峰")
    readings = (await read_units(app_client, room))[0]["readings"]
    assert readings["workshop_temp_avg"] is None
    assert readings["fresh_air_temp"] is None
    assert readings["workshop_humidity_avg"] == 55.0


async def test_a_unit_with_no_row_in_the_window_is_all_unknown(
    app_client: httpx.AsyncClient,
) -> None:
    """窗内一行都没有：时刻、运行位与五个读数全是 null，不是 0 也不是停机。"""
    room, serial = await one_unit_room(app_client, "无行")
    units = await read_units(app_client, room)
    assert units == [
        {
            "serial": serial,
            "sampled_at": None,
            "is_running": None,
            "readings": {
                "workshop_temp_avg": None,
                "workshop_humidity_avg": None,
                "fresh_air_temp": None,
                "fresh_air_humidity": None,
                "chilled_water_supply_temp": None,
            },
        }
    ]


async def test_a_zeroed_last_row_falls_back_to_the_previous_usable_one(
    app_client: httpx.AsyncClient, ac_source: FakeSource
) -> None:
    """⚠ 整行清零是采集缺陷：0.0℃ 不许喂进开机决策，退到更早的可用行。"""
    ac_source.samples.extend(
        [
            sample_row(
                CT=source_time("2026-08-12T08:03:00"), workshop_temp_avg=24.5
            ),
            zeroed_row("2026-08-12T08:04:00"),
            zeroed_row("2026-08-12T08:05:00"),
        ]
    )
    room, _ = await one_unit_room(app_client, "清零回退")
    unit = (await read_units(app_client, room))[0]
    # 时刻如实指向真正用了的那一行，不是窗内最后一行
    assert unit["sampled_at"] == "2026-08-12T00:03:00.000Z"
    assert unit["readings"]["workshop_temp_avg"] == 24.5
    assert unit["is_running"] is True


async def test_a_window_of_nothing_but_zeroed_rows_reads_as_no_data(
    app_client: httpx.AsyncClient, ac_source: FakeSource
) -> None:
    """全窗都是清零行：按没有数据处理，不报成 0℃ 也不报成停机。"""
    ac_source.samples.extend(
        [zeroed_row("2026-08-12T08:04:00"), zeroed_row("2026-08-12T08:05:00")]
    )
    room, _ = await one_unit_room(app_client, "全清零")
    unit = (await read_units(app_client, room))[0]
    assert unit["sampled_at"] is None
    assert unit["is_running"] is None
    assert unit["readings"]["workshop_temp_avg"] is None
    assert unit["readings"]["workshop_humidity_avg"] is None


async def test_only_bound_units_show_up_and_they_are_sorted_by_serial(
    app_client: httpx.AsyncClient, ac_source: FakeSource
) -> None:
    """没绑数据源的机组不出现；出现的按 serial 升序，不按录入顺序。"""
    ac_source.samples.append(sample_row())
    room = await seed_room(app_client, "排序")
    suffix = uuid.uuid4().hex[:8]
    await add_unit(
        app_client, room, serial=f"B2-{suffix}", source_object=SECOND_OBJECT
    )
    await add_unit(app_client, room, serial=f"A1-{suffix}")
    await add_unit(app_client, room, serial=f"C3-{suffix}", source_object=None)
    units = await read_units(app_client, room)
    assert [item["serial"] for item in units] == [
        f"A1-{suffix}",
        f"B2-{suffix}",
    ]


async def test_a_room_without_any_bound_unit_reports_an_empty_list(
    app_client: httpx.AsyncClient,
) -> None:
    """一台都没绑：200 加空数组，不是 404 也不是错。"""
    room = await seed_room(app_client, "未绑")
    await add_unit(
        app_client,
        room,
        serial=f"AC-{uuid.uuid4().hex[:8]}",
        source_object=None,
    )
    assert await read_units(app_client, room) == []


async def test_an_unreachable_source_is_a_retryable_503(
    app_client: httpx.AsyncClient, ac_source: FakeSource
) -> None:
    """⚠ 外库不可达就明确说不可用，不拿上一次的读数冒充当下（ADR-0009）。"""
    room, _ = await one_unit_room(app_client, "不可用")
    ac_source.failure = DependencyUnavailable("外库挂了")
    response = await app_client.get(f"{PREFIX}/rooms/{room}/live-readings")
    assert response.status_code == 503
    assert response.json()["code"] == 51601


async def test_an_unknown_room_is_reported_as_such(
    app_client: httpx.AsyncClient,
) -> None:
    """房间不存在：404，沿用房间面的码。"""
    response = await app_client.get(
        f"{PREFIX}/rooms/{MISSING_ID}/live-readings"
    )
    assert response.status_code == 404
    assert response.json()["code"] == 41602
