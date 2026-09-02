"""形态面：这套部署接得了哪几种供应商，各自要配哪几格。

⚠ 由后端下发而不是前端写死：前端按它渲染表单，后端按同一份校验。两份漂开的
表现是「表单里填了、保存时 422」，而那句话指不回是哪一格多余。

只读，故只要 `llm:view`——它里面没有任何一路的取值，只有形态本身的说明。
"""

from typing import Annotated

from fastapi import APIRouter, Depends

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.llm_providers.catalog import LLM_VIEW
from platform_server.apps.llm_providers.deps import require
from platform_server.apps.llm_providers.schemas import LlmProviderKindOut
from platform_server.apps.llm_providers.services import kind_service
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/llm-provider-kinds", tags=["llm-provider"]
)

ViewDep = Annotated[CallerContext, Depends(require(LLM_VIEW))]


@router.get(
    "",
    response_model=ApiResponse[list[LlmProviderKindOut]],
    summary="供应商形态清单",
)
async def list_all(_viewer: ViewDep) -> ApiResponse[list[LlmProviderKindOut]]:
    """接得了哪几种供应商，按目录顺序。

    Args: _viewer。
    """
    return ok(kind_service.list_kinds())
