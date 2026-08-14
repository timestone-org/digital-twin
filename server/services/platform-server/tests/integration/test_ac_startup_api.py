"""开机事件面的读写口径，打真实 Postgres。

⚠ 两条最容易写错：没算过的房间是**合法的空状态**而不是 404；`:rebuild` 只入队，
请求路径里一条事件都不许产生。
"""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.hvac.models import (
    AcStartupBatch,
    AcStartupEpisode,
    Room,
    Workshop,
)
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.startups import (
    BATCH_STATUS_READY,
    OUTCOME_SET_CHANGED,
    OUTCOME_USABLE,
)

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


async def test_a_room_that_was_never_extracted_returns_an_empty_page(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """⚠ 还没算过是合法的空状态，不是 404——页面该说「还没算过」。"""
    room_id = await make_room(db_session, "空房")
    response = await app_client.get(
        f"{PREFIX}/rooms/{room_id}/startup-episodes"
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["items"] == []
    assert data["has_more"] is False
    assert data["next"] is None


async def test_a_missing_room_is_a_not_found(
    app_client: httpx.AsyncClient,
) -> None:
    """房间不存在才是 404。"""
    response = await app_client.get(
        f"{PREFIX}/rooms/{MISSING_ID}/startup-episodes"
    )
    assert response.status_code == 404
    assert response.json()["code"] == 41602


async def test_episodes_come_back_newest_first(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """事件列表最新的在前，人最先要看的是刚发生的那次。"""
    room_id = await seeded_room(db_session, "列表")
    response = await app_client.get(
        f"{PREFIX}/rooms/{room_id}/startup-episodes"
    )
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert [item["duration_minutes"] for item in items] == [None, 20, 20]
    assert items[0]["outcome"] == OUTCOME_SET_CHANGED
    assert items[-1]["running_set"] == ["K11"]
    assert items[-1]["readings"] == READINGS
    assert items[-1]["is_excluded"] is False
    assert items[-1]["exclusion_reason"] is None


async def test_episodes_page_through_a_cursor(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """时序集合只许游标翻页，游标从上一页响应里原样带回。"""
    room_id = await seeded_room(db_session, "翻页")
    first = await app_client.get(
        f"{PREFIX}/rooms/{room_id}/startup-episodes", params={"limit": 2}
    )
    assert first.status_code == 200
    page = first.json()["data"]
    assert len(page["items"]) == 2
    assert page["has_more"] is True
    second = await app_client.get(
        f"{PREFIX}/rooms/{room_id}/startup-episodes",
        params={"limit": 2, "after": page["next"]},
    )
    assert second.status_code == 200
    rest = second.json()["data"]
    assert len(rest["items"]) == 1
    assert rest["has_more"] is False
    assert rest["items"][0]["started_at"] < page["items"][-1]["started_at"]


async def test_a_broken_cursor_is_rejected_not_a_crash(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """⚠ 游标是客户端能随手改的入参，解析失败必须是 400 而不是 500。"""
    room_id = await seeded_room(db_session, "坏游标")
    response = await app_client.get(
        f"{PREFIX}/rooms/{room_id}/startup-episodes",
        params={"after": "not-a-cursor"},
    )
    assert response.status_code == 400


async def test_episodes_filter_by_outcome(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """按结果过滤，页面据此只看可用样本。"""
    room_id = await seeded_room(db_session, "结果过滤")
    response = await app_client.get(
        f"{PREFIX}/rooms/{room_id}/startup-episodes",
        params={"outcome": OUTCOME_USABLE},
    )
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert {item["outcome"] for item in items} == {OUTCOME_USABLE}
    assert len(items) == 2


async def test_episodes_filter_by_running_set_ignoring_order(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """⚠ 组合按 serial 升序归一：写成「K12,K11」也要能对上库里那份排好序的。"""
    room_id = await seeded_room(db_session, "组合过滤")
    response = await app_client.get(
        f"{PREFIX}/rooms/{room_id}/startup-episodes",
        params={"running_set": "K12,K11"},
    )
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert [item["running_set"] for item in items] == [["K11", "K12"]]


@pytest.mark.parametrize(
    ("params", "reason"),
    [
        ({"outcome": "maybe"}, "结果不在目录内"),
        ({"running_set": " , "}, "组合为空"),
    ],
    ids=["unknown-outcome", "empty-running-set"],
)
async def test_a_bad_filter_is_rejected(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    params: dict[str, str],
    reason: str,
) -> None:
    """过滤取值不合法直接拒绝，不静默返回空列表。"""
    room_id = await seeded_room(db_session, f"坏过滤{reason}")
    response = await app_client.get(
        f"{PREFIX}/rooms/{room_id}/startup-episodes", params=params
    )
    assert response.status_code == 400
