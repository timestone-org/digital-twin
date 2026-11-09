"""执行搬到 worker 之后的那几条不变量：入队、单飞、取消、重投递、保留期。

⚠ 这一组必须打真库：单飞靠的是一条**部分唯一索引**，而索引的行为只有真
Postgres 答得出来——假件里它就是一句注释。
"""

import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.modeling_helpers import (
    HTTP_ACCEPTED,
    HTTP_CONFLICT,
    PIPELINES,
    RUNS,
    code_of,
    create_pipeline,
    data_of,
    drive_run,
    linear_graph,
)
from integration.test_modeling_api import _seed_ledger
from platform_server.apps.modeling.crud import node_run_crud, run_crud
from platform_server.apps.modeling.services import run_dispatch
from platform_server.apps.modeling.services.retention import (
    LEFTOVER_REASONS,
    RetentionOptions,
    converge_pipeline,
    reap_stale,
    sweep_expired,
)
from platform_server.apps.modeling.services.run_dispatch import (
    INTERRUPTED_REASON,
    RUN_INTERRUPTED,
    RUN_ORPHANED,
)

pytestmark = pytest.mark.requires_postgres

RUN_ALREADY_ACTIVE = 41406
STALE_MINUTES = 30


async def _start(client: httpx.AsyncClient, pipeline_id: str) -> dict[str, Any]:
    """只发起、不驱动，拿到那条 pending 的运行。

    Args: client, pipeline_id。
    """
    response = await client.post(
        f"{PIPELINES}/{pipeline_id}:run", json={"trigger": "manual"}
    )
    assert response.status_code == HTTP_ACCEPTED, response.text
    return dict(data_of(response))


async def test_starting_a_run_only_enqueues_it(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """`:run` 只入队：立刻回一条 `pending`，一个节点都还没跑。"""
    await _seed_ledger(app_client, db_session, "energy_q1")
    created = await create_pipeline(app_client, "q1", linear_graph("energy_q1"))
    run = await _start(app_client, created["id"])
    assert run["status"] == "pending"
    assert run["nodes"] == []
    assert run["started_at"] is None


async def _beyond_keep(
    sessions: MakerSessions, pipeline_id: str, keep: int
) -> list[uuid.UUID]:
    """收敛名单。Args: sessions, pipeline_id, keep。"""
    async with sessions.session() as session:
        return await run_crud.ids_beyond_keep(
            session,
            pipeline_id=uuid.UUID(pipeline_id),
            keep=keep,
            exclude=frozenset(),
            leftover_reasons=LEFTOVER_REASONS,
        )


async def test_a_second_run_is_rejected_by_the_database(
    app_client: httpx.AsyncClient, db_session: AsyncSession
) -> None:
    """同一条流水线的第二次发起 409。

    ⚠ 挡住它的是那条部分唯一索引，不是应用层先查再插——先查再插在并发下会
    同时通过（D17）。
    """
    await _seed_ledger(app_client, db_session, "energy_q2")
    created = await create_pipeline(app_client, "q2", linear_graph("energy_q2"))
    await _start(app_client, created["id"])
    response = await app_client.post(
        f"{PIPELINES}/{created['id']}:run", json={"trigger": "manual"}
    )
    assert response.status_code == HTTP_CONFLICT
    assert code_of(response) == RUN_ALREADY_ACTIVE


async def test_a_finished_run_frees_the_pipeline_again(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """跑完之后那条流水线又能再发起——在途集合放开了。"""
    await _seed_ledger(app_client, db_session, "energy_q3")
    created = await create_pipeline(app_client, "q3", linear_graph("energy_q3"))
    first = await _start(app_client, created["id"])
    await drive_run(worker_sessions, uuid.UUID(first["id"]))
    second = await _start(app_client, created["id"])
    assert second["id"] != first["id"]


async def test_cancelling_before_the_worker_picks_it_up(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """先取消再让 worker 跑：一个节点都不该执行，终态是 cancelled。"""
    await _seed_ledger(app_client, db_session, "energy_q4")
    created = await create_pipeline(app_client, "q4", linear_graph("energy_q4"))
    run = await _start(app_client, created["id"])
    cancelled = data_of(await app_client.post(f"{RUNS}/{run['id']}:cancel"))
    assert cancelled["status"] == "cancelling"
    await drive_run(worker_sessions, uuid.UUID(run["id"]))
    detail = data_of(await app_client.get(f"{RUNS}/{run['id']}"))
    assert detail["status"] == "cancelled"
    assert {item["status"] for item in detail["nodes"]} == {"skipped"}


async def test_a_redelivered_run_is_marked_interrupted_not_replayed(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """同一条消息第二次派发不重放，落 `failed` 并说明原因。

    ⚠ 重放要先把已写的节点记录清干净再来一遍；而一张会让子进程崩溃的图会被
    无限重投，把整个建模面堵死（D25）。
    """
    await _seed_ledger(app_client, db_session, "energy_q5")
    created = await create_pipeline(app_client, "q5", linear_graph("energy_q5"))
    run = await _start(app_client, created["id"])
    run_id = uuid.UUID(run["id"])
    async with worker_sessions.session() as session:
        row = await run_crud.get(session, run_id)
        assert row is not None
        row.attempt = 1
    report = await drive_run(worker_sessions, run_id)
    assert report.outcome == RUN_INTERRUPTED
    detail = data_of(await app_client.get(f"{RUNS}/{run['id']}"))
    assert detail["status"] == "failed"
    assert detail["error_text"] == INTERRUPTED_REASON


async def test_a_vanished_run_is_orphaned_not_an_error(
    worker_sessions: MakerSessions,
) -> None:
    """消息指向一条已经不存在的运行时，确认丢弃而不是让循环炸掉。"""
    report = await drive_run(worker_sessions, uuid.uuid4())
    assert report.outcome == RUN_ORPHANED


async def test_a_stale_run_is_reaped_so_the_pipeline_unlocks(
    app_client: httpx.AsyncClient, worker_sessions: MakerSessions
) -> None:
    """心跳陈旧的在途运行被收成 failed，否则那条流水线永远发不起第二次。"""
    created = await create_pipeline(app_client, "q6", linear_graph("any"))
    run = await _start(app_client, created["id"])
    async with worker_sessions.session() as session:
        row = await run_crud.get(session, uuid.UUID(run["id"]))
        assert row is not None
        row.heartbeat_at = row.created_at.replace(year=2000)
    reaped = await reap_stale(
        worker_sessions, options=_options(keep=20, days=90)
    )
    assert reaped == 1
    detail = data_of(await app_client.get(f"{RUNS}/{run['id']}"))
    assert detail["status"] == "failed"


async def test_converge_keeps_only_the_newest_node_details(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """节点明细只留最近 N 次运行的，更老的删明细、**保留运行行**。"""
    await _seed_ledger(app_client, db_session, "energy_q7")
    graph = linear_graph("energy_q7")
    graph["nodes"] = [graph["nodes"][0]]
    graph["edges"] = []
    created = await create_pipeline(app_client, "q7", graph)
    first = await _start(app_client, created["id"])
    await drive_run(worker_sessions, uuid.UUID(first["id"]))
    second = await _start(app_client, created["id"])
    await drive_run(worker_sessions, uuid.UUID(second["id"]))

    removed = await converge_pipeline(
        worker_sessions, pipeline_id=uuid.UUID(created["id"]), keep=1
    )
    assert removed > 0
    async with worker_sessions.session() as session:
        assert (
            await node_run_crud.list_by_run(session, uuid.UUID(first["id"]))
            == []
        )
    # 运行行还在，只是点不开中间结果
    assert (
        data_of(await app_client.get(f"{RUNS}/{first['id']}"))["id"]
        == first["id"]
    )


async def test_a_converged_run_leaves_the_list_but_keeps_its_slot(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """收敛过的运行不再进名单，但仍占 `keep` 名额，收敛范围不变。"""
    await _seed_ledger(app_client, db_session, "energy_q8")
    graph = linear_graph("energy_q8")
    graph["nodes"] = [graph["nodes"][0]]
    graph["edges"] = []
    created = await create_pipeline(app_client, "q8", graph)
    ids: list[uuid.UUID] = []
    for _ in range(3):
        run = await _start(app_client, created["id"])
        ids.append(uuid.UUID(run["id"]))
        await drive_run(worker_sessions, ids[-1])

    await converge_pipeline(
        worker_sessions, pipeline_id=uuid.UUID(created["id"]), keep=2
    )
    assert await _beyond_keep(worker_sessions, created["id"], 2) == []
    # 第一条明细已清仍占名额：keep=1 时只轮到第二条，第一条不重复进名单
    assert await _beyond_keep(worker_sessions, created["id"], 1) == [ids[1]]


async def test_an_interrupted_run_without_details_is_still_converged(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
) -> None:
    """字节写进存储、节点行没落上就断掉的运行：没有明细也要清字节。"""
    await _seed_ledger(app_client, db_session, "energy_q9")
    graph = linear_graph("energy_q9")
    graph["nodes"] = [graph["nodes"][0]]
    graph["edges"] = []
    created = await create_pipeline(app_client, "q9", graph)
    first = uuid.UUID((await _start(app_client, created["id"]))["id"])
    async with worker_sessions.session() as session:
        run = await run_crud.get(session, first)
        assert run is not None
        run.status = "failed"
        run.finished_at = datetime.now(UTC)
        run.error_text = INTERRUPTED_REASON
        run.publication_status = "skipped"
    await drive_run(
        worker_sessions,
        uuid.UUID((await _start(app_client, created["id"]))["id"]),
    )
    assert await _beyond_keep(worker_sessions, created["id"], 1) == [first]


def _options(*, keep: int, days: int) -> RetentionOptions:
    return RetentionOptions(
        keep_per_pipeline=keep,
        retention_days=days,
        stale_minutes=STALE_MINUTES,
        interval_s=1.0,
    )


async def test_the_sweep_keeps_an_old_run_that_is_still_active(
    app_client: httpx.AsyncClient, worker_sessions: MakerSessions
) -> None:
    """过了保留期却还在途（等着派发）的运行不删：删了它，那条消息就悬空了。"""
    created = await create_pipeline(
        app_client, "sweepactive", linear_graph("any")
    )
    run = await _start(app_client, created["id"])
    async with worker_sessions.session() as session:
        row = await run_crud.get(session, uuid.UUID(run["id"]))
        assert row is not None
        row.created_at = row.created_at.replace(year=2000)
    removed = await sweep_expired(
        worker_sessions, options=_options(keep=20, days=90), store=None
    )
    assert removed == 0
    async with worker_sessions.session() as session:
        assert await run_crud.get(session, uuid.UUID(run["id"])) is not None


async def test_the_sweep_drops_an_old_finished_unpublished_run(
    app_client: httpx.AsyncClient, worker_sessions: MakerSessions
) -> None:
    """过了保留期、没发布过的终态运行照删。"""
    created = await create_pipeline(
        app_client, "sweepdone", linear_graph("any")
    )
    run = await _start(app_client, created["id"])
    async with worker_sessions.session() as session:
        row = await run_crud.get(session, uuid.UUID(run["id"]))
        assert row is not None
        row.status = "failed"
        row.created_at = row.created_at.replace(year=2000)
    removed = await sweep_expired(
        worker_sessions, options=_options(keep=20, days=90), store=None
    )
    assert removed == 1


async def test_a_run_cancelled_before_pickup_skips_the_data_fetch(
    app_client: httpx.AsyncClient,
    worker_sessions: MakerSessions,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """取消在认领之前：不再整趟取数，也不先翻回 running。"""
    created = await create_pipeline(app_client, "q4b", linear_graph("any"))
    run = await _start(app_client, created["id"])
    await app_client.post(f"{RUNS}/{run['id']}:cancel")
    fetched: list[object] = []

    async def prefetch(*args: object, **kwargs: object) -> object:
        fetched.append((args, kwargs))
        raise AssertionError("取消了的运行不该取数")

    monkeypatch.setattr(run_dispatch.frame_source, "prefetch", prefetch)
    await drive_run(worker_sessions, uuid.UUID(run["id"]))
    assert fetched == []
    detail = data_of(await app_client.get(f"{RUNS}/{run['id']}"))
    assert detail["status"] == "cancelled"
