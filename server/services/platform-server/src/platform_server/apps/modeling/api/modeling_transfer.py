"""流水线 JSON 导入预检、独立导入与已保存图导出。"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import ApiResponse, ok
from platform_server.apps.modeling.deps import (
    WriteGate,
    get_manage_context,
    get_pipeline_import_context,
    get_session,
)
from platform_server.apps.modeling.schemas.pipeline import PipelineOut
from platform_server.apps.modeling.schemas.transfer import (
    PipelineImportIn,
    PipelineImportInspection,
    PipelineTransferDocument,
)
from platform_server.apps.modeling.services import Actor, pipeline_transfer
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/modeling-pipelines", tags=["modeling-pipeline"]
)
SessionDep = Annotated[AsyncSession, Depends(get_session)]
ManageDep = Annotated[WriteGate, Depends(get_manage_context)]
ImportDep = Annotated[WriteGate, Depends(get_pipeline_import_context)]


@router.post(
    ":inspect-import",
    response_model=ApiResponse[PipelineImportInspection],
    summary="预检流水线 JSON",
)
async def inspect_import(
    payload: PipelineTransferDocument, session: SessionDep, _write: ManageDep
) -> ApiResponse[PipelineImportInspection]:
    """检查兼容性与目标环境引用，不写入；Args: payload, session, _write。"""
    return ok(await pipeline_transfer.inspect_import(session, payload))


@router.post(
    ":import",
    response_model=ApiResponse[PipelineOut],
    status_code=status.HTTP_201_CREATED,
    summary="导入独立流水线",
)
async def import_pipeline(
    payload: PipelineImportIn, session: SessionDep, write: ImportDep
) -> ApiResponse[PipelineOut]:
    """创建独立流水线，支持 Idempotency-Key；Args: payload, session, write。"""
    return ok(
        await write.run_once(
            endpoint="modeling.import_pipeline",
            model=PipelineOut,
            action=lambda: pipeline_transfer.import_pipeline(
                session,
                payload,
                Actor(
                    user_id=str(write.caller.user_id),
                    name=write.caller.username,
                ),
            ),
        )
    )


@router.post(
    "/{pipeline_id}:export",
    response_model=ApiResponse[PipelineTransferDocument],
    summary="导出已保存流水线 JSON",
)
async def export_pipeline(
    pipeline_id: uuid.UUID, session: SessionDep, _write: ManageDep
) -> ApiResponse[PipelineTransferDocument]:
    """只导出定义与算子版本。

    Args: pipeline_id, session, _write。
    """
    return ok(await pipeline_transfer.export_pipeline(session, pipeline_id))
