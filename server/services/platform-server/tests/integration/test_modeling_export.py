"""全量结果导出的端到端：开着那一档才有得下，且下载要另一个权限码。

⚠ 这一组的立论是「能看不等于能带走」：摘要那一份 200 行是给人看一眼的，
而导出来的 CSV 里是**台账原始数据**，所以它要 `dataset:record:export`
（docs/MODELING_PLATFORM_DESIGN.md D12）。
"""

import uuid
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.database_fakes import MakerSessions

from integration.modeling_helpers import (
    HTTP_ACCEPTED,
    HTTP_OK,
    LOAD,
    PIPELINES,
    RUNS,
    TEMPERATURE,
    code_of,
    create_pipeline,
    data_of,
    drive_run,
    linear_graph,
)
from integration.test_modeling_api import _seed_ledger
from lib.testing import FakeObjectStore

pytestmark = pytest.mark.requires_postgres

HTTP_NOT_FOUND = 404
FRAME_EXPORT_MISSING = 41425
# 取数那一步的节点 id 与它的输出端口，与 `linear_graph` 同源
SOURCE_NODE = "s"
SOURCE_PORT = "frame"


@dataclass(frozen=True)
class Setup:
    """一次导出用例要的四样。打成一包是因为形参上限是 5。"""

    client: httpx.AsyncClient
    session: AsyncSession
    sessions: MakerSessions
    #: ⚠ 必须是**应用那一个**替身：另造一个的话，扮演 worker 那一步写进去的
    #: 字节与端点读的是两个不同的桶，而现象是「明明写了却下不到」
    store: FakeObjectStore


def _setup(
    client: httpx.AsyncClient,
    session: AsyncSession,
    sessions: MakerSessions,
    store: FakeObjectStore,
) -> Setup:
    """把四个 fixture 拼成一包。

    Args: client, session, sessions, store。
    """
    return Setup(client=client, session=session, sessions=sessions, store=store)


async def _run_with(
    setup: Setup, code: str, *, is_keeping: bool
) -> dict[str, Any]:
    """种数据、跑一遍（可选留全量结果），回运行详情。

    Args: setup, code, is_keeping。
    """
    await _seed_ledger(setup.client, setup.session, f"energy_{code}")
    pipeline = await create_pipeline(
        setup.client, code, linear_graph(f"energy_{code}")
    )
    response = await setup.client.post(
        f"{PIPELINES}/{pipeline['id']}:run",
        json={"trigger": "manual", "is_keeping_frames": is_keeping},
    )
    assert response.status_code == HTTP_ACCEPTED, response.text
    accepted = dict(data_of(response))
    await drive_run(setup.sessions, uuid.UUID(str(accepted["id"])), setup.store)
    return dict(data_of(await setup.client.get(f"{RUNS}/{accepted['id']}")))


async def test_the_run_says_whether_it_kept_the_frames(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
    object_store: FakeObjectStore,
) -> None:
    """运行详情上如实标出有没有留全量结果。界面按它决定下载入口显不显示。"""
    setup = _setup(app_client, db_session, worker_sessions, object_store)
    kept = await _run_with(setup, "expkept", is_keeping=True)

    assert kept["is_keeping_frames"] is True


async def test_the_default_keeps_nothing(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
    object_store: FakeObjectStore,
) -> None:
    """不勾就一个字节都不写。

    ⚠ 默认开会让每一次运行都往对象存储写几十 MB，而绝大多数运行只是在调参数。
    """
    setup = _setup(app_client, db_session, worker_sessions, object_store)
    detail = await _run_with(setup, "expoff", is_keeping=False)

    assert detail["is_keeping_frames"] is False
    assert [key for key in object_store.objects if "/frames/" in key] == []


async def test_the_node_lists_which_ports_were_kept(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
    object_store: FakeObjectStore,
) -> None:
    """节点详情列出留下了哪些端口。

    ⚠ 只给端口名不给对象键：键是服务端的事，交出去等于把「猜一个别的键」
    那条路也一起交出去。
    """
    setup = _setup(app_client, db_session, worker_sessions, object_store)
    detail = await _run_with(setup, "expports", is_keeping=True)

    node = data_of(
        await app_client.get(f"{RUNS}/{detail['id']}/nodes/{SOURCE_NODE}")
    )
    assert node["exported_ports"] == [SOURCE_PORT]
    assert "object_key" not in str(node)


async def test_downloading_gives_a_csv_that_lines_up_with_the_ledger(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
    object_store: FakeObjectStore,
) -> None:
    """下载回来的 CSV 第一列是时刻，后面是台账那几列。

    ⚠ 时刻不写的话，导出来的数据没法与台账对齐——而那正是导出的用处。
    """
    setup = _setup(app_client, db_session, worker_sessions, object_store)
    detail = await _run_with(setup, "expcsv", is_keeping=True)

    response = await app_client.get(
        f"{RUNS}/{detail['id']}/frames/{SOURCE_NODE}",
        params={"port": SOURCE_PORT},
    )
    assert response.status_code == HTTP_OK, response.text
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    head = response.text.splitlines()[0].split(",")
    assert head[0] == "__ts__"
    assert TEMPERATURE in head
    assert LOAD in head


async def test_a_run_that_kept_nothing_says_what_to_do(
    app_client: httpx.AsyncClient,
    db_session: AsyncSession,
    worker_sessions: MakerSessions,
    object_store: FakeObjectStore,
) -> None:
    """没留过的运行给一句人话，指到「发起运行时勾上那一档」。"""
    setup = _setup(app_client, db_session, worker_sessions, object_store)
    detail = await _run_with(setup, "expnone", is_keeping=False)

    response = await app_client.get(
        f"{RUNS}/{detail['id']}/frames/{SOURCE_NODE}",
        params={"port": SOURCE_PORT},
    )
    assert response.status_code == HTTP_NOT_FOUND
    assert code_of(response) == FRAME_EXPORT_MISSING
    assert "保留全量结果" in response.json()["message"]
