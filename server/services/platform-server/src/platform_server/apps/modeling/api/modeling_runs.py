"""运行面。读用 `modeling:view`，取消用 `modeling:run`。

⚠ 下载全量结果那一条是本模块**唯一不走统一信封**的端点：它交的是一个文件，
不是一个结果。它也是唯一要两个权限码的——那份 CSV 里是台账原始数据
（docs/MODELING_PLATFORM_DESIGN.md D12）。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.objectstore import ObjectStore
from lib.web import ApiResponse, CursorPage, Page, ok
from platform_server.apps.modeling.catalog import (
    DATASET_RECORD_EXPORT,
    MODELING_VIEW,
)
from platform_server.apps.modeling.deps import (
    WriteGate,
    get_instance_write_context,
    get_object_store,
    get_publish_context,
    get_run_publication_context,
    get_session,
    require,
)
from platform_server.apps.modeling.schemas import (
    ModelDeploymentOut,
    NodeRunOut,
    RunOut,
    RunSummaryOut,
)
from platform_server.apps.modeling.schemas.command import CommandResourceOut
from platform_server.apps.modeling.schemas.management import RunListQuery
from platform_server.apps.modeling.schemas.run import RunDeployIn
from platform_server.apps.modeling.services import (
    frame_export,
    management_queries,
    run_deletion,
    run_service,
    workflow_publication,
)
from platform_server.apps.modeling.services.command_gate import (
    DurableModelingGate,
)
from platform_server.apps.modeling.services.workflow_publication import (
    PublicationContext,
)
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/modeling-runs", tags=["modeling-run"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(MODELING_VIEW))]
WriteDep = Annotated[WriteGate, Depends(get_instance_write_context)]
PublishDep = Annotated[DurableModelingGate, Depends(get_publish_context)]
PublicationDep = Annotated[
    PublicationContext, Depends(get_run_publication_context)
]
StoreDep = Annotated[ObjectStore, Depends(get_object_store)]
# ⚠ 下载全量结果要**两个**码：那些 CSV 里是台账原始数据，能看不等于能带走
# （docs/MODELING_PLATFORM_DESIGN.md D12）
ExportDep = Annotated[
    CallerContext, Depends(require(MODELING_VIEW, DATASET_RECORD_EXPORT))
]


@router.get(
    "",
    response_model=ApiResponse[Page[RunSummaryOut] | CursorPage[RunSummaryOut]],
    summary="运行列表",
)
async def list_runs(
    session: SessionDep,
    _viewer: ViewDep,
    query: Annotated[RunListQuery, Query()],
) -> ApiResponse[Page[RunSummaryOut] | CursorPage[RunSummaryOut]]:
    return ok(await management_queries.list_runs(session, query))


@router.get(
    "/{run_id}",
    response_model=ApiResponse[RunOut],
    summary="运行详情",
)
async def get_run(
    run_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[RunOut]:
    """状态 + 节点清单 + 当时那份图。**不含结果摘要**，前端每秒轮询它。

    Args: run_id, session, _viewer。
    """
    return ok(await run_service.get_run(session, run_id))


@router.post(
    "/{run_id}:deploy",
    response_model=ApiResponse[ModelDeploymentOut],
    summary="发布本次训练模型",
)
async def deploy_run(
    run_id: uuid.UUID,
    payload: RunDeployIn,
    session: SessionDep,
    write: PublishDep,
    publication: PublicationDep,
) -> ApiResponse[ModelDeploymentOut]:
    command = workflow_publication.RunDeploymentCommand(
        session, run_id, payload, publication
    )
    return ok(
        await write.run_once(
            endpoint=f"modeling.deploy_run.{run_id}",
            model=ModelDeploymentOut,
            action=command.execute,
            prepare=command.prepare,
        )
    )


@router.delete("/{run_id}", status_code=204, summary="删除训练记录与未使用模型")
async def delete_run(
    run_id: uuid.UUID,
    session: SessionDep,
    write: PublishDep,
    store: StoreDep,
) -> Response:
    await write.run_once(
        endpoint=f"modeling.delete_run.{run_id}",
        model=CommandResourceOut,
        action=lambda: run_deletion.delete_run(session, run_id, store),
    )
    return Response(status_code=204)


@router.get(
    "/{run_id}/nodes/{node_id}",
    response_model=ApiResponse[NodeRunOut],
    summary="节点结果",
)
async def get_node_run(
    run_id: uuid.UUID,
    node_id: str,
    session: SessionDep,
    _viewer: ViewDep,
) -> ApiResponse[NodeRunOut]:
    """单个节点的中间结果，按节点懒加载。

    Args: run_id, node_id, session, _viewer。
    """
    return ok(
        await run_service.get_node_run(session, run_id=run_id, node_id=node_id)
    )


@router.post(
    "/{run_id}:cancel",
    response_model=ApiResponse[RunOut],
    summary="取消运行",
)
async def cancel_run(
    run_id: uuid.UUID, session: SessionDep, write: WriteDep
) -> ApiResponse[RunOut]:
    """请求取消。终态在下一个节点边界才落，中间态是 `cancelling`。

    Args: run_id, session, write。
    """
    return ok(
        await write.run_once(
            endpoint=f"modeling.cancel_run.{run_id}",
            model=RunOut,
            action=lambda: run_service.cancel_run(session, run_id),
        )
    )


@router.get(
    "/{run_id}/frames/{node_id}",
    summary="下载某个端口的全量结果",
    response_class=Response,
)
async def download_frame(
    run_id: uuid.UUID,
    node_id: str,
    session: SessionDep,
    store: StoreDep,
    _caller: ExportDep,
    port: str = "frame",
) -> Response:
    """把某个端口那份 CSV 交出去。理由与偏离见 `services/frame_export`。

    Args: run_id, node_id, session, store, _caller, port。
    """
    return _as_download(
        await frame_export.fetch(
            session,
            store,
            frame_export.Wanted(run_id=run_id, node_id=node_id, port=port),
        )
    )


def _as_download(found: frame_export.Download) -> Response:
    """把一份 CSV 摆成浏览器会当成下载的响应。

    Args: found。
    """
    return Response(
        content=found.payload,
        media_type=frame_export.CONTENT_TYPE,
        headers={
            "Content-Disposition": f'attachment; filename="{found.filename}"'
        },
    )
