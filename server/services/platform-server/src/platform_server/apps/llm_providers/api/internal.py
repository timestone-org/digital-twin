"""内部端点：只在集群网内可达，边缘对 `/internal/` 一律 deny。

模型目录挂在这里而不是对外前缀下，因为它的调用方是助手与知识库这两个服务，
不是任何一个人，而且它带着明文密钥。认证用服务级密钥（逐字 `compare_digest`），
**未配置即拒绝**——fail-closed（api-contract §8）。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import ApiResponse, ok
from platform_server.apps.llm_providers.deps import (
    CredentialsDep,
    get_container,
    get_session,
    require_service_key,
)
from platform_server.apps.llm_providers.schemas import LlmCredentialTokenOut
from platform_server.apps.llm_providers.services import (
    CatalogOut,
    build_catalog,
)
from platform_server.container import Container
from platform_server.settings import INTERNAL_PREFIX

router = APIRouter(
    prefix=INTERNAL_PREFIX,
    tags=["internal"],
    dependencies=[Depends(require_service_key)],
    include_in_schema=False,
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContainerDep = Annotated[Container, Depends(get_container)]


@router.get(
    "/llm-catalog", response_model=ApiResponse[CatalogOut], summary="模型目录"
)
async def read_catalog(
    session: SessionDep, container: ContainerDep
) -> ApiResponse[CatalogOut]:
    """给两个消费方拉全量目录。带内容摘要版本号。

    ⚠ 只有全量、没有增量：消费方按 TTL 整份重拉，丢一条增量就永久错位。
    没配加密密钥时回空目录而不是 503——那时消费方该退回环境变量那一档。

    Args: session, container。
    """
    return ok(await build_catalog(session, cipher=container.llm.cipher))


@router.post(
    "/llm-credentials/{provider_id}:token",
    response_model=ApiResponse[LlmCredentialTokenOut],
    summary="领一份订阅账号的短时令牌",
)
async def lease_token(
    provider_id: uuid.UUID, credentials: CredentialsDep
) -> ApiResponse[LlmCredentialTokenOut]:
    """给消费方下发一份此刻能用的令牌；快过期就先换一份再回。

    ⚠ **续期只在这一侧做**（ADR-0041）：refresh_token 的属主只有平台一个。
    让消费方各自去刷的话，两边各拿一份新令牌，后写的那份把先写的顶掉——
    而被顶掉的那一份已经发出去用了，现象是「用着用着就掉登录」。

    ⚠ 还没登录过是 404、登录已失效是 409：两档的处置不同（去登录 / 重新登录），
    而两档都不是「等一会儿再试」。

    Args: provider_id, credentials。
    """
    leased = await credentials.lease(provider_id)
    return ok(LlmCredentialTokenOut.model_validate(leased))
