"""内部端点：只在集群网内可达，边缘对 `/internal/` 一律 deny。

模型目录挂在这里而不是对外前缀下，因为它的调用方是助手与知识库这两个服务，
不是任何一个人，而且它带着明文密钥。认证用服务级密钥（逐字 `compare_digest`），
**未配置即拒绝**——fail-closed（api-contract §8）。
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import ApiResponse, ok
from platform_server.apps.llm_providers.deps import (
    get_container,
    get_session,
    require_service_key,
)
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
    return ok(await build_catalog(session, cipher=container.llm_cipher))
