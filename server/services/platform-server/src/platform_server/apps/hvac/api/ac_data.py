"""数据集目录、数据源绑定与达标范围。读用 `ac:view`，写用 `ac:manage`。

绑定与达标范围都是**覆盖式**的 `PUT`：同一台空调的同一个数据集只有一条绑定，
同一个指标只有一条达标范围，重复调用是覆盖而不是新增。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.deps import get_session, require
from platform_server.apps.hvac.schemas import (
    AcDataBindingOut,
    AcDataBindingPutIn,
    AcDataBindingsOut,
    DatasetsOut,
    MetricLimitsOut,
    MetricLimitsPutIn,
)
from platform_server.apps.hvac.services import ac_data_service
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=API_PREFIX, tags=["ac-data"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(AC_VIEW))]
ManageDep = Annotated[CallerContext, Depends(require(AC_MANAGE))]


@router.get(
    "/ac-datasets",
    response_model=ApiResponse[DatasetsOut],
    summary="数据集目录",
)
async def list_datasets(_viewer: ViewDep) -> ApiResponse[DatasetsOut]:
    """可看的数据集与它们的指标。加数据集时前端不用改。

    Args: _viewer。
    """
    return ok(ac_data_service.list_datasets())


@router.get(
    "/ac-units/{ac_unit_id}/data-bindings",
    response_model=ApiResponse[AcDataBindingsOut],
    summary="空调的数据源绑定",
)
async def list_bindings(
    ac_unit_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[AcDataBindingsOut]:
    """一台空调绑了哪些数据源。

    Args: ac_unit_id, session, _viewer。
    """
    return ok(
        await ac_data_service.list_bindings(session, ac_unit_id=ac_unit_id)
    )


@router.put(
    "/ac-units/{ac_unit_id}/data-bindings/{dataset}",
    response_model=ApiResponse[AcDataBindingOut],
    summary="设置数据源绑定",
)
async def put_binding(
    ac_unit_id: uuid.UUID,
    dataset: str,
    payload: AcDataBindingPutIn,
    session: SessionDep,
    _manager: ManageDep,
) -> ApiResponse[AcDataBindingOut]:
    """把这台空调的这个数据集指向外部库里的一个对象。

    Args: ac_unit_id, dataset, payload, session, _manager。
    """
    binding = await ac_data_service.put_binding(
        session, ac_unit_id=ac_unit_id, dataset=dataset, payload=payload
    )
    return ok(binding, message="数据源绑定已设置")


@router.delete(
    "/ac-units/{ac_unit_id}/data-bindings/{dataset}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="解除数据源绑定",
)
async def delete_binding(
    ac_unit_id: uuid.UUID,
    dataset: str,
    session: SessionDep,
    _manager: ManageDep,
) -> Response:
    """解除绑定。没绑过也返回 204——DELETE 必须幂等。

    Args: ac_unit_id, dataset, session, _manager。
    """
    await ac_data_service.delete_binding(
        session, ac_unit_id=ac_unit_id, dataset=dataset
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/ac-units/{ac_unit_id}/metric-limits",
    response_model=ApiResponse[MetricLimitsOut],
    summary="空调的达标范围",
)
async def list_metric_limits(
    ac_unit_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[MetricLimitsOut]:
    """一台空调各指标的上下限。

    Args: ac_unit_id, session, _viewer。
    """
    return ok(
        await ac_data_service.list_metric_limits(session, ac_unit_id=ac_unit_id)
    )


@router.put(
    "/ac-units/{ac_unit_id}/metric-limits",
    response_model=ApiResponse[MetricLimitsOut],
    summary="设置达标范围",
)
async def put_metric_limits(
    ac_unit_id: uuid.UUID,
    payload: MetricLimitsPutIn,
    session: SessionDep,
    _manager: ManageDep,
) -> ApiResponse[MetricLimitsOut]:
    """覆盖式设置达标范围。请求里没出现的指标视为清除。

    Args: ac_unit_id, payload, session, _manager。
    """
    limits = await ac_data_service.put_metric_limits(
        session, ac_unit_id=ac_unit_id, payload=payload
    )
    return ok(limits, message="达标范围已设置")
