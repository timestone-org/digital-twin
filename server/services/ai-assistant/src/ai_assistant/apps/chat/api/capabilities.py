"""能力探测面：助手此刻能干什么。

⚠ 这条端点在模型不可达时也必须能答，且答的是「模型不可用」而不是 5xx：
前端要靠它决定摆不摆助手入口，一个 5xx 会被它读成「后端坏了」，
于是本该干净缺席的场合变成了一条红色告警。
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.chat.schemas.capability import (
    CapabilityOut,
    ModelProfileOut,
)
from ai_assistant.apps.chat.services import model_profiles, skill_catalog
from ai_assistant.container import Container
from ai_assistant.deps import get_container, require
from ai_assistant.llm.registry import ModelRegistry
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
    return ok(
        capability_of(
            container.models,
            await model_profiles.profiles_of(
                container.models, container.credentials
            ),
            container.settings.codex_reasoning_effort,
        )
    )


def capability_of(
    models: ModelRegistry,
    profiles: list[ModelProfileOut],
    default_effort: str,
) -> CapabilityOut:
    """把探测到的几路模型摊成出参。

    ⚠ 默认那一路要落在**此刻真能用**的档位上：订阅配了却没登录过时退回按量。
    只按配置挑的话，助手开箱就是一个点了报错的下拉，而报出来的错是
    「模型暂时不可用」，与「去登录一下」完全对不上。

    ⚠ 这里报的默认与建会话盖在行上的那一路**必须是同一份判定**（走
    `model_profiles.default_id_of`）：各算各的话，界面显示订阅账号而回合走
    按量计费，除了账单没有任何迹象。

    Args: models, profiles（各自此刻能不能用）, default_effort。
    """
    ready = [one.id for one in profiles if one.is_ready]
    return CapabilityOut(
        is_model_enabled=bool(ready),
        skills=skill_catalog(),
        models=profiles,
        default_model_id=model_profiles.default_id_of(models, profiles),
        default_effort=default_effort,
    )
