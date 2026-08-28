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
from ai_assistant.apps.chat.services import skill_catalog
from ai_assistant.container import Container
from ai_assistant.deps import get_container, require
from ai_assistant.llm import CODEX_PROFILE
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
            await _profiles_of(container),
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

    Args: models, profiles（各自此刻能不能用）, default_effort。
    """
    ready = [one.id for one in profiles if one.is_ready]
    return CapabilityOut(
        is_model_enabled=bool(ready),
        is_vision_enabled=any(
            one.is_ready and one.has_vision for one in profiles
        ),
        skills=skill_catalog(),
        models=profiles,
        default_model_id=models.default_id(ready_ids=ready),
        default_effort=default_effort,
    )


async def _profiles_of(container: Container) -> list[ModelProfileOut]:
    """这套部署接了哪几路，各自此刻能不能用。

    ⚠ 订阅账号那一路的「能不能用」要**去库里看有没有登录过**：只按配置回答的话，
    界面上会摆出一个点了就报错的选项，而报出来的错是「模型暂时不可用」。

    Args: container。
    """
    connected = await _codex_connected(container)
    return [
        ModelProfileOut(
            id=one.id,
            label=one.label,
            is_ready=connected if one.id == CODEX_PROFILE else one.is_ready,
            has_vision=one.has_vision,
            models=list(one.models),
            efforts=list(one.efforts),
        )
        for one in container.models.profiles()
    ]


async def _codex_connected(container: Container) -> bool:
    store = container.credentials
    if store is None:
        return False
    return (await store.status(CODEX_PROFILE)).is_connected
