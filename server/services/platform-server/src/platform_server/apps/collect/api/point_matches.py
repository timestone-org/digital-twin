"""采集点位语义候选只读面，沿用 collect:view。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.collect.catalog import COLLECT_VIEW
from platform_server.apps.collect.schemas.point_search import PointMatchesOut
from platform_server.apps.collect.services.point_search import PointSearch
from platform_server.container import Container
from platform_server.deps import get_container, require
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/collect-point-matches", tags=["collect-point"]
)


@router.get(
    "", response_model=ApiResponse[PointMatchesOut], summary="点位混合搜索"
)
async def list_matches(
    container: Annotated[Container, Depends(get_container)],
    _viewer: Annotated[CallerContext, Depends(require(COLLECT_VIEW))],
    q: Annotated[str, Query(min_length=1, max_length=300, pattern=r".*\S.*")],
    source_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=12)] = 6,
) -> ApiResponse[PointMatchesOut]:
    """搜索可绑定点位并回显降级状态。

    Args: container, _viewer, q, source_id, limit。
    """
    return ok(
        await PointSearch(container.database, container.llm.cipher).search(
            q.strip(), source_id, limit
        )
    )
