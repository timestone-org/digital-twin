"""内部端点：主题登记 / 注销 / 推送。边缘对 `/internal/` 一律 deny。

认证用服务级密钥而不是用户权限码——权限码挂在人身上，而这里要挡的是
「任何人」（ADR-0005）。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header

from lib.web import ApiResponse, ok
from realtime_hub.apps.channel.deps import get_container, require_service_key
from realtime_hub.apps.channel.schemas import (
    PublishIn,
    PublishOut,
    TopicDeclareIn,
    TopicRevokeOut,
)
from realtime_hub.container import Container
from realtime_hub.settings import INTERNAL_PREFIX

router = APIRouter(
    prefix=f"{INTERNAL_PREFIX}/realtime",
    tags=["internal"],
    dependencies=[Depends(require_service_key)],
    include_in_schema=False,
)

ContainerDep = Annotated[Container, Depends(get_container)]


@router.post("/topics", summary="登记主题")
async def declare_topic(
    payload: TopicDeclareIn, container: ContainerDep
) -> ApiResponse[TopicDeclareIn]:
    """登记一个主题并声明订阅它所需的权限码。

    同码重复登记是幂等的；同名不同码是冲突。声明的码必须存在于 auth-server
    的目录，取不到目录时 fail-closed 拒绝登记。

    Args: payload, container。
    """
    await container.registry.declare(
        topic=payload.topic,
        required_code=payload.required_code,
        publisher=payload.publisher,
    )
    return ok(payload)


@router.delete("/topics/{topic}", summary="注销主题")
async def revoke_topic(
    topic: str, container: ContainerDep
) -> ApiResponse[TopicRevokeOut]:
    """注销一个主题，订阅由外键级联跟着走。

    ⚠ 注销是 at-least-once，重复注销**不报错**：`existed` 为假即可，
    推送方据它对账。

    Args: topic, container。
    """
    existed = await container.registry.revoke(topic=topic)
    return ok(TopicRevokeOut(topic=topic, existed=existed))


@router.post("/publish", summary="推送")
async def publish(
    payload: PublishIn,
    container: ContainerDep,
    traceparent: Annotated[str | None, Header()] = None,
) -> ApiResponse[PublishOut]:
    """推一条消息，返回本次分配到的 seq。

    ⚠ `traceparent` 必须原样透传进扇出信封：pub/sub 是跨进程的异步交接，
    不传它链路就断在这一跳——推送方握着完整调用链，订阅方收到的消息与它
    对不上号。

    Args: payload, container, traceparent。
    """
    seq = await container.publisher.publish(
        topic=payload.topic, items=payload.items, traceparent=traceparent
    )
    return ok(PublishOut(topic=payload.topic, seq=seq))
