"""点位历史读侧。读用 `collect:view`。

⚠ 资源名是复数的 `point-histories`：URL 形状由 api-contract §1 钉死，
`point-history` 这个单数名会被对外契约闸挡下。
⚠ 聚合是 `POST …:aggregate` 而不是 GET：动作端点一律 POST，GET 带副作用会被
各级缓存与预取毁掉。它不改任何东西，故按读面放行。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from lib.auth import CallerContext
from lib.web import (
    ApiResponse,
    CursorPage,
    CursorParams,
    cursor_params,
    ok,
)
from platform_server.apps.collect.catalog import COLLECT_VIEW
from platform_server.apps.collect.crud import HistorySource
from platform_server.apps.collect.deps import get_container, require
from platform_server.apps.collect.schemas import (
    AggregateIn,
    AggregateOut,
    HistoryPointOut,
)
from platform_server.apps.collect.services import history_service
from platform_server.container import Container
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/point-histories", tags=["point-history"]
)

ContainerDep = Annotated[Container, Depends(get_container)]
CursorDep = Annotated[CursorParams, Depends(cursor_params)]
ViewDep = Annotated[CallerContext, Depends(require(COLLECT_VIEW))]
# 一次查询能问的点位上限，与 schemas.history 的 MAX_NODE_KEYS 同值
MAX_NODE_KEYS = 50


def get_history_source(container: ContainerDep) -> HistorySource:
    """取归档库的只读面。测试用 `dependency_overrides` 换成假件。

    Args: container。
    """
    return container.history


HistoryDep = Annotated[HistorySource, Depends(get_history_source)]


@router.get(
    "",
    response_model=ApiResponse[CursorPage[HistoryPointOut]],
    summary="点位历史",
)
async def list_history(
    source: HistoryDep,
    page: CursorDep,
    _viewer: ViewDep,
    node_keys: Annotated[list[str], Query(max_length=MAX_NODE_KEYS)],
    range_start: str,
    range_end: str,
) -> ApiResponse[CursorPage[HistoryPointOut]]:
    """按点位与时间区间取历史读数。**游标分页**。

    Args: source, page, _viewer, node_keys, range_start, range_end。
    """
    query = history_service.build_query(
        node_keys=node_keys,
        range_start=history_service.parse_moment(range_start, "range_start"),
        range_end=history_service.parse_moment(range_end, "range_end"),
    )
    return ok(
        await history_service.read_history(source, query=query, page=page)
    )


@router.post(
    ":aggregate",
    response_model=ApiResponse[AggregateOut],
    summary="历史分桶聚合",
)
async def aggregate_history(
    payload: AggregateIn,
    source: HistoryDep,
    container: ContainerDep,
    _viewer: ViewDep,
) -> ApiResponse[AggregateOut]:
    """按窗口分桶聚合，响应回显它用的时区口径。

    Args: payload, source, container, _viewer。
    """
    return ok(
        await history_service.aggregate_history(
            source,
            payload=payload,
            default_timezone=container.settings.collect_bucket_timezone,
        )
    )
