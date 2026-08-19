"""内部端点：主题登记 / 注销 / 推送。边缘对 `/internal/` 一律 deny。

认证用服务级密钥而不是用户权限码——权限码挂在人身上，而这里要挡的是
「任何人」（ADR-0005）。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header

from lib.web import ApiResponse, ok
from realtime_hub.apps.channel.deps import get_container, require_service_key
from realtime_hub.apps.channel.schemas import (
    PublicGrantDeclareIn,
    PublicGrantListOut,
    PublicGrantRevokeOut,
    PublishIn,
    PublishOut,
    TopicDeclareIn,
    TopicListOut,
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


@router.get("/topics", summary="列出某个推送方的主题")
async def list_topics(
    publisher: str, container: ContainerDep
) -> ApiResponse[TopicListOut]:
    """给推送方对账用：它那边的实体表是权威，这里只是投影。

    ⚠ 不给分页：主题数与推送方的实体数同量级（一个 OPC UA 实例一个主题），
    而对账要的就是全集——分页会让调用方写一段翻页循环，翻到一半实体又变了。

    Args: publisher, container。
    """
    topics = await container.registry.topics_of(publisher)
    return ok(TopicListOut(publisher=publisher, topics=topics))


@router.post("/public-grants", summary="登记匿名授权")
async def declare_public_grant(
    payload: PublicGrantDeclareIn, container: ContainerDep
) -> ApiResponse[PublicGrantDeclareIn]:
    """登记「一枚票据的指纹 → 一个主题」的匿名订阅授权。

    重复登记是幂等的。主题必须已经登记过——授权指向一个不存在的主题时，握手
    会过、订阅会成功、而数据永远不来。

    ⚠ 收的是指纹不是票据：票据是可直接使用的凭据，本服务不持有它。

    Args: payload, container。
    """
    await container.grants.declare(
        ticket_hash=payload.ticket_hash,
        topic=payload.topic,
        publisher=payload.publisher,
    )
    return ok(payload)


@router.get("/public-grants", summary="列出某个推送方的匿名授权")
async def list_public_grants(
    publisher: str, container: ContainerDep
) -> ApiResponse[PublicGrantListOut]:
    """给推送方对账用：它那边的发布态是权威，这里只是投影。

    Args: publisher, container。
    """
    hashes = await container.grants.hashes_of(publisher)
    return ok(PublicGrantListOut(publisher=publisher, ticket_hashes=hashes))


@router.delete("/public-grants/{ticket_hash}", summary="注销匿名授权")
async def revoke_public_grant(
    ticket_hash: str, container: ContainerDep
) -> ApiResponse[PublicGrantRevokeOut]:
    """注销一枚票据的授权。

    ⚠ 注销只让**新的**握手订不上，已经连着的那些由本服务的复核任务摘掉——
    少了那一半，「撤回」只对还没连上的人成立。

    Args: ticket_hash, container。
    """
    removed = await container.grants.revoke(ticket_hash=ticket_hash)
    return ok(PublicGrantRevokeOut(ticket_hash=ticket_hash, is_removed=removed))


@router.delete("/topics/{topic}", summary="注销主题")
async def revoke_topic(
    topic: str, container: ContainerDep
) -> ApiResponse[TopicRevokeOut]:
    """注销一个主题，订阅由外键级联跟着走。

    ⚠ 注销是 at-least-once，重复注销**不报错**：`is_removed` 为假即可，
    推送方据它对账。

    Args: topic, container。
    """
    removed = await container.registry.revoke(topic=topic)
    return ok(TopicRevokeOut(topic=topic, is_removed=removed))


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
