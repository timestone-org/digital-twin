"""批次面与人工排除的读写口径，打真实 Postgres。

⚠ `:rebuild` 只入队，请求路径里一条事件都不许产生；指纹对不上要报「该重算」，
而「还没算过」不是「该重算」——两者要人做的事不一样。
"""

import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import encode_cursor
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.models import (
    AcStartupBatch,
    AcStartupEpisode,
    Room,
    Workshop,
)
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules
from platform_server.apps.hvac.services.ac_startup_service import (
    fail_batch,
    request_rebuild,
)
from platform_server.apps.hvac.startups import (
    BATCH_STATUS_FAILED,
    BATCH_STATUS_READY,
    BATCH_STATUS_RUNNING,
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


async def test_the_batches_summary_carries_progress_and_coverage(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """批次页要的全部东西一次取回：当前批次、进度、覆盖度、未匹配排除数。"""
    room_id = await seeded_room(db_session, "摘要")
    response = await app_client.get(f"{PREFIX}/rooms/{room_id}/startup-batches")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["current"] is not None
    assert data["current"]["is_current"] is True
    assert data["current"]["shard_total"] == 1
    assert data["current"]["unmatched_exclusion_count"] == 2
    assert data["coverage"] == [
        {"running_set": ["K11"], "usable_count": 1},
        {"running_set": ["K11", "K12"], "usable_count": 1},
    ]
    assert data["is_stale"] is False
    assert data["expected_fingerprint"] == ExtractionRules().fingerprint()


async def test_a_fingerprint_from_another_ruleset_is_reported_stale(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """⚠ 指纹对不上就该提醒重算：库里那批事件已经不是当前规则的产物了。"""
    room_id = await make_room(db_session, "过期")
    await make_batch(db_session, room_id, fingerprint="b" * 64)
    response = await app_client.get(f"{PREFIX}/rooms/{room_id}/startup-batches")
    assert response.status_code == 200
    assert response.json()["data"]["is_stale"] is True


async def test_a_room_without_a_current_batch_is_not_stale(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """⚠ 「还没算过」不是「该重算」：两者要人做的事不一样。"""
    room_id = await make_room(db_session, "没算过")
    response = await app_client.get(f"{PREFIX}/rooms/{room_id}/startup-batches")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["current"] is None
    assert data["is_stale"] is False
    assert data["coverage"] == []


async def test_rebuilding_only_enqueues(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """⚠ API 角色永不跑重任务：请求路径里一条事件都不许产生。"""
    room_id = await make_room(db_session, "入队")
    response = await app_client.post(
        f"{PREFIX}/rooms/{room_id}/startup-batches:rebuild",
        json={
            "window_start": "2026-01-01T00:00:00Z",
            "window_end": "2026-03-01T00:00:00Z",
        },
    )
    assert response.status_code == 202
    data = response.json()["data"]
    assert data["status"] == BATCH_STATUS_RUNNING
    assert data["shard_total"] == 2
    episodes = await app_client.get(
        f"{PREFIX}/rooms/{room_id}/startup-episodes"
    )
    assert episodes.json()["data"]["items"] == []


async def test_a_second_rebuild_while_one_runs_is_rejected(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """⚠ 连点几次按钮就是几份分片同时读同一段外库数据，其余全是白算。"""
    room_id = await make_room(db_session, "重复入队")
    body = {
        "window_start": "2026-01-01T00:00:00Z",
        "window_end": "2026-02-01T00:00:00Z",
    }
    first = await app_client.post(
        f"{PREFIX}/rooms/{room_id}/startup-batches:rebuild", json=body
    )
    assert first.status_code == 202
    second = await app_client.post(
        f"{PREFIX}/rooms/{room_id}/startup-batches:rebuild", json=body
    )
    assert second.status_code == 409
    assert second.json()["code"] == 41616


async def test_an_inverted_rebuild_window_is_rejected(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """倒置的区间切不出分片，在建批次之前就拒掉。"""
    room_id = await make_room(db_session, "倒置区间")
    response = await app_client.post(
        f"{PREFIX}/rooms/{room_id}/startup-batches:rebuild",
        json={
            "window_start": "2026-03-01T00:00:00Z",
            "window_end": "2026-01-01T00:00:00Z",
        },
    )
    assert response.status_code == 422
    assert response.json()["code"] == 41613


async def test_an_exclusion_is_idempotent_and_shows_on_the_episode(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """人工排除按自然键覆盖，且被排除的事件置灰保留而不是消失。"""
    room_id = await seeded_room(db_session, "排除")
    moment = "2026-03-01T00:10:00Z"
    path = f"{PREFIX}/rooms/{room_id}/startup-exclusions/{moment}"
    first = await app_client.put(path, json={"reason": "现场在调试"})
    assert first.status_code == 200
    assert first.json()["data"]["excluded_by"] == "测试员"
    second = await app_client.put(path, json={"reason": "门开着"})
    assert second.status_code == 200
    assert second.json()["data"]["reason"] == "门开着"

    episodes = await app_client.get(
        f"{PREFIX}/rooms/{room_id}/startup-episodes"
    )
    marked = [
        item for item in episodes.json()["data"]["items"] if item["is_excluded"]
    ]
    assert len(marked) == 1
    assert marked[0]["exclusion_reason"] == "门开着"


async def test_an_exclusion_may_point_at_a_moment_with_no_episode(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """⚠ 排除挂在自然键上：重算后起始时刻会平移，落空的那些由批次摘要报出来。"""
    room_id = await seeded_room(db_session, "落空")
    response = await app_client.put(
        f"{PREFIX}/rooms/{room_id}/startup-exclusions/2026-03-09T09:09:00Z",
        json={"reason": "参数变过之后落空的那条"},
    )
    assert response.status_code == 200


async def test_deleting_an_exclusion_is_idempotent(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """没排除过也返回 204——DELETE 必须幂等。"""
    room_id = await seeded_room(db_session, "取消排除")
    moment = "2026-03-01T00:10:00Z"
    path = f"{PREFIX}/rooms/{room_id}/startup-exclusions/{moment}"
    await app_client.put(path, json={"reason": "现场在调试"})
    assert (await app_client.delete(path)).status_code == 204
    assert (await app_client.delete(path)).status_code == 204
    episodes = await app_client.get(
        f"{PREFIX}/rooms/{room_id}/startup-episodes"
    )
    assert all(
        item["is_excluded"] is False
        for item in episodes.json()["data"]["items"]
    )


async def test_an_empty_exclusion_reason_is_rejected(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """排除必须写原因，空原因等于没排除理由。"""
    room_id = await make_room(db_session, "空原因")
    response = await app_client.put(
        f"{PREFIX}/rooms/{room_id}/startup-exclusions/2026-03-01T00:10:00Z",
        json={"reason": ""},
    )
    assert response.status_code == 400


@pytest.mark.parametrize(
    "path",
    ["startup-episodes", "startup-batches"],
    ids=["episodes", "batches"],
)
async def test_reads_need_the_view_code(
    app_client: httpx.AsyncClient,
    sign: SignHeaders,
    db_session: AsyncSession,
    path: str,
) -> None:
    """只有 `ac:manage` 的人也读不到——闸 2 判的是 `ac:view`。"""
    room_id = await make_room(db_session, f"读权限{path}")
    response = await app_client.get(
        f"{PREFIX}/rooms/{room_id}/{path}", headers=sign((AC_MANAGE,))
    )
    assert response.status_code == 403


async def test_writes_need_the_manage_code(
    app_client: httpx.AsyncClient,
    sign: SignHeaders,
    db_session: AsyncSession,
) -> None:
    """只读身份改不了人工排除。"""
    room_id = await make_room(db_session, "写权限")
    response = await app_client.put(
        f"{PREFIX}/rooms/{room_id}/startup-exclusions/2026-03-01T00:10:00Z",
        json={"reason": "现场在调试"},
        headers=sign((AC_VIEW,)),
    )
    assert response.status_code == 403


@pytest.mark.parametrize(
    "action",
    ["rebuild", "exclude", "unexclude"],
    ids=["rebuild", "put-exclusion", "delete-exclusion"],
)
async def test_writes_against_a_missing_room_are_not_found(
    app_client: httpx.AsyncClient, action: str
) -> None:
    """房间不存在时写面也是 404，不是「先建一个」。"""
    moment = "2026-03-01T00:10:00Z"
    if action == "rebuild":
        response = await app_client.post(
            f"{PREFIX}/rooms/{MISSING_ID}/startup-batches:rebuild",
            json={
                "window_start": "2026-01-01T00:00:00Z",
                "window_end": "2026-02-01T00:00:00Z",
            },
        )
    elif action == "exclude":
        response = await app_client.put(
            f"{PREFIX}/rooms/{MISSING_ID}/startup-exclusions/{moment}",
            json={"reason": "现场在调试"},
        )
    else:
        response = await app_client.delete(
            f"{PREFIX}/rooms/{MISSING_ID}/startup-exclusions/{moment}"
        )
    assert response.status_code == 404
    assert response.json()["code"] == 41602


@pytest.mark.parametrize(
    "payload",
    [{"nothing": "here"}, {"before": "not-a-timestamp"}],
    ids=["missing-anchor", "unparseable-anchor"],
)
async def test_a_well_formed_cursor_with_junk_inside_is_rejected(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    payload: dict[str, str],
) -> None:
    """⚠ 游标能解成 base64 不代表内容可信，里面的锚点同样要校验。"""
    room_id = await seeded_room(db_session, "坏锚点")
    response = await app_client.get(
        f"{PREFIX}/rooms/{room_id}/startup-episodes",
        params={"after": encode_cursor(payload)},
    )
    assert response.status_code == 400


async def test_a_batch_that_could_not_be_enqueued_is_marked_failed(
    db_session: AsyncSession,
) -> None:
    """⚠ 入队失败不能让批次永远停在「跑中」：进度停在 0/N 而没有消息在路上。"""
    room_id = await make_room(db_session, "入队失败")
    plan = await request_rebuild(
        db_session,
        room_id=room_id,
        window=TimeWindow(start=at(0), end=at(1440)),
        rules=ExtractionRules(),
    )
    failed = await fail_batch(db_session, plan.batch.id)
    assert failed is not None
    assert failed.status == BATCH_STATUS_FAILED


async def test_failing_a_batch_that_already_finished_does_nothing(
    db_session: AsyncSession,
) -> None:
    """已经收尾的批次不许被改回失败：切换成功之后它就是当前批次。"""
    room_id = await make_room(db_session, "已收尾")
    batch = await make_batch(db_session, room_id)
    assert await fail_batch(db_session, batch.id) is None
