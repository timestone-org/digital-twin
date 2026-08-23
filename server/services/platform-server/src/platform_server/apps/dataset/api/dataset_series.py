"""取数面：最后一行、时间序列，以及重算公式列。

⚠ 「取最后一条」「取序列」只能做成**子资源**而不是动作端点：末段带 `:` 的路径
全部方法必须是 POST（api-contract §1），写成 `GET …:latest` 会直接红。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.dataset.catalog import DATASET_VIEW
from platform_server.apps.dataset.deps import (
    get_backfill_writer,
    get_session,
    require,
)
from platform_server.apps.dataset.schemas import (
    LatestOut,
    RecomputeIn,
    RecomputeOut,
    SeriesOut,
)
from platform_server.apps.dataset.schemas.record import MAX_SERIES_KEYS
from platform_server.apps.dataset.services import (
    RecordWriter,
    record_read,
    record_write,
)
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/dataset-tables", tags=["dataset-series"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(DATASET_VIEW))]
BackfillDep = Annotated[RecordWriter, Depends(get_backfill_writer)]
KeysDep = Annotated[list[str], Query(max_length=MAX_SERIES_KEYS)]


@router.get(
    "/{table_id}/latest",
    response_model=ApiResponse[LatestOut],
    summary="最后一行",
)
async def read_latest(
    table_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[LatestOut]:
    """最后一行的值。⚠ 给的是 effective：大屏显示的必须是修正之后那个数。

    Args: table_id, session, _viewer。
    """
    return ok(await record_read.read_latest(session, table_id=table_id))


@router.get(
    "/{table_id}/series",
    response_model=ApiResponse[SeriesOut],
    summary="若干列的时间序列",
)
async def read_series(
    table_id: uuid.UUID,
    session: SessionDep,
    keys: KeysDep,
    _viewer: ViewDep,
    since: Annotated[str | None, Query()] = None,
    until: Annotated[str | None, Query()] = None,
) -> ApiResponse[SeriesOut]:
    """按列取序列，时刻升序。触顶时留下的是**最新**那批，回执会说出来。

    Args: table_id, session, keys, _viewer, since / until。
    """
    return ok(
        await record_read.read_series(
            session,
            table_id=table_id,
            keys=keys,
            filters=record_read.parse_filters(since=since, until=until),
        )
    )


@router.post(
    "/{table_id}:recompute",
    response_model=ApiResponse[RecomputeOut],
    summary="重算公式列",
)
async def recompute(
    table_id: uuid.UUID,
    payload: RecomputeIn,
    session: SessionDep,
    writer: BackfillDep,
) -> ApiResponse[RecomputeOut]:
    """改完公式之后重算。只写计算值，不碰任何原始录入值。

    Args: table_id, payload, session, writer。
    """
    outcome = await record_write.recompute_table(
        session, writer, table_id=table_id, payload=payload
    )
    return ok(outcome, message=_message(outcome))


def _message(outcome: RecomputeOut) -> str:
    """重算回执的文案。求值出错与触顶都要说出来。

    Args: outcome。
    """
    text = f"已重算 {outcome.recomputed} 行"
    if outcome.failed:
        text += f"，其中 {outcome.failed} 行存在求值错误"
    if outcome.is_truncated:
        text += "；待重算的行数触顶，请缩小时间范围后再算一次"
    return text
