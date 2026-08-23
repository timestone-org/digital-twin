"""公式库面。读用 `formula:view`，写用 `formula:manage`。

⚠ 与 `dataset-tables` **平级**而不是挂在它下面：一条库公式属于全库，不属于
某一张台账。挂成子资源就得先选一张表才能改一条影响全部表的东西
（docs/DATASET_DESIGN.md §6）。
⚠ 权限也与 `dataset:manage` 分家：改一条库公式会同时改掉所有引用它的台账列，
爆炸半径大一个量级（§9）。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.web import ApiResponse, ok
from platform_server.apps.dataset.catalog import FORMULA_VIEW
from platform_server.apps.dataset.deps import (
    WriteGate,
    get_formula_context,
    get_session,
    require,
)
from platform_server.apps.dataset.schemas import (
    FormulaCreateIn,
    FormulaDefOut,
    FormulaDefWithUsagesOut,
    FormulaUpdateIn,
    FormulaUsageOut,
)
from platform_server.apps.dataset.services import library_service
from platform_server.settings import API_PREFIX

router = APIRouter(prefix=f"{API_PREFIX}/formulas", tags=["dataset-library"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ViewDep = Annotated[CallerContext, Depends(require(FORMULA_VIEW))]
ManageDep = Annotated[WriteGate, Depends(get_formula_context)]


@router.get(
    "", response_model=ApiResponse[list[FormulaDefOut]], summary="公式库列表"
)
async def list_formulas(
    session: SessionDep,
    _viewer: ViewDep,
    q: str | None = None,
    category: str | None = None,
) -> ApiResponse[list[FormulaDefOut]]:
    """公式库列表。`q` 按标识与名称模糊搜。

    Args: session, _viewer, q, category。
    """
    return ok(
        await library_service.list_formulas(
            session, keyword=q, category=category
        )
    )


@router.post(
    "",
    response_model=ApiResponse[FormulaDefOut],
    status_code=status.HTTP_201_CREATED,
    summary="新建库公式",
)
async def create_formula(
    payload: FormulaCreateIn,
    session: SessionDep,
    response: Response,
    write: ManageDep,
) -> ApiResponse[FormulaDefOut]:
    """新建一条库公式。支持 `Idempotency-Key`。

    Args: payload, session, response, write。
    """
    created = await write.run_once(
        endpoint="create_dataset_formula",
        model=FormulaDefOut,
        action=lambda: library_service.create_formula(session, payload=payload),
    )
    response.headers["Location"] = f"{API_PREFIX}/formulas/{created.id}"
    return ok(created, message="库公式已创建")


@router.get(
    "/{formula_id}",
    response_model=ApiResponse[FormulaDefOut],
    summary="库公式详情",
)
async def read_formula(
    formula_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[FormulaDefOut]:
    """一条库公式的详情。

    Args: formula_id, session, _viewer。
    """
    return ok(await library_service.get_formula(session, formula_id))


@router.get(
    "/{formula_id}/usages",
    response_model=ApiResponse[list[FormulaUsageOut]],
    summary="库公式引用反查",
)
async def list_formula_usages(
    formula_id: uuid.UUID, session: SessionDep, _viewer: ViewDep
) -> ApiResponse[list[FormulaUsageOut]]:
    """哪些台账列在用这一条，含被别的库公式间接带进来的。

    Args: formula_id, session, _viewer。
    """
    return ok(await library_service.list_usages(session, formula_id))


@router.patch(
    "/{formula_id}",
    response_model=ApiResponse[FormulaDefWithUsagesOut],
    summary="更新库公式",
)
async def update_formula(
    formula_id: uuid.UUID,
    payload: FormulaUpdateIn,
    session: SessionDep,
    _write: ManageDep,
) -> ApiResponse[FormulaDefWithUsagesOut]:
    """改一条库公式。`code` 不可改，故不在入参里。

    Args: formula_id, payload, session, _write。
    """
    updated = await library_service.update_formula(
        session, formula_id=formula_id, payload=payload
    )
    message = library_service.updated_message(payload, updated)
    return ok(updated, message=message)


@router.post(
    "/{formula_id}:restore",
    response_model=ApiResponse[FormulaDefOut],
    summary="恢复预设口径",
)
async def restore_formula(
    formula_id: uuid.UUID, session: SessionDep, _write: ManageDep
) -> ApiResponse[FormulaDefOut]:
    """把改过的预设公式还原成出厂口径。⚠ 不动启用开关。

    Args: formula_id, session, _write。
    """
    restored = await library_service.restore_formula(
        session, formula_id=formula_id
    )
    return ok(restored, message="已恢复出厂口径，引用它的台账列需重算")


@router.delete(
    "/{formula_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除库公式",
)
async def delete_formula(
    formula_id: uuid.UUID, session: SessionDep, _write: ManageDep
) -> Response:
    """删一条库公式。预设删不得，还有人引用就 409。

    Args: formula_id, session, _write。
    """
    await library_service.delete_formula(session, formula_id=formula_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
