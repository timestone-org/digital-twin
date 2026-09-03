"""能力探测面：这套知识库此刻能干什么。

⚠ 这条端点在嵌入档与对话档都没配时也必须能答，且答的是「没接」而不是 5xx：
前端要靠它决定摆不摆知识库入口，一个 5xx 会被它读成「后端坏了」，
于是本该干净缺席的场合变成了一条红色告警。
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from knowledge_server.apps.knowledge.schemas import CapabilityOut
from knowledge_server.apps.knowledge.services import ModelLanes, capability_of
from knowledge_server.apps.knowledge.services.assembly import (
    lanes_of,
    strategies,
)
from knowledge_server.catalog import KNOWLEDGE_USE
from knowledge_server.container import Container
from knowledge_server.deps import get_container, require
from knowledge_server.settings import API_PREFIX
from lib.auth import CallerContext
from lib.web import ApiResponse, ok

router = APIRouter(prefix=f"{API_PREFIX}/capabilities", tags=["capability"])

ContainerDep = Annotated[Container, Depends(get_container)]
UseDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_USE))]


@router.get("", response_model=ApiResponse[CapabilityOut], summary="知识库能力")
async def read_capabilities(
    container: ContainerDep, _caller: UseDep
) -> ApiResponse[CapabilityOut]:
    """嵌入档与对话档接没接，两路索引各自走在哪一档上。

    ⚠ 先让目录刷新：两路接没接读的是目录快照，不刷新的话界面上刚分配的
    模型这里报的还是「没接」。

    Args: container, _caller。
    """
    await container.catalog.refresh()
    return ok(_capability_of(container))


def _capability_of(container: Container) -> CapabilityOut:
    """按容器此刻的状态拼出能力面。

    Args: container。
    """
    lanes = strategies(lanes_of(container))
    return capability_of(
        container.settings,
        container.index,
        container.sources,
        lanes,
        ModelLanes(
            is_embedding_enabled=container.embedder.can_embed,
            is_model_enabled=container.answerer.can_answer,
            is_rerank_enabled=container.reranker.can_rerank,
            rerank_model=container.reranker.model or "",
        ),
    )
