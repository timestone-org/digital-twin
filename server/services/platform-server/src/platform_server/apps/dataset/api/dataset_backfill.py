"""历史回填：起任务 / 查进度 / 取消。

⚠ 起与取消要 `dataset:backfill`，查进度只要 `dataset:view`（§9）：看进度的人
与有权改写历史的人不是同一批。
⚠ 回填是长任务，POST 必须支持 `Idempotency-Key`（§6.3）：客户端的一次重试
不该变成第二个回填任务——虽然写入本身按桶身份幂等，但第二次会撞上单飞锁，
用户看到的是一句莫名其妙的 409。
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
    get_backfill_runner,
    get_session,
    require,
)
from platform_server.apps.dataset.schemas import (
    BackfillJobOut,
    BackfillStartIn,
)
from platform_server.apps.dataset.services import backfill_service
from platform_server.apps.dataset.services.backfill_service import (
    BackfillRunner,
)
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/dataset-tables", tags=["dataset-backfill"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(DATASET_VIEW))]
GateDep = Annotated[WriteGate, Depends(get_backfill_gate)]
RunnerDep = Annotated[BackfillRunner, Depends(get_backfill_runner)]


@router.post(
    "/{table_id}/backfill",
    response_model=ApiResponse[BackfillJobOut],
    status_code=status.HTTP_202_ACCEPTED,
    summary="起一个历史回填任务",
)
async def start_backfill(
    table_id: uuid.UUID,
    payload: BackfillStartIn,
    session: SessionDep,
    runner: RunnerDep,
    gate: GateDep,
) -> ApiResponse[BackfillJobOut]:
    """后台补这一段的桶，立刻返回；进度轮询 GET 同一路径。

    Args: table_id, payload, session, runner, gate。
    """
    started = await gate.run_once(
        endpoint="dataset_backfill_start",
        model=BackfillJobOut,
        action=lambda: backfill_service.start_backfill(
            session, runner, table_id=table_id, payload=payload
        ),
    )
    return ok(started, message=started.message)


@router.get(
    "/{table_id}/backfill",
    response_model=ApiResponse[BackfillJobOut],
    summary="查回填进度",
)
async def read_backfill(
    table_id: uuid.UUID,
    session: SessionDep,
    runner: RunnerDep,
    _viewer: ViewDep,
) -> ApiResponse[BackfillJobOut]:
    """`data = null` 表示这张表当前没有回填任务，与「任务失败」是两件事。

    Args: table_id, session, runner, _viewer。
    """
    found = await backfill_service.read_progress(
        session, runner.jobs, table_id=table_id
    )
    if found is None:
        return ok(None, message="这张台账当前没有回填任务")
    return ok(found, message=found.message)


@router.delete(
    "/{table_id}/backfill",
    response_model=ApiResponse[BackfillJobOut],
    summary="取消正在跑的回填",
)
async def cancel_backfill(
    table_id: uuid.UUID, session: SessionDep, runner: RunnerDep, _gate: GateDep
) -> ApiResponse[BackfillJobOut]:
    """取消是协作式的：当前这批跑完即停，绝不留写了一半的批。

    ⚠ 不是 204：停下之后已写入的部分照样会重算一遍，而「补了多少、重算了多少」
    只能由回执说出来。
    Args: table_id, session, runner, _gate。
    """
    cancelled = await backfill_service.cancel_backfill(
        session, runner.jobs, table_id=table_id
    )
    return ok(cancelled, message="已请求取消，当前这批跑完即停")
