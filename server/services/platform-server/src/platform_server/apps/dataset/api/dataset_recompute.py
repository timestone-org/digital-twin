"""重算任务：起任务 / 查进度（docs/DATASET_DESIGN.md §14.10）。

⚠ 起任务要 `dataset:backfill`、查进度只要 `dataset:view`：看进度的人与有权
改写大批历史行的人不是同一批。
⚠ 重算是长任务，POST 必须支持 `Idempotency-Key`：客户端的一次重试撞上的是
自己刚起的那个任务留下的单飞锁，用户看到一句莫名其妙的 409。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.dataset.catalog import DATASET_VIEW
from platform_server.apps.dataset.deps import (
    WriteGate,
    get_backfill_gate,
    get_recompute_runner,
    get_session,
    require,
)
from platform_server.apps.dataset.schemas import RecomputeIn, RecomputeJobOut
from platform_server.apps.dataset.services import (
    RecomputeRunner,
    recompute_service,
)
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/dataset-tables", tags=["dataset-recompute"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(DATASET_VIEW))]
GateDep = Annotated[WriteGate, Depends(get_backfill_gate)]
RunnerDep = Annotated[RecomputeRunner, Depends(get_recompute_runner)]


@router.post(
    "/{table_id}:recompute",
    response_model=ApiResponse[RecomputeJobOut],
    status_code=status.HTTP_202_ACCEPTED,
    summary="起一个重算公式列的任务",
)
async def start_recompute(
    table_id: uuid.UUID,
    payload: RecomputeIn,
    session: SessionDep,
    runner: RunnerDep,
    gate: GateDep,
) -> ApiResponse[RecomputeJobOut]:
    """后台重算这一段的公式列，立刻返回；进度轮询 GET `…/recompute`。

    Args: table_id, payload, session, runner, gate。
    """
    started = await gate.run_once(
        endpoint="dataset_recompute_start",
        model=RecomputeJobOut,
        action=lambda: recompute_service.start_recompute(
            session, runner, table_id=table_id, payload=payload
        ),
    )
    return ok(started, message=started.message)


@router.get(
    "/{table_id}/recompute",
    response_model=ApiResponse[RecomputeJobOut],
    summary="查重算进度",
)
async def read_recompute(
    table_id: uuid.UUID,
    session: SessionDep,
    runner: RunnerDep,
    _viewer: ViewDep,
) -> ApiResponse[RecomputeJobOut]:
    """`data = null` 表示这张表当前没有重算任务，与「任务失败」是两件事。

    Args: table_id, session, runner, _viewer。
    """
    found = await recompute_service.read_recompute(
        session, runner, table_id=table_id
    )
    if found is None:
        return ok(None, message="这张台账当前没有重算任务")
    return ok(found, message=found.message)
