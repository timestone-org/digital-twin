"""保存一列时的整表试编译：解析、连边、查环，产出要落库的依赖。

⚠ 保存一个公式列**必定编译整张表**，不是只编译这一列——环是整表的性质。
试编译要带齐全部相位输入（已知列集合、可引用的台账编码、公式库），漏任何一项
今天都表现为静默算空（docs/DATASET_DESIGN.md §5.8）。
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors.base import FieldError
from platform_server.apps.dataset.crud import table_crud
from platform_server.apps.dataset.errors import DatasetFormulaInvalid
from platform_server.apps.dataset.formula import (
    EMPTY_LIBRARY,
    ColumnFormula,
    ComputePlan,
    FormulaError,
    FormulaLibrary,
    build_plan,
)
from platform_server.apps.dataset.models import DatasetColumn


@dataclass(frozen=True)
class ColumnDraft:
    """正在保存的那一列。新建时它还不在库里，改动时它是新版本。"""

    key: str
    name: str
    source: str
    formula: str | None

    @property
    def is_formula(self) -> bool:
        """这一列算不算公式列。"""
        return self.source == "formula" and bool(self.formula)


async def compile_for_save(
    session: AsyncSession,
    *,
    columns: Sequence[DatasetColumn],
    draft: ColumnDraft,
) -> dict[str, Any] | None:
    """整表试编译，返回这一列要落库的 `formula_deps`；不是公式列则 None。

    编译不通过抛 `DatasetFormulaInvalid`——但只在**这一列**编不过时抛：别的列
    坏了是它们自己的事，各自记一条原因等着被修（见 `ComputePlan.failures`）。
    Args: session, columns（这张台账**现有**的全部列）, draft。
    """
    known_keys = {column.key for column in columns} | {draft.key}
    plan = _built(
        _entries(columns, draft),
        known_keys=known_keys,
        known_tables=await table_crud.all_codes(session),
        library=EMPTY_LIBRARY,
    )
    reason = plan.failures.get(draft.key)
    if reason is not None:
        raise _invalid(reason)
    if not draft.is_formula:
        return None
    return plan.parsed[draft.key].deps.to_json()


def _entries(
    columns: Sequence[DatasetColumn], draft: ColumnDraft
) -> list[ColumnFormula]:
    """把现有列与草稿合成一份待编译的公式清单。

    Args: columns, draft。
    """
    found: dict[str, ColumnFormula] = {}
    for column in columns:
        if column.source == "formula" and column.formula:
            found[column.key] = ColumnFormula(
                key=column.key, name=column.name, formula=column.formula
            )
    # 草稿顶替同 key 的旧版本；改成非公式列时把它从图里摘掉
    found.pop(draft.key, None)
    if draft.is_formula and draft.formula is not None:
        found[draft.key] = ColumnFormula(
            key=draft.key, name=draft.name, formula=draft.formula
        )
    return sorted(found.values(), key=lambda item: item.key)


def _built(
    entries: Sequence[ColumnFormula],
    *,
    known_keys: set[str],
    known_tables: frozenset[str],
    library: FormulaLibrary,
) -> ComputePlan:
    """跑一次 `build_plan`，把公式错误翻成 HTTP 层认得的那个异常。

    Args: entries, known_keys, known_tables, library。
    """
    try:
        return build_plan(
            entries,
            known_keys,
            known_tables=known_tables,
            library=library,
        )
    except FormulaError as error:
        raise _invalid(str(error)) from error


def _invalid(reason: str) -> DatasetFormulaInvalid:
    """把一条公式错误翻成 HTTP 层认得的那个异常，并标到公式输入框上。

    Args: reason。
    """
    return DatasetFormulaInvalid(
        reason,
        details=(FieldError(field="formula", code="invalid", message=reason),),
    )
