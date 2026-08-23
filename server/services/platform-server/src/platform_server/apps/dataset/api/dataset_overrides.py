"""人工修正面。写、撤与按列批量撤销一律 `dataset:override`。

⚠ 与 `dataset:record:write` 分成两个码是按爆炸半径切的：修正值优先于点位聚合
值，等同于篡改台账（docs/DATASET_DESIGN.md §9）。
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import ApiResponse, ok
from platform_server.apps.dataset.deps import (
    get_override_writer,
    get_record_locator,
    get_session,
)
from platform_server.apps.dataset.schemas import (
    OverrideBulkClearIn,
    OverrideBulkClearOut,
    OverrideClearIn,
    OverrideWriteIn,
    OverrideWriteOut,
)
from platform_server.apps.dataset.services import (
    RecordLocator,
    RecordWriter,
    record_overrides,
)
from platform_server.settings import API_PREFIX

router = APIRouter(
    prefix=f"{API_PREFIX}/dataset-tables", tags=["dataset-override"]
)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
WriteDep = Annotated[RecordWriter, Depends(get_override_writer)]
LocatorDep = Annotated[RecordLocator, Depends(get_record_locator)]


@router.put(
    "/{table_id}/records/{row_id}/overrides",
    response_model=ApiResponse[OverrideWriteOut],
    summary="写人工修正",
)
async def put_overrides(
    payload: OverrideWriteIn,
    session: SessionDep,
    locator: LocatorDep,
    writer: WriteDep,
) -> ApiResponse[OverrideWriteOut]:
    """把一行里若干格改成人工判断的值；采集原值一个字都不动。

    ⚠ 某一格提交为空 = 撤销那一格的修正，回执的 `cleared` 会点名。
    Args: payload, session, locator, writer。
    """
    saved = await record_overrides.write_overrides(
        session, writer, locator=locator, payload=payload
    )
    return ok(saved, message=_written_message(saved))


@router.delete(
    "/{table_id}/records/{row_id}/overrides",
    response_model=ApiResponse[OverrideWriteOut],
    summary="撤销一行的人工修正",
)
async def delete_overrides(
    session: SessionDep,
    locator: LocatorDep,
    writer: WriteDep,
    payload: OverrideClearIn | None = None,
) -> ApiResponse[OverrideWriteOut]:
    """撤销修正，这些格回落到原值。请求体可以整个不传，等价于整行全撤。

    Args: session, locator, writer, payload。
    """
    saved = await record_overrides.clear_overrides(
        session, writer, locator=locator, payload=payload
    )
    return ok(saved, message=_cleared_message(len(saved.cleared)))


@router.post(
    "/{table_id}/overrides:clear",
    response_model=ApiResponse[OverrideBulkClearOut],
    summary="按列批量撤销人工修正",
)
async def clear_overrides(
    table_id: uuid.UUID,
    payload: OverrideBulkClearIn,
    session: SessionDep,
    writer: WriteDep,
) -> ApiResponse[OverrideBulkClearOut]:
    """把某几列在一段时间里的修正整体撤掉，并重算受影响的行。

    Args: table_id, payload, session, writer。
    """
    outcome = await record_overrides.clear_overrides_in_range(
        session, writer, table_id=table_id, payload=payload
    )
    return ok(outcome, message=_bulk_message(outcome))


def _written_message(saved: OverrideWriteOut) -> str:
    """回执文案：改了几格、撤了几格分开说。

    ⚠ 合成一句的话，用户撤掉一格却会看到「已修正 1 格」。
    Args: saved。
    """
    written = len(saved.record.overrides or {})
    text = f"已修正 {written} 格"
    if saved.cleared:
        text += f"，撤销 {len(saved.cleared)} 格"
    return text


def _cleared_message(count: int) -> str:
    """撤销回执的文案。

    Args: count。
    """
    return f"已撤销 {count} 格人工修正" if count else "该行没有人工修正"


def _bulk_message(outcome: OverrideBulkClearOut) -> str:
    """批量撤销回执的文案。触顶要说出来。

    Args: outcome。
    """
    text = (
        f"已撤销 {outcome.cleared_rows} 行、{outcome.cleared_cells} 格人工修正"
    )
    if outcome.recomputed:
        text += f"，重算 {outcome.recomputed} 行"
    if outcome.is_truncated:
        text += "；待撤销的行数触顶，请缩小时间范围后再撤一次"
    return text
