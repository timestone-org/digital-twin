"""公式库管理面。事务边界在这一层：crud 不提交，api 不写业务。

⚠ 这一面上有两道守卫，且**两道守的是同一件事**：停用与删除都会让引用它的
台账列在解析期失败，而保存任一列都会试编译整张表，于是那张表的录入、导入、
人工修正与重算一起 400。故两处都 409、都把受影响的台账名与后果说出来，且
都没有 `force` 出口（docs/DATASET_DESIGN.md §5.11）。
"""

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors.base import FieldError
from lib.logging import get_logger
from platform_server.apps.dataset.builtin_formulas import BUILTIN_FORMULAS
from platform_server.apps.dataset.crud import formula_crud
from platform_server.apps.dataset.errors import (
    DatasetFormulaCodeTaken,
    DatasetFormulaInUse,
    DatasetFormulaInvalid,
    DatasetFormulaNotFound,
    DatasetFormulaPresetRule,
)
from platform_server.apps.dataset.formula import (
    FormulaError,
    FormulaLibrary,
    FxEntry,
    FxParam,
    validate_entry,
)
from platform_server.apps.dataset.models import DatasetFormula
from platform_server.apps.dataset.schemas import (
    FormulaCreateIn,
    FormulaDefOut,
    FormulaDefWithUsagesOut,
    FormulaParamSpec,
    FormulaUpdateIn,
    FormulaUsageOut,
)
from platform_server.apps.dataset.services.changes import given_changes
from platform_server.apps.dataset.services.formula_library import (
    entry_of,
    load_library,
    params_to_json,
)
from platform_server.apps.dataset.services.formula_usage import (
    find_dependents,
    find_usages,
)

_logger = get_logger("platform.dataset.library")

# 409 文案里最多点名几张台账，其余折成省略号
MAX_NAMED_TABLES = 3


async def list_formulas(
    session: AsyncSession, *, keyword: str | None, category: str | None
) -> list[FormulaDefOut]:
    """公式库列表。集合只有几十条，故不分页。

    Args: session, keyword, category。
    """
    rows = await formula_crud.search(
        session, keyword=keyword, category=category
    )
    return [to_out(row) for row in rows]


async def get_formula(
    session: AsyncSession, formula_id: uuid.UUID
) -> FormulaDefOut:
    """一条公式的详情。

    Args: session, formula_id。
    """
    return to_out(await require_formula(session, formula_id))


async def list_usages(
    session: AsyncSession, formula_id: uuid.UUID
) -> list[FormulaUsageOut]:
    """哪些台账列在用这一条。

    Args: session, formula_id。
    """
    row = await require_formula(session, formula_id)
    return await find_usages(session, row.code)


async def create_formula(
    session: AsyncSession, *, payload: FormulaCreateIn
) -> FormulaDefOut:
    """新建一条库公式。标识撞了就 409，公式体校验不通过就 400。

    Args: session, payload。
    """
    if await formula_crud.get_by_code(session, payload.code) is not None:
        raise DatasetFormulaCodeTaken(f"公式标识已被占用：{payload.code}")
    entry = _entry_of_payload(payload)
    _validate(entry, await load_library(session))
    row = DatasetFormula(
        code=entry.code,
        name=entry.name,
        category=entry.category,
        expression=entry.expression,
        params_json=params_to_json(entry.params),
        description=payload.description,
        is_builtin=False,
        is_enabled=payload.is_enabled,
    )
    formula_crud.add(session, row)
    await session.flush()
    _logger.info(
        "dataset_formula_created", "库公式已创建", formula_id=str(row.id)
    )
    return to_out(row)


async def update_formula(
    session: AsyncSession, *, formula_id: uuid.UUID, payload: FormulaUpdateIn
) -> FormulaDefWithUsagesOut:
    """改一条库公式。缺省的字段不动，回执带引用面。

    ⚠ 改动**即刻**对全部引用方生效，而历史行要等重算才跟上。停用一条还在被
    引用的公式一律 409。
    Args: session, formula_id, payload。
    """
    row = await require_formula(session, formula_id)
    changes = given_changes(payload)
    entry = _merged_entry(row, changes)
    # ⚠ 校验与反查共用**同一份**快照：读两次的话，两道判断可能落在库的两个
    # 版本上，而它们要一起决定这次改动放不放行
    library = await load_library(session)
    _validate(entry, library)
    usages = await find_usages(session, row.code, library)
    _check_disable_allowed(row, entry, usages)
    _apply(row, entry, changes)
    await session.flush()
    _logger.info(
        "dataset_formula_updated",
        "库公式已更新",
        formula_id=str(row.id),
        usages=len(usages),
    )
    return FormulaDefWithUsagesOut(**_out_fields(row), usages=usages)


async def delete_formula(
    session: AsyncSession, *, formula_id: uuid.UUID
) -> None:
    """删一条库公式。预设删不得，还有人引用就 409。

    ⚠ **两侧都要查**：台账列在用它，以及库里别的公式在调它。故意不给 `force`
    ——绕过去的代价是那些引用方在运行期才崩，而配置这张表的人看不见。
    Args: session, formula_id。
    """
    row = await require_formula(session, formula_id)
    if row.is_builtin:
        raise DatasetFormulaPresetRule(
            "预设公式不能删除。不想用就停用它——删掉之后没有恢复入口"
        )
    library = await load_library(session)
    usages = await find_usages(session, row.code, library)
    dependents = await find_dependents(session, row.code, library)
    _check_unreferenced(usages, dependents)
    await session.delete(row)
    await session.flush()
    _logger.info(
        "dataset_formula_deleted", "库公式已删除", formula_id=str(row.id)
    )


async def restore_formula(
    session: AsyncSession, *, formula_id: uuid.UUID
) -> FormulaDefOut:
    """把改过的预设公式还原成出厂口径。

    ⚠ **不动 `is_enabled`**：恢复的是口径，不是开关。顺手把它翻回启用，等于
    悄悄重新打开一个运维刻意关掉的东西（docs/DATASET_DESIGN.md §5.11）。
    Args: session, formula_id。
    """
    row = await require_formula(session, formula_id)
    preset = builtin_of(row.code)
    if not row.is_builtin or preset is None:
        raise DatasetFormulaPresetRule("这不是预设公式，没有出厂口径可恢复")
    row.name = preset.name
    row.category = preset.category
    row.expression = preset.expression
    row.params_json = params_to_json(preset.params)
    row.description = preset.description or None
    await session.flush()
    _logger.info(
        "dataset_formula_restored", "预设公式已恢复", formula_id=str(row.id)
    )
    return to_out(row)


def updated_message(
    payload: FormulaUpdateIn, updated: FormulaDefWithUsagesOut
) -> str:
    """改完一条公式的回执文案。

    ⚠ 只有**口径**变了才提重算：改名与翻开关不会让任何历史行过期，那时提示
    「要重算」是一句假话，跑一遍全表重算是白付的代价。
    Args: payload, updated。
    """
    is_semantic = bool(payload.model_fields_set & {"expression", "params"})
    if not updated.usages or not is_semantic:
        return "库公式已更新"
    return (
        f"库公式已更新。{len(updated.usages)} 个台账列跟着它走"
        "——新口径要重算之后才落到历史行上"
    )


async def require_formula(
    session: AsyncSession, formula_id: uuid.UUID
) -> DatasetFormula:
    """取一条，取不到就 404。

    Args: session, formula_id。
    """
    row = await formula_crud.get(session, formula_id)
    if row is None:
        raise DatasetFormulaNotFound("公式不存在")
    return row


def builtin_of(code: str) -> FxEntry | None:
    """按标识找出厂预设；不是预设给 None。

    Args: code。
    """
    for entry in BUILTIN_FORMULAS:
        if entry.code == code:
            return entry
    return None


def to_out(row: DatasetFormula) -> FormulaDefOut:
    """一行 → 出参。

    Args: row。
    """
    return FormulaDefOut(**_out_fields(row))


def _out_fields(row: DatasetFormula) -> dict[str, Any]:
    """出参的字段表。带引用面的那份出参多一个键，其余逐字相同。

    ⚠ 不走 `model_dump()` 再拼：`Utc` 上挂着 `PlainSerializer`，dump 出来的是
    字符串，拼回去等于让时间在同一个进程里来回转换两次。
    Args: row。
    """
    entry = entry_of(row)
    return {
        "id": row.id,
        "code": row.code,
        "name": row.name,
        "category": row.category,
        "expression": row.expression,
        "params": [
            FormulaParamSpec.model_validate(item)
            for item in params_to_json(entry.params)
        ],
        "description": row.description,
        "is_builtin": row.is_builtin,
        "is_enabled": row.is_enabled,
        "signature": entry.signature(),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


def _validate(entry: FxEntry, library: FormulaLibrary) -> None:
    """拿库快照校验一条草稿：形参、体、嵌套与成环。

    Args: entry, library。
    """
    try:
        validate_entry(entry, library)
    except FormulaError as error:
        reason = str(error)
        raise DatasetFormulaInvalid(
            reason,
            details=(
                FieldError(field="expression", code="invalid", message=reason),
            ),
        ) from error


def _entry_of_payload(payload: FormulaCreateIn) -> FxEntry:
    """新建入参 → 纯条目。

    Args: payload。
    """
    return FxEntry(
        code=payload.code,
        name=payload.name,
        expression=payload.expression,
        params=tuple(_param_of(item) for item in payload.params),
        category=payload.category,
        description=payload.description or "",
        is_enabled=payload.is_enabled,
    )


def _merged_entry(row: DatasetFormula, changes: dict[str, Any]) -> FxEntry:
    """现有条目叠上本次变更，得到保存之后的样子。

    Args: row, changes。
    """
    current = entry_of(row)
    params = changes.get("params")
    return FxEntry(
        code=current.code,
        name=changes.get("name") or current.name,
        expression=changes.get("expression") or current.expression,
        params=(
            current.params
            if params is None
            else tuple(_param_of(item) for item in params)
        ),
        category=changes.get("category") or current.category,
        description=current.description,
        is_enabled=changes.get("is_enabled", current.is_enabled),
    )


def _param_of(item: FormulaParamSpec | dict[str, Any]) -> FxParam:
    """一项形参入参 → 纯形参。

    Args: item。
    """
    spec = (
        item
        if isinstance(item, FormulaParamSpec)
        else FormulaParamSpec.model_validate(item)
    )
    return FxParam(
        name=spec.name,
        kind=spec.kind,
        label=spec.label,
        hint=spec.hint,
        default=spec.default,
    )


def _apply(
    row: DatasetFormula, entry: FxEntry, changes: dict[str, Any]
) -> None:
    """把校验过的条目落到行上。

    Args: row, entry, changes。
    """
    row.name = entry.name
    row.category = entry.category
    row.expression = entry.expression
    row.params_json = params_to_json(entry.params)
    row.is_enabled = entry.is_enabled
    if "description" in changes:
        row.description = changes["description"]


def _check_disable_allowed(
    row: DatasetFormula, entry: FxEntry, usages: list[FormulaUsageOut]
) -> None:
    """停用一条还被引用着的公式：409。

    Args: row, entry, usages。
    """
    if entry.is_enabled or not row.is_enabled or not usages:
        return
    raise DatasetFormulaInUse(
        f"还有 {len(usages)} 个台账列在用这条公式（{_named(usages)}），"
        "停用会让这些表的数据录入、导入与重算一起报错。"
        "请先把它们改成别的算法"
    )


def _check_unreferenced(
    usages: list[FormulaUsageOut], dependents: list[str]
) -> None:
    """删除前的两侧检查。

    Args: usages, dependents。
    """
    parts: list[str] = []
    if usages:
        parts.append(f"{len(usages)} 个台账列在用它（{_named(usages)}）")
    if dependents:
        parts.append(f"库里的 {'、'.join(dependents)} 调用了它")
    if not parts:
        return
    raise DatasetFormulaInUse(
        f"删不了：{'；'.join(parts)}。请先把它们改成别的算法，或停用本公式"
    )


def _named(usages: list[FormulaUsageOut]) -> str:
    """受影响的台账名，去重排序后最多点名三张。

    Args: usages。
    """
    names = sorted({item.table_name for item in usages})
    head = "、".join(names[:MAX_NAMED_TABLES])
    return head if len(names) <= MAX_NAMED_TABLES else f"{head}…"
