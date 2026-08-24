"""能力探测面：助手此刻能干什么。

⚠ 这条端点在模型不可达时也必须能答，且答的是「模型不可用」而不是 5xx：
前端要靠它决定摆不摆助手入口，一个 5xx 会被它读成「后端坏了」，
于是本该干净缺席的场合变成了一条红色告警。
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.chat.schemas.capability import CapabilityOut
from ai_assistant.apps.chat.services import skill_catalog
from ai_assistant.container import Container
from ai_assistant.deps import get_container, require
from ai_assistant.settings import API_PREFIX
from lib.auth import CallerContext
from lib.web import ApiResponse, ok

router = APIRouter(prefix=f"{API_PREFIX}/capabilities", tags=["capability"])

ContainerDep = Annotated[Container, Depends(get_container)]
UseDep = Annotated[CallerContext, Depends(require(ASSISTANT_USE))]


@router.get("", response_model=ApiResponse[CapabilityOut], summary="助手能力")
async def read_capabilities(
    container: ContainerDep, _caller: UseDep
) -> ApiResponse[CapabilityOut]:
    """模型是否可用，以及本部署装了哪些技能。

    Args: container, _caller。
    """
    settings = container.settings
    return ok(
        CapabilityOut(
            is_model_enabled=settings.model_enabled,
            is_vision_enabled=settings.model_enabled
            and bool(settings.model_vision),
            skills=skill_catalog(),
        )
    )
