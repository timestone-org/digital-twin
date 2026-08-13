"""实例面。

读用 `opcua:view`，起停用 `opcua:operate`，增删改用 `opcua:manage`。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status

from lib.auth import CallerContext
from lib.web import ApiResponse, Page, PageParams, ok, page_params
from opcua_server.apps.instance.deps import (
    PERM_MANAGE,
    PERM_OPERATE,
    PERM_VIEW,
    get_container,
    get_idempotency_key,
    require,
)
from opcua_server.apps.instance.schemas import (
    InstanceActionOut,
    InstanceCreateIn,
    InstanceOut,
    InstanceUpdateIn,
    PortPoolOut,
)
from opcua_server.container import Container
from opcua_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/instances", tags=["instance"])

ContainerDep = Annotated[Container, Depends(get_container)]
PageDep = Annotated[PageParams, Depends(page_params)]
KeyDep = Annotated[str | None, Depends(get_idempotency_key)]
ViewDep = Annotated[CallerContext, Depends(require(PERM_VIEW))]
OperateDep = Annotated[CallerContext, Depends(require(PERM_OPERATE))]
ManageDep = Annotated[CallerContext, Depends(require(PERM_MANAGE))]


@router.get(
    "", response_model=ApiResponse[Page[InstanceOut]], summary="实例列表"
)
async def list_instances(
    container: ContainerDep,
    page: PageDep,
    _viewer: ViewDep,
    q: str | None = None,
) -> ApiResponse[Page[InstanceOut]]:
    """分页列出实例。

    Args: container, page, _viewer, q。
    """
    return ok(await container.instances.list_instances(keyword=q, page=page))


@router.get(
    "/port-pool", response_model=ApiResponse[PortPoolOut], summary="端口池占用"
)
async def get_port_pool(
    container: ContainerDep, _viewer: ViewDep
) -> ApiResponse[PortPoolOut]:
    """端口池的容量与占用。池满时创建实例会被拒绝。

    Args: container, _viewer。
    """
    return ok(await container.instances.port_pool())


@router.post(
    "",
    response_model=ApiResponse[InstanceOut],
    status_code=status.HTTP_201_CREATED,
    summary="创建实例",
)
async def create_instance(
    payload: InstanceCreateIn,
    container: ContainerDep,
    key: KeyDep,
    manager: ManageDep,
) -> ApiResponse[InstanceOut]:
    """建实例并从池里分配端口。支持 `Idempotency-Key`。

    Args: payload, container, key, manager。
    """
    created = await container.idempotency.run_once(
        endpoint="create_instance",
        key=key,
        caller=manager.user_id,
        model=InstanceOut,
        action=lambda: container.instances.create_instance(payload),
    )
    return ok(created, message="实例已创建")


@router.get(
    "/{instance_id}",
    response_model=ApiResponse[InstanceOut],
    summary="实例详情",
)
async def get_instance(
    instance_id: uuid.UUID, container: ContainerDep, _viewer: ViewDep
) -> ApiResponse[InstanceOut]:
    """取实例详情。`is_running` 来自本地端口实况，不是期望状态。

    Args: instance_id, container, _viewer。
    """
    return ok(await container.instances.get_instance(instance_id))


@router.put(
    "/{instance_id}",
    response_model=ApiResponse[InstanceOut],
    summary="修改实例",
)
async def update_instance(
    instance_id: uuid.UUID,
    payload: InstanceUpdateIn,
    container: ContainerDep,
    _manager: ManageDep,
) -> ApiResponse[InstanceOut]:
    """改实例配置。出参的 `pending_fields` 列出尚未生效的项。

    Args: instance_id, payload, container, _manager。
    """
    updated = await container.instances.update_instance(instance_id, payload)
    return ok(updated, message="实例已保存")


@router.delete(
    "/{instance_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除实例",
)
async def delete_instance(
    instance_id: uuid.UUID, container: ContainerDep, _manager: ManageDep
) -> Response:
    """删实例。在跑就先停。删已删的同样返回 204。

    Args: instance_id, container, _manager。
    """
    await container.instances.delete_instance(instance_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{instance_id}:start",
    response_model=ApiResponse[InstanceActionOut],
    summary="启动实例",
)
async def start_instance(
    instance_id: uuid.UUID, container: ContainerDep, _operator: OperateDep
) -> ApiResponse[InstanceActionOut]:
    """起实例。返回的 `is_running` 是真的连过一次端口的结果。

    Args: instance_id, container, _operator。
    """
    return ok(await container.instances.start_instance(instance_id))


@router.post(
    "/{instance_id}:stop",
    response_model=ApiResponse[InstanceActionOut],
    summary="停止实例",
)
async def stop_instance(
    instance_id: uuid.UUID, container: ContainerDep, _operator: OperateDep
) -> ApiResponse[InstanceActionOut]:
    """停实例。

    Args: instance_id, container, _operator。
    """
    return ok(await container.instances.stop_instance(instance_id))


@router.post(
    "/{instance_id}:restart",
    response_model=ApiResponse[InstanceActionOut],
    summary="重启实例",
)
async def restart_instance(
    instance_id: uuid.UUID, container: ContainerDep, _operator: OperateDep
) -> ApiResponse[InstanceActionOut]:
    """重启实例，让待重启的配置生效。

    Args: instance_id, container, _operator。
    """
    return ok(await container.instances.restart_instance(instance_id))
