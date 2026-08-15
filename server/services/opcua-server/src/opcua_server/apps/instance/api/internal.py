"""内部端点：批量解析节点、批量写值。边缘对 `/internal/` 一律 deny。

认证用服务级密钥而不是权限码——权限码挂在人身上，而这里的调用方是
platform-server 的发布循环，它不是人，也不该拿着一个人的令牌
（ADR-0005，docs/AC_PUBLISH_DESIGN.md §2）。

⚠ 本服务仍然**不认识**模型、房间、组合是什么。它只认「把这个值写进这个
节点」——`CONTEXT.md` 把「桥接内部点位」列为非目标，指的是不许反向依赖采集
运行时；依赖方向在这里仍然是 platform-server → opcua-server。
"""

import uuid
from functools import partial
from typing import Annotated

from fastapi import APIRouter, Depends

from lib.web import ApiResponse, ok
from opcua_server.apps.instance.deps import (
    get_container,
    get_idempotency_key,
    require_service_key,
)
from opcua_server.apps.instance.schemas import (
    NodeBatchWriteIn,
    NodeBatchWriteOut,
    NodeResolveIn,
    NodeResolveOut,
)
from opcua_server.container import Container
from opcua_server.settings import INTERNAL_PREFIX

router = APIRouter(
    prefix=f"{INTERNAL_PREFIX}/opcua",
    tags=["internal"],
    dependencies=[Depends(require_service_key)],
    include_in_schema=False,
)

ContainerDep = Annotated[Container, Depends(get_container)]
KeyDep = Annotated[str | None, Depends(get_idempotency_key)]

# 幂等键的缓存按 `(端点, 键, 调用者)` 分桶，而内部端点的调用者是一个服务不是
# 一个人。用全零 UUID 占住那一格：所有服务调用共用一个桶，键本身由调用方保证
# 唯一（发布循环每一拍现生成一个）
_SERVICE_CALLER = uuid.UUID(int=0)


@router.post(
    "/nodes:resolve",
    response_model=ApiResponse[NodeResolveOut],
    summary="批量解析节点",
)
async def resolve_nodes(
    payload: NodeResolveIn, container: ContainerDep
) -> ApiResponse[NodeResolveOut]:
    """批量取一组节点的标识、NodeId 与数据类型，顺序与入参一致。

    调用方拿它在**绑定的那一刻**校验类型，而不是等到每分钟写值时才发现
    「这个点位是 boolean，塞不进分钟数」。

    Args: payload, container。
    """
    return ok(
        await container.node_batch.resolve(payload.instance_id, payload.ids)
    )


async def _write_once(
    container: Container, key: str | None, payload: NodeBatchWriteIn
) -> NodeBatchWriteOut:
    """按幂等键写一次。

    Args: container, key, payload。
    """
    write = partial(
        container.node_batch.write_many, payload.instance_id, payload.items
    )
    return await container.idempotency.run_once(
        endpoint="write_nodes_batch",
        key=key,
        caller=_SERVICE_CALLER,
        model=NodeBatchWriteOut,
        action=write,
    )


@router.post(
    "/nodes:write",
    response_model=ApiResponse[NodeBatchWriteOut],
    summary="批量写节点值",
)
async def write_nodes(
    payload: NodeBatchWriteIn, container: ContainerDep, *, key: KeyDep
) -> ApiResponse[NodeBatchWriteOut]:
    """向同一实例的一批节点写值，逐项回执。只改运行时内存，不落库。

    ⚠ 幂等键与公开写值端点走**同一个**缓存面：内部调用方同样会因网络抖动而
    重试，而重试一次批量写就是向上位机可见的地址空间写两遍（api-contract §7）。

    Args: payload, container, key。
    """
    return ok(await _write_once(container, key, payload))
