"""路由规则面。改动即改变全系统鉴权矩阵，是最高危的系统权限。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.catalog import (
    ROUTE_RULE_MANAGE,
    ROUTE_RULE_VIEW,
)
from auth_server.apps.auth.deps import (
    get_container,
    get_operation,
    get_session,
    require,
)
from auth_server.apps.auth.schemas import (
    RouteRuleCreateIn,
    RouteRuleOut,
    RouteRuleUpdateIn,
)
from auth_server.apps.auth.services import (
    Identity,
    Operation,
    route_rule_service,
)
from auth_server.container import Container
from auth_server.settings import API_PREFIX
from lib.web import ApiResponse, Page, PageParams, ok, page_params

router = APIRouter(prefix=f"{API_PREFIX}/route-rules", tags=["route-rule"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContainerDep = Annotated[Container, Depends(get_container)]
PageDep = Annotated[PageParams, Depends(page_params)]
OperationDep = Annotated[Operation, Depends(get_operation)]
ViewDep = Annotated[Identity, Depends(require(ROUTE_RULE_VIEW))]
ManageDep = Annotated[Identity, Depends(require(ROUTE_RULE_MANAGE))]


@router.get(
    "",
    response_model=ApiResponse[Page[RouteRuleOut]],
    summary="规则列表",
)
async def list_rules(
    session: SessionDep,
    page: PageDep,
    _viewer: ViewDep,
    q: str | None = None,
    is_enabled: bool | None = None,
    sort: str | None = None,
) -> ApiResponse[Page[RouteRuleOut]]:
    """默认按判定顺序排列。

    Args: session, page, _viewer, q, is_enabled, sort。
    """
    result = await route_rule_service.list_rules(
        session,
        keyword=q,
        is_enabled=is_enabled,
        page=page,
        sort=sort,
    )
    return ok(result)


@router.post(
    "",
    response_model=ApiResponse[RouteRuleOut],
    status_code=status.HTTP_201_CREATED,
    summary="新增规则",
)
async def create_rule(
    payload: RouteRuleCreateIn,
    session: SessionDep,
    container: ContainerDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> ApiResponse[RouteRuleOut]:
    """新增规则。引用未登记的权限码直接 400。

    Args: payload, session, container, operation, _manager。
    """
    created = await route_rule_service.create_rule(
        session, operation, payload=payload, cache=container.rules
    )
    return ok(created, message="规则已创建")


@router.get(
    "/{rule_id}",
    response_model=ApiResponse[RouteRuleOut],
    summary="规则详情",
)
async def read_rule(
    rule_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[RouteRuleOut]:
    """规则详情。

    Args: rule_id, session, _viewer。
    """
    return ok(await route_rule_service.get_rule(session, rule_id))


@router.patch(
    "/{rule_id}",
    response_model=ApiResponse[RouteRuleOut],
    summary="修改规则",
)
async def update_rule(
    rule_id: uuid.UUID,
    payload: RouteRuleUpdateIn,
    session: SessionDep,
    container: ContainerDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> ApiResponse[RouteRuleOut]:
    """修改规则。

    Args: rule_id, payload, session, container, operation, _manager。
    """
    updated = await route_rule_service.update_rule(
        session,
        operation,
        rule_id=rule_id,
        payload=payload,
        cache=container.rules,
    )
    return ok(updated, message="规则已更新")


@router.delete(
    "/{rule_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除规则",
)
async def delete_rule(
    rule_id: uuid.UUID,
    session: SessionDep,
    container: ContainerDep,
    operation: OperationDep,
    _manager: ManageDep,
) -> Response:
    """删除规则。

    Args: rule_id, session, container, operation, _manager。
    """
    await route_rule_service.delete_rule(
        session, operation, rule_id=rule_id, cache=container.rules
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
