"""用途面：每个用途此刻走哪一路的哪个模型，以及改它、清它。

⚠ 用途清单是闭合的、由目录给出，界面不许自己造一个用途：造出来的那个没有
任何消费方会去读，表现是「分配了、一直没生效」。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.llm_providers.catalog import LLM_VIEW
from platform_server.apps.llm_providers.deps import (
    ManageDep,
    get_session,
    require,
)
from platform_server.apps.llm_providers.schemas import (
    LlmAssignmentIn,
    LlmPurposeOut,
)
from platform_server.apps.llm_providers.services import assignment_service
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/llm-purposes", tags=["llm-purpose"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(LLM_VIEW))]


@router.get(
    "", response_model=ApiResponse[list[LlmPurposeOut]], summary="用途清单"
)
async def list_all(
    session: SessionDep, _viewer: ViewDep
) -> ApiResponse[list[LlmPurposeOut]]:
    """全部用途，带各自此刻的分配。

    Args: session, _viewer。
    """
    return ok(await assignment_service.list_purposes(session))


@router.put(
    "/{purpose}",
    response_model=ApiResponse[LlmPurposeOut],
    summary="给一个用途指定模型",
)
async def assign(
    purpose: str,
    body: LlmAssignmentIn,
    session: SessionDep,
    write: ManageDep,
) -> ApiResponse[LlmPurposeOut]:
    """把一个用途指到一路供应商上的一个模型。幂等：重复 PUT 结果一致。

    Args: purpose, body, session, write。
    """
    made = await assignment_service.assign(
        session, purpose, body, actor=str(write.caller.user_id)
    )
    return ok(made, message="用途已更新")


@router.delete(
    "/{purpose}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="清掉一个用途的分配",
)
async def clear(
    purpose: str, session: SessionDep, write: ManageDep
) -> Response:
    """清掉之后那一侧退回自己环境变量配的那一档。本来就没分配也算成功。

    Args: purpose, session, write。
    """
    await assignment_service.clear(
        session, purpose, actor=str(write.caller.user_id)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
