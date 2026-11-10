"""取数面：最后一行与时间序列。重算任务在 `dataset_recompute.py`。

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
from platform_server.apps.dataset.deps import get_session, require
from platform_server.apps.dataset.schemas import (
    LatestOut,
    SeriesOut,
)
from platform_server.apps.dataset.schemas.record import MAX_SERIES_KEYS
from platform_server.apps.dataset.services import record_read
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/dataset-tables", tags=["dataset-series"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(DATASET_VIEW))]
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
