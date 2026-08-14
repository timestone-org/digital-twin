"""重算区间的解析口径，打真实 Postgres。

⚠ 起点不写死：今天的数据从 2023 年开始只是当下的事实，现场会继续产出、也可能
补录更早的。区间的两端都由数据源当下的实际范围说了算。
"""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Protocol

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import DependencyUnavailable
from platform_server.apps.hvac.models import (
    AcDataBinding,
    AcStartupBatch,
    AcStartupEpisode,
    AcUnit,
    Room,
    Workshop,
)
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.startups import (
    BATCH_STATUS_READY,
    OUTCOME_SET_CHANGED,
    OUTCOME_USABLE,
)


# conftest 的 `ac_source` fixture 形状。⚠ 不从 tests.conftest 导入：`tests`
# 这个包名在 workspace 里被每个服务各占一份，解析到谁全看 sys.path 顺序。
class FakeAcSource(Protocol):
    """假外库：failure 一置就抛依赖不可用，extent 一清就是空数据源。"""

    failure: Exception | None
    extent: list[dict[str, object]]


PREFIX = "/api/v1/platform"
BASE = datetime(2026, 3, 1, tzinfo=UTC)
MISSING_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
READINGS = {"K11": {"workshop_temp_avg": 26.5}}

# conftest 的 `sign` fixture 形状。⚠ 不从 tests.conftest 导入：`tests` 这个包名
# 在 workspace 里被每个服务各占一份，跨服务解析到谁全看 sys.path 顺序。
SignHeaders = Callable[..., dict[str, str]]


def at(minute: int) -> datetime:
    """基准时刻起的第 n 分钟。

    Args: minute。
    """
    return BASE + timedelta(minutes=minute)


async def make_room(session: AsyncSession, label: str) -> uuid.UUID:
    """建一个车间与一个房间，返回房间 id。

    Args: session, label。
    """
    workshop = Workshop(name=f"{label}车间{uuid.uuid4().hex[:8]}")
    session.add(workshop)
    await session.flush()
    room = Room(workshop_id=workshop.id, name=f"{label}房")
    session.add(room)
    await session.flush()
    return room.id


async def make_batch(
    session: AsyncSession,
    room_id: uuid.UUID,
    *,
    is_current: bool = True,
    fingerprint: str | None = None,
) -> AcStartupBatch:
    """落一个已就绪的批次。

    Args: session, room_id, is_current, fingerprint。
    """
    batch = AcStartupBatch(
        room_id=room_id,
        params_fingerprint=fingerprint or ExtractionRules().fingerprint(),
        logic_version=1,
        window_start=at(0),
        window_end=at(1440),
        status=BATCH_STATUS_READY,
        is_current=is_current,
        shard_total=1,
        shard_done=1,
        episode_count=0,
        unmatched_exclusion_count=2,
    )
    session.add(batch)
    await session.flush()
    return batch


async def make_episode(
    session: AsyncSession,
    batch: AcStartupBatch,
    *,
    minute: int,
    running_set: list[str],
    outcome: str = OUTCOME_USABLE,
) -> None:
    """落一条事件。

    Args: session, batch, minute, running_set, outcome。
    """
    complied = at(minute + 20) if outcome == OUTCOME_USABLE else None
    session.add(
        AcStartupEpisode(
            batch_id=batch.id,
            room_id=batch.room_id,
            started_at=at(minute),
            running_set=running_set,
            complied_at=complied,
            duration_minutes=20 if complied else None,
            outcome=outcome,
            readings=READINGS,
        )
    )
    await session.flush()


async def bound_room(session: AsyncSession, label: str) -> uuid.UUID:
    """一个房间，里面有一台绑好了原始数据的空调。

    Args: session, label。
    """
    room_id = await make_room(session, label)
    unit = AcUnit(room_id=room_id, serial=f"K11-{label}", name=f"{label}机")
    session.add(unit)
    await session.flush()
    session.add(
        AcDataBinding(
            ac_unit_id=unit.id,
            dataset="raw_minute",
            source_object="KTStartData_K01",
        )
    )
    await session.flush()
    return room_id


async def seeded_room(session: AsyncSession, label: str) -> uuid.UUID:
    """一个房间加一个当前批次与三条事件。

    Args: session, label。
    """
    room_id = await make_room(session, label)
    batch = await make_batch(session, room_id)
    await make_episode(session, batch, minute=10, running_set=["K11"])
    await make_episode(session, batch, minute=200, running_set=["K11", "K12"])
    await make_episode(
        session,
        batch,
        minute=400,
        running_set=["K11"],
        outcome=OUTCOME_SET_CHANGED,
    )
    return room_id


# 假外库里那段数据跨度换算成 UTC 之后的两端（源时区 Asia/Shanghai）
SOURCE_START = "2023-01-01T00:00:00.000Z"
SOURCE_END = "2026-08-12T00:00:00.000Z"


async def test_an_empty_body_rebuilds_the_whole_available_history(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """⚠ 空请求体就是「全部历史」：起点不写死，由数据源当下的范围说了算。"""
    room_id = await bound_room(db_session, "全史")
    response = await app_client.post(
        f"{PREFIX}/rooms/{room_id}/startup-batches:rebuild", json={}
    )
    assert response.status_code == 202
    data = response.json()["data"]
    assert data["window_start"] == SOURCE_START
    assert data["window_end"] == SOURCE_END
    assert data["is_clamped"] is False
    # 2023-01 到 2026-08 共 44 个月
    assert data["shard_total"] == 44


async def test_omitting_one_bound_fills_it_from_the_source(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """只给一端时另一端按数据源范围补齐。"""
    room_id = await bound_room(db_session, "补一端")
    response = await app_client.post(
        f"{PREFIX}/rooms/{room_id}/startup-batches:rebuild",
        json={"window_start": "2026-06-01T00:00:00Z"},
    )
    assert response.status_code == 202
    data = response.json()["data"]
    assert data["window_start"] == "2026-06-01T00:00:00.000Z"
    assert data["window_end"] == SOURCE_END
    assert data["is_clamped"] is False


async def test_a_window_wider_than_the_source_is_clamped(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """⚠ 要得比数据还宽时裁到数据范围，不然会排出一串永远抽不到东西的空分片。"""
    room_id = await bound_room(db_session, "裁剪")
    response = await app_client.post(
        f"{PREFIX}/rooms/{room_id}/startup-batches:rebuild",
        json={
            "window_start": "2015-01-01T00:00:00Z",
            "window_end": "2030-01-01T00:00:00Z",
        },
    )
    assert response.status_code == 202
    data = response.json()["data"]
    assert data["window_start"] == SOURCE_START
    assert data["window_end"] == SOURCE_END
    assert data["is_clamped"] is True


async def test_a_window_with_no_overlap_is_rejected(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """整段落在数据范围之外时说清楚，而不是悄悄改成全史重算一遍。"""
    room_id = await bound_room(db_session, "无交集")
    response = await app_client.post(
        f"{PREFIX}/rooms/{room_id}/startup-batches:rebuild",
        json={
            "window_start": "2015-01-01T00:00:00Z",
            "window_end": "2016-01-01T00:00:00Z",
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == 41613
    assert "2023-01-01" in response.json()["message"]


async def test_an_unbound_room_cannot_resolve_a_window(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """⚠ 一台都没绑时区间无从算起：说清楚要先去绑定，不是 500 也不是空批次。"""
    room_id = await make_room(db_session, "没绑定")
    response = await app_client.post(
        f"{PREFIX}/rooms/{room_id}/startup-batches:rebuild", json={}
    )
    assert response.status_code == 409
    assert response.json()["code"] == 41617


async def test_the_batches_summary_exposes_the_source_range(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """页面用它预设区间并给日期选择器定上下界。"""
    room_id = await bound_room(db_session, "数据范围")
    response = await app_client.get(f"{PREFIX}/rooms/{room_id}/startup-batches")
    assert response.status_code == 200
    assert response.json()["data"]["source_range"] == {
        "start": SOURCE_START,
        "end": SOURCE_END,
    }


async def test_an_unbound_room_reports_no_source_range(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """一台都没绑时没有范围可报。"""
    room_id = await make_room(db_session, "无范围")
    response = await app_client.get(f"{PREFIX}/rooms/{room_id}/startup-batches")
    assert response.status_code == 200
    assert response.json()["data"]["source_range"] is None


async def test_an_unreachable_source_does_not_break_the_batches_page(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    ac_source: FakeAcSource,
) -> None:
    """⚠ 外库抖一下只该让这一个字段变空，不该把整页打成 503。"""
    room_id = await bound_room(db_session, "外库不可用")
    ac_source.failure = DependencyUnavailable("外部数据源暂时不可用")
    response = await app_client.get(f"{PREFIX}/rooms/{room_id}/startup-batches")
    assert response.status_code == 200
    assert response.json()["data"]["source_range"] is None


async def test_an_unreachable_source_fails_a_rebuild(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    ac_source: FakeAcSource,
) -> None:
    """⚠ 写面反过来 fail-closed：算不出区间就不能排一段猜出来的进队列。"""
    room_id = await bound_room(db_session, "写面不可用")
    ac_source.failure = DependencyUnavailable("外部数据源暂时不可用")
    response = await app_client.post(
        f"{PREFIX}/rooms/{room_id}/startup-batches:rebuild", json={}
    )
    assert response.status_code == 503
    assert response.json()["code"] == 51601


async def test_a_bound_room_whose_source_is_empty_has_no_range(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    ac_source: FakeAcSource,
) -> None:
    """⚠ 绑了数据源但一行数据都没有，与没绑一样算不出区间。"""
    room_id = await bound_room(db_session, "空数据源")
    ac_source.extent = []
    listed = await app_client.get(f"{PREFIX}/rooms/{room_id}/startup-batches")
    assert listed.json()["data"]["source_range"] is None
    rebuilt = await app_client.post(
        f"{PREFIX}/rooms/{room_id}/startup-batches:rebuild", json={}
    )
    assert rebuilt.status_code == 409
    assert rebuilt.json()["code"] == 41617
