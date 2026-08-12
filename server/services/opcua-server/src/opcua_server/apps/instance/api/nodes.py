"""节点面。

读用 `opcua:view`，写值用 `opcua:operate`，增删改定义用 `opcua:manage`。

⚠ 写值与「改定义」是两档权限：写值改的是上位机此刻读到的数
（物理上等价于对现场下指令），改定义改的是地址空间的形状。

⚠ 写值端点**必须**支持 `Idempotency-Key`：网络抖动引发的客户端重试，
没有幂等键时会向上位机可见的地址空间写两次（api-contract §7）。
"""

import uuid
from functools import partial
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
    NodeCreateIn,
    NodeMutationOut,
    NodeOut,
    NodeUpdateIn,
    NodeValueOut,
    NodeWriteIn,
    NodeWriteOut,
)
from opcua_server.container import Container
from opcua_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/instances/{{instance_id}}/nodes", tags=["node"]
)

ContainerDep = Annotated[Container, Depends(get_container)]
PageDep = Annotated[PageParams, Depends(page_params)]
KeyDep = Annotated[str | None, Depends(get_idempotency_key)]
ViewDep = Annotated[CallerContext, Depends(require(PERM_VIEW))]
OperateDep = Annotated[CallerContext, Depends(require(PERM_OPERATE))]
ManageDep = Annotated[CallerContext, Depends(require(PERM_MANAGE))]


@router.get("", response_model=ApiResponse[Page[NodeOut]], summary="节点列表")
async def list_nodes(
    instance_id: uuid.UUID,
    container: ContainerDep,
    page: PageDep,
    _viewer: ViewDep,
    q: str | None = None,
) -> ApiResponse[Page[NodeOut]]:
    """分页列出某实例的节点。

    Args: instance_id, container, page, _viewer, q。
    """
    return ok(
        await container.nodes.list_nodes(instance_id, keyword=q, page=page)
    )


@router.post(
    "",
    response_model=ApiResponse[NodeMutationOut],
    status_code=status.HTTP_201_CREATED,
    summary="创建节点",
)
async def create_node(
    instance_id: uuid.UUID,
    payload: NodeCreateIn,
    container: ContainerDep,
    key: KeyDep,
    manager: ManageDep,
) -> ApiResponse[NodeMutationOut]:
    """建节点。标识冲突只报错，绝不自动改名。支持 `Idempotency-Key`。

    Args: instance_id, payload, container, key, manager。
    """
    created = await container.idempotency.run_once(
        endpoint="create_node",
        key=key,
        caller=manager.user_id,
        model=NodeMutationOut,
        action=lambda: container.nodes.create_node(instance_id, payload),
    )
    return ok(created, message="节点已创建")


@router.get(
    "/{node_id}", response_model=ApiResponse[NodeOut], summary="节点详情"
)
async def get_node(
    instance_id: uuid.UUID,
    node_id: uuid.UUID,
    container: ContainerDep,
    _viewer: ViewDep,
) -> ApiResponse[NodeOut]:
    """取节点定义。

    Args: instance_id, node_id, container, _viewer。
    """
    return ok(await container.nodes.get_node(instance_id, node_id))


@router.put(
    "/{node_id}",
    response_model=ApiResponse[NodeMutationOut],
    summary="修改节点",
)
async def update_node(
    instance_id: uuid.UUID,
    node_id: uuid.UUID,
    payload: NodeUpdateIn,
    container: ContainerDep,
    _manager: ManageDep,
) -> ApiResponse[NodeMutationOut]:
    """改节点定义。标识不可改——要换只能删了重建。

    Args: instance_id, node_id, payload, container, _manager。
    """
    updated = await container.nodes.update_node(instance_id, node_id, payload)
    return ok(updated, message="节点已保存")


@router.delete(
    "/{node_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除节点",
)
async def delete_node(
    instance_id: uuid.UUID,
    node_id: uuid.UUID,
    container: ContainerDep,
    _manager: ManageDep,
) -> Response:
    """删节点。

    Args: instance_id, node_id, container, _manager。
    """
    await container.nodes.delete_node(instance_id, node_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/{node_id}/value",
    response_model=ApiResponse[NodeValueOut],
    summary="读节点值",
)
async def read_node_value(
    instance_id: uuid.UUID,
    node_id: uuid.UUID,
    container: ContainerDep,
    _viewer: ViewDep,
) -> ApiResponse[NodeValueOut]:
    """读当前值。⚠ 实例没在跑时 `is_live` 为假，读到的是初值。

    Args: instance_id, node_id, container, _viewer。
    """
    return ok(await container.nodes.read_value(instance_id, node_id))


async def _write_once(
    container: Container,
    operator: CallerContext,
    key: str | None,
    target: tuple[uuid.UUID, uuid.UUID],
    value: object,
) -> NodeWriteOut:
    """按幂等键写一次值。

    Args: container, operator, key, target（实例与节点 id）, value。
    """
    instance_id, node_id = target
    write = partial(container.nodes.write_value, instance_id, node_id, value)
    return await container.idempotency.run_once(
        endpoint="write_node_value",
        key=key,
        caller=operator.user_id,
        model=NodeWriteOut,
        action=write,
    )


@router.post(
    "/{node_id}:write",
    response_model=ApiResponse[NodeWriteOut],
    summary="写节点值",
)
async def write_node_value(
    instance_id: uuid.UUID,
    node_id: uuid.UUID,
    payload: NodeWriteIn,
    container: ContainerDep,
    *,
    key: KeyDep,
    operator: OperateDep,
) -> ApiResponse[NodeWriteOut]:
    """写值。只改运行时内存，不落库；重启回初值。

    Args: instance_id, node_id, payload, container, key, operator。
    """
    target = (instance_id, node_id)
    return ok(
        await _write_once(container, operator, key, target, payload.value)
    )
