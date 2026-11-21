"""来源面：跑一次同步。

⚠ 来源挂在**顶层**而不是 `/knowledge-bases/{id}/sources/{id}:sync`：嵌套超过
两层之后这条动作端点就没地方放了（api-contract §1）。列来源仍然挂在库下面——
那是「一个库有哪些来源」，本来就是两层。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.schemas import SourceOut, SyncOut
from knowledge_server.apps.knowledge.schemas.source_patch import (
    SourceMetadataIn,
)
from knowledge_server.apps.knowledge.services import (
    source_management,
    sync_service,
)
from knowledge_server.apps.knowledge.services.sources import KnowledgeSource
from knowledge_server.catalog import KNOWLEDGE_MANAGE, KNOWLEDGE_WRITE
from knowledge_server.container import Container
from knowledge_server.deps import (
    get_container,
    get_session,
    get_sync_sessions,
    request_sources,
    require,
)
from knowledge_server.settings import API_PREFIX
from lib.auth import CallerContext
from lib.web import ApiResponse, ok

router = APIRouter(prefix=f"{API_PREFIX}/sources", tags=["source"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ManageDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_MANAGE))]
SessionsDep = Annotated[sync_service.Sessions, Depends(get_sync_sessions)]
ContainerDep = Annotated[Container, Depends(get_container)]
WriteDep = Annotated[CallerContext, Depends(require(KNOWLEDGE_WRITE))]
# ⚠ 按请求造：来源集里握着这一次要转发的签名身份头
SourcesDep = Annotated[tuple[KnowledgeSource, ...], Depends(request_sources)]


@router.patch(
    "/{source_id}",
    response_model=ApiResponse[SourceOut],
    summary="编辑平台来源",
)
async def edit(
    source_id: uuid.UUID,
    body: SourceMetadataIn,
    session: SessionDep,
    _manager: ManageDep,
) -> ApiResponse[SourceOut]:
    """修改名称及指定的配置字段。Args: source_id, body, session, _manager。"""
    return ok(await source_management.update(session, source_id, body))


@router.delete(
    "/{source_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="解绑平台来源",
)
async def detach(
    source_id: uuid.UUID, session: SessionDep, _manager: ManageDep
) -> None:
    """停止后续同步，保留已导入资料。

    Args: source_id, session, _manager。
    """
    await source_management.detach(session, source_id)


@router.post(
    "/{source_id}:sync",
    response_model=ApiResponse[SyncOut],
    summary="跑一次来源同步",
)
async def sync(
    sessions: SessionsDep,
    container: ContainerDep,
    _actor: WriteDep,
    source_id: uuid.UUID,
    sources: SourcesDep,
) -> ApiResponse[SyncOut]:
    """把这一路来源里的新条目摄进来。

    ⚠ **用调用者自己的身份**去打上游，不存任何凭据：存了的话，一次配置泄露
    等于把那个人的权限交出去，而无人值守的 worker 会拿着它不停地读。

    ⚠ 一次调用有页数上限；到顶就把游标存好并如实回 `has_more`。

    Args: sessions, container, _actor, source_id, sources。
    """
    deps = _deps(container, sources)
    made = await sync_service.sync_source(sessions, deps, source_id)
    return ok(sync_service.sync_out(made))


def _deps(
    container: Container, sources: tuple[KnowledgeSource, ...]
) -> sync_service.SyncDeps:
    """跑一次同步要的那几样。

    Args: container, sources。
    """
    return sync_service.SyncDeps(
        sources=sources,
        store=container.objectstore,
        stream=container.stream,
        group=container.ingest_group(),
    )
