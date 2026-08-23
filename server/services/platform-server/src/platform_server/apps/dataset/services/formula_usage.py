"""引用反查：谁在用这条库公式。

⚠ 只能**重新解析**，不能 JOIN：台账列与库公式之间没有外键，联系是列公式原文
里的那段 `@标识(`。而判据取解析之后的 `used_fx` 而不是文本搜索，故 `@综合能耗`
里嵌着的 `@折标煤` 这类**间接**引用也算数——漏掉它，删一条被间接引用的公式就
会让引用方在运行期静默崩掉（docs/DATASET_DESIGN.md §5.11）。
"""

from dataclasses import replace

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.dataset.formula import (
    FormulaError,
    FormulaLibrary,
    parse_formula,
    sample_call,
)
from platform_server.apps.dataset.models import DatasetColumn, DatasetTable
from platform_server.apps.dataset.schemas import FormulaUsageOut
from platform_server.apps.dataset.services.formula_library import load_library

_logger = get_logger("platform.dataset.library")


async def find_usages(
    session: AsyncSession, code: str, library: FormulaLibrary | None = None
) -> list[FormulaUsageOut]:
    """哪些台账列在用这条公式（含被别的库公式间接带进来的）。

    Args: session, code, library（省略则现读一份快照）。
    """
    snapshot = await _snapshot(session, library)
    rows = await session.execute(
        select(DatasetColumn, DatasetTable)
        .join(DatasetTable, DatasetTable.id == DatasetColumn.table_id)
        .where(DatasetColumn.source == "formula")
        .order_by(DatasetTable.name.asc(), DatasetColumn.order_index.asc())
    )
    return [
        _usage_of(column, table, code)
        for column, table in rows.all()
        if _touches(column.formula, code, snapshot)
    ]


async def find_dependents(
    session: AsyncSession, code: str, library: FormulaLibrary | None = None
) -> list[str]:
    """库里还有哪些公式调用了这一条，直接或间接。

    ⚠ 少了这一问，「没人用就能删」会放行掉「`@综合能耗` 调用 `@折标煤`，只是
    还没有台账列用到 `@综合能耗`」这一路。
    Args: session, code, library。
    """
    snapshot = await _snapshot(session, library)
    found = [
        entry.code
        for entry in snapshot.entries.values()
        if entry.code != code and _touches(sample_call(entry), code, snapshot)
    ]
    return sorted(found)


async def _snapshot(
    session: AsyncSession, library: FormulaLibrary | None
) -> FormulaLibrary:
    """反查用的快照：所有条目一律**按启用算**。

    ⚠ 「谁引用了它」与「它现在开着没有」是两件事。照原样用的话，一条已停用的
    公式在解析引用方时就抛错、被当成「没人引用」，于是删除守卫会放行——而它
    正是不可逆的那一个（docs/DATASET_DESIGN.md §5.11）。
    Args: session, library。
    """
    snapshot = library if library is not None else await load_library(session)
    return FormulaLibrary.of(
        [replace(entry, is_enabled=True) for entry in snapshot.entries.values()]
    )


def _touches(source: str | None, code: str, library: FormulaLibrary) -> bool:
    """这条公式展开之后碰没碰到那条库公式。

    ⚠ 解析失败当作「没引用」并记一条日志：一条写坏的公式不该让反查整个失败，
    而反查失败会让删除守卫误判成「没人用」。
    Args: source, code, library。
    """
    if not source:
        return False
    try:
        return code in parse_formula(source, library=library).used_fx
    except FormulaError:
        _logger.info(
            "dataset_formula_usage_unparsed",
            "反查时有一条公式解析不通过，按未引用处理",
            code=code,
        )
        return False


def _usage_of(
    column: DatasetColumn, table: DatasetTable, code: str
) -> FormulaUsageOut:
    """一处引用的出参。

    ⚠ `is_direct` 判的是列公式里**有没有亲手写**这个调用：假表示它是被别的
    库公式带进来的，界面据此说清「改这一列救不了，得去改那条库公式」。
    Args: column, table, code。
    """
    return FormulaUsageOut(
        table_id=table.id,
        table_code=table.code,
        table_name=table.name,
        column_id=column.id,
        column_key=column.key,
        column_name=column.name,
        formula=column.formula or "",
        is_direct=f"@{code}(" in _squeezed(column.formula),
    )


def _squeezed(source: str | None) -> str:
    """去掉全部空白，好判断 `@标识 (` 这种写法。

    Args: source。
    """
    return "".join((source or "").split())
