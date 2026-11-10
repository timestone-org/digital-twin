"""能力端点报出的上限必须就是校验与裁剪真正用的那几个常量。"""

from uuid import uuid4

import pytest

from hierarchy_server.apps.projects.api import projects as api
from hierarchy_server.apps.projects.schemas.graph import MAX_EDGES, MAX_NODES
from hierarchy_server.apps.projects.schemas.projects import HISTORY_LIMIT
from lib.auth.context import CallerContext


def _caller() -> CallerContext:
    return CallerContext(
        user_id=uuid4(),
        username="viewer",
        role="viewer",
        permissions=frozenset({"hierarchy:view"}),
    )


async def test_capabilities_report_the_enforced_limits() -> None:
    reported = (await api.capabilities(_caller())).data

    assert reported is not None
    assert (
        reported.max_nodes,
        reported.max_edges,
        reported.history_limit,
    ) == (MAX_NODES, MAX_EDGES, HISTORY_LIMIT)


async def test_capabilities_follow_the_constants(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # ⚠ 前端按这里画编辑器上限：抄成字面量，改了常量这里不跟，画得出却存不下
    monkeypatch.setattr(api, "MAX_NODES", 7)
    monkeypatch.setattr(api, "MAX_EDGES", 8)
    monkeypatch.setattr(api, "HISTORY_LIMIT", 9)

    reported = (await api.capabilities(_caller())).data

    assert reported is not None
    assert (
        reported.max_nodes,
        reported.max_edges,
        reported.history_limit,
    ) == (7, 8, 9)
