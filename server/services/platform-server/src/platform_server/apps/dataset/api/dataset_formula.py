"""公式面。函数目录用 `dataset:view`，校验与试算用 `dataset:manage`。

⚠ 校验与试算是 POST，但它们**不写库**——`POST` 是动作端点的形状要求
（末段带 `:` 的路径全部方法必须是 POST），不是「有副作用」的标记。故它们只挂
权限判定，不走写上下文，也不收 `Idempotency-Key`：没有东西可重放。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.dataset.catalog import DATASET_MANAGE, DATASET_VIEW
from platform_server.apps.dataset.deps import get_session, require
from platform_server.apps.dataset.schemas import (
    FormulaFunctionsOut,
    FormulaPreviewIn,
    FormulaPreviewOut,
    FormulaValidateIn,
    FormulaValidateOut,
)
from platform_server.apps.dataset.services import formula_service
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/dataset-tables", tags=["dataset-formula"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(DATASET_VIEW))]
ManageDep = Annotated[CallerContext, Depends(require(DATASET_MANAGE))]


@router.get(
    "/{table_id}/formula-functions",
    response_model=ApiResponse[FormulaFunctionsOut],
    summary="公式函数目录",
)
async def list_formula_functions(
    table_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[FormulaFunctionsOut]:
    """函数目录 + 这张台账可引用的列与表 + 库公式。

    Args: table_id, session, _viewer。
    """
    return ok(await formula_service.get_functions(session, table_id=table_id))


@router.post(
    "/{table_id}/formula:validate",
    response_model=ApiResponse[FormulaValidateOut],
    summary="校验公式",
)
async def validate_formula(
    table_id: uuid.UUID,
    payload: FormulaValidateIn,
    session: SessionDep,
    _manager: ManageDep,
) -> ApiResponse[FormulaValidateOut]:
    """校验一条公式。⚠ 公式写错回 200 + `is_ok=false`，不是 HTTP 错误。

    Args: table_id, payload, session, _manager。
    """
    return ok(
        await formula_service.validate_formula(
            session, table_id=table_id, payload=payload
        )
    )


@router.post(
    "/{table_id}/formula:preview",
    response_model=ApiResponse[FormulaPreviewOut],
    summary="试算公式",
)
async def preview_formula(
    table_id: uuid.UUID,
    payload: FormulaPreviewIn,
    session: SessionDep,
    _manager: ManageDep,
) -> ApiResponse[FormulaPreviewOut]:
    """用一组样例值试算一条公式。

    Args: table_id, payload, session, _manager。
    """
    return ok(
        await formula_service.preview_formula(
            session, table_id=table_id, payload=payload
        )
    )
