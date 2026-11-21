"""按库公式的具名调用追踪直接和间接引用。"""

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.dataset.formula import FormulaError, FormulaLibrary
from platform_server.apps.dataset.formula.tokens import substitute_macros
from platform_server.apps.dataset.models import DatasetColumn, DatasetTable
from platform_server.apps.dataset.schemas import FormulaUsageOut
from platform_server.apps.dataset.services.formula_library import load_library

_logger = get_logger("platform.dataset.library")


async def find_usages(
    session: AsyncSession, code: str, library: FormulaLibrary | None = None
) -> list[FormulaUsageOut]:
    """在实际列定义中反查谁调用了此公式或其调用方。

    Args: session, code, library。
    """
    snapshot = library if library is not None else await load_library(session)
    codes = {code, *dependent_codes(code, snapshot)}
    rows = await session.execute(
        select(DatasetColumn, DatasetTable)
        .join(DatasetTable, DatasetTable.id == DatasetColumn.table_id)
        .where(DatasetColumn.source == "formula")
        .order_by(
            DatasetTable.name,
            DatasetTable.code,
            DatasetColumn.order_index,
            DatasetColumn.key,
        )
    )
    found: list[FormulaUsageOut] = []
    for column, table in rows.tuples():
        calls = _calls(column.formula or "")
        if codes.intersection(calls):
            found.append(_usage_of(column, table, is_direct=code in calls))
    return found


def dependent_codes(code: str, library: FormulaLibrary) -> list[str]:
    """沿库公式的调用关系找出所有受影响的标识。

    Args: code, library。
    """
    callers: dict[str, set[str]] = defaultdict(set)
    for entry in library.entries.values():
        for called in _calls(entry.expression):
            callers[called].add(entry.code)
    seen = {code}
    pending = [code]
    while pending:
        unseen = callers[pending.pop()] - seen
        seen.update(unseen)
        pending.extend(unseen)
    return sorted(seen - {code})


def _calls(expression: str) -> set[str]:
    """按解析器的记号规则识别具名调用，保留旧签名已失配的引用。

    Args: expression。
    """
    try:
        _, names = substitute_macros(expression)
    except FormulaError:
        _logger.info("dataset_formula_usage_unparsed", "库公式调用标记不完整")
        return set()
    return set(names.values())


def _usage_of(
    column: DatasetColumn, table: DatasetTable, *, is_direct: bool
) -> FormulaUsageOut:
    """一处已保存的台账引用。

    Args: column, table, is_direct。
    """
    return FormulaUsageOut(
        table_id=table.id,
        table_code=table.code,
        table_name=table.name,
        column_id=column.id,
        column_key=column.key,
        column_name=column.name,
        formula=column.formula or "",
        is_direct=is_direct,
    )
