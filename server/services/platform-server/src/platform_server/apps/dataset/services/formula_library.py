"""公式库快照：把库表读成引擎认得的 `FormulaLibrary`。

⚠ **没有进程内缓存，这是刻意的**：改一条库公式必须**立刻**对每一处引用生效，
而缓存的失效要跨 worker 与副本传播。条目只有几十条，一次 `SELECT` 比一份会
悄悄过期的缓存划算。真正省掉的开销靠 `uses_library` 那道 `@` 闸——绝大多数
台账一条库公式都不用，那条路径上一次查询也不发（docs/DATASET_DESIGN.md §5.11）。
⚠ 取到的是**快照不是活查询**：一次重算可能横跨上万行、共用同一套定义，中途
换定义会让同一批数据按两套口径算出来，且没有任何症状。
"""

from collections.abc import Iterable, Sequence
from typing import Any, cast

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.dataset.builtin_formulas import BUILTIN_FORMULAS
from platform_server.apps.dataset.crud import formula_crud
from platform_server.apps.dataset.formula import (
    EMPTY_LIBRARY,
    PARAM_COLUMN,
    FormulaLibrary,
    FxEntry,
    FxParam,
)
from platform_server.apps.dataset.models import DatasetColumn, DatasetFormula

_logger = get_logger("platform.dataset.library")

# 库公式的调用前缀。列 key 与公式标识都禁掉了它，故文本里出现 `@` 就一定是
# 一处调用（或者一处写坏了的调用，那也要解析器去报）
FX_MARK = "@"


def entry_of(row: DatasetFormula) -> FxEntry:
    """一行库表 → 引擎用的纯条目。

    ⚠ 形参表里坏掉的那一项**跳过并记一条日志**，不让整批加载失败：一条形参写
    坏就加载不出公式库，等于每一张台账的每一个公式列一起算不出数。
    Args: row。
    """
    return FxEntry(
        code=row.code,
        name=row.name,
        expression=row.expression,
        params=tuple(_params_of(row)),
        category=row.category,
        description=row.description or "",
        is_enabled=row.is_enabled,
    )


def params_to_json(params: Iterable[FxParam]) -> list[dict[str, Any]]:
    """形参表 → 落库的 JSONB 形态。归一化之后再落，不存原始入参。

    Args: params。
    """
    return [
        {
            "name": param.name,
            "kind": param.kind,
            "label": param.label,
            "hint": param.hint,
            "default": param.default,
        }
        for param in params
    ]


async def load_library(session: AsyncSession) -> FormulaLibrary:
    """读一份库快照，**含停用的条目**。

    Args: session。
    """
    rows = await formula_crud.list_all(session)
    return FormulaLibrary.of([entry_of(row) for row in rows])


def uses_library(
    columns: Sequence[DatasetColumn], *, extra: str | None = None
) -> bool:
    """这张台账（或这条草稿）里有没有库公式调用。

    ⚠ 只做文本判断，安全性来自两条禁令：列 key 与公式标识都不许含 `@`，而
    一个裸 `@` 本来就是解析错误。⚠ 全仓**只有这一份实现**：复制一份到取数
    路径上，两份的判据迟早分叉，而分叉的表现是某条路径上公式静默展不开。
    Args: columns, extra（正在校验的那条公式原文）。
    """
    if extra is not None and FX_MARK in extra:
        return True
    return any(
        FX_MARK in (column.formula or "")
        for column in columns
        if column.source == "formula"
    )


async def library_for(
    session: AsyncSession,
    columns: Sequence[DatasetColumn],
    *,
    extra: str | None = None,
) -> FormulaLibrary:
    """按需取快照：没有 `@` 就连查询都不发。

    Args: session, columns, extra。
    """
    if not uses_library(columns, extra=extra):
        return EMPTY_LIBRARY
    return await load_library(session)


async def seed_builtin_formulas(session: AsyncSession) -> int:
    """把缺失的出厂预设补进库，返回新建了几条。

    ⚠ **只补缺，绝不覆盖**：一条被用户改过的预设不会在下次启动时被改回去，
    回到出厂口径是「恢复预设」那个显式动作，不是重启的副作用。也**不动
    `is_enabled`**——运维刻意停用的那条不会被翻回来（§5.11）。
    Args: session。
    """
    existing = {row.code for row in await formula_crud.list_all(session)}
    added = 0
    for entry in BUILTIN_FORMULAS:
        if entry.code in existing:
            continue
        formula_crud.add(session, _preset_row(entry))
        added += 1
    await session.flush()
    return added


def _preset_row(entry: FxEntry) -> DatasetFormula:
    """一条出厂预设的落库形态。

    Args: entry。
    """
    return DatasetFormula(
        code=entry.code,
        name=entry.name,
        category=entry.category,
        expression=entry.expression,
        params_json=params_to_json(entry.params),
        description=entry.description or None,
        is_builtin=True,
        is_enabled=True,
    )


def _params_of(row: DatasetFormula) -> list[FxParam]:
    """把落库的形参表读回来，坏掉的那一项跳过。

    Args: row。
    """
    found: list[FxParam] = []
    for item in row.params_json:
        param = _param_of(item)
        if param is None:
            _logger.warning(
                "dataset_formula_param_skipped",
                "库公式的形参表里有一项不合法，已跳过",
                code=row.code,
            )
            continue
        found.append(param)
    return found


def _param_of(item: Any) -> FxParam | None:
    """一项形参；形状不对给 None。

    Args: item。
    """
    if not isinstance(item, dict):
        return None
    raw = cast("dict[str, Any]", item)
    name = raw.get("name")
    if not isinstance(name, str) or not name:
        return None
    kind = raw.get("kind")
    return FxParam(
        name=name,
        kind=kind if isinstance(kind, str) else PARAM_COLUMN,
        label=_text(raw.get("label")),
        hint=_text(raw.get("hint")),
        default=raw.get("default"),
    )


def _text(value: Any) -> str:
    """可选的文本字段；不是字符串就当没写。

    Args: value。
    """
    return value if isinstance(value, str) else ""
