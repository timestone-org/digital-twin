"""用待保存的库公式试编译已存在的调用者，并同步列的实际依赖。"""

from collections import defaultdict
from dataclasses import dataclass, field
from itertools import groupby
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors.base import FieldError
from platform_server.apps.dataset.crud import column_crud, table_crud
from platform_server.apps.dataset.errors import DatasetFormulaInUse
from platform_server.apps.dataset.formula import (
    ColumnFormula,
    ExternalRef,
    FormulaDeps,
    FormulaError,
    FormulaLibrary,
    FxEntry,
    build_plan,
    merged_library,
    parse_formula,
    validate_entry,
)
from platform_server.apps.dataset.models import DatasetColumn
from platform_server.apps.dataset.schemas import FormulaUsageOut


@dataclass
class _Changes:
    """本次编辑的编译问题与新引用。"""

    previous: FormulaLibrary
    proposed: FormulaLibrary
    issues: list[FieldError] = field(default_factory=list[FieldError])
    new_refs: list[tuple[FormulaUsageOut, set[ExternalRef]]] = field(
        default_factory=list[tuple[FormulaUsageOut, set[ExternalRef]]]
    )

    def record(self, usage: FormulaUsageOut, deps: FormulaDeps) -> None:
        """记下需要验证的新增外列，保留原有历史键语义。Args: usage, deps。"""
        sources = deps.external_columns
        if not sources:
            return
        try:
            old = parse_formula(usage.formula, library=self.previous)
        except FormulaError:
            pass
        else:
            sources.difference_update(old.deps.external_columns)
        if sources:
            self.new_refs.append((usage, sources))


async def check_consumers(
    session: AsyncSession,
    entry: FxEntry,
    library: FormulaLibrary,
    usages: list[FormulaUsageOut],
    dependents: list[str],
) -> None:
    """所有已保存的调用均通过后，才允许同一事务写新定义。

    Args: session, entry, library, usages, dependents。
    """
    checks = _Changes(library, merged_library(entry, library))
    for code in dependents:
        try:
            validate_entry(checks.proposed.entries[code], checks.proposed)
        except FormulaError as error:
            checks.issues.append(
                _issue(f"formulas[{code}]", f"库公式「{code}」", str(error))
            )
    if usages:
        await _check_columns(session, usages, checks)
    if checks.issues:
        raise DatasetFormulaInUse(
            f"此修改会使 {len(checks.issues)} 处已有引用失效。"
            f"{checks.issues[0].message}",
            details=tuple(checks.issues),
        )


async def _check_columns(
    session: AsyncSession,
    usages: list[FormulaUsageOut],
    checks: _Changes,
) -> None:
    """按台账一次编译，检查跨表引用及同表成环。

    Args: session, usages, checks。
    """
    by_table: dict[UUID, dict[UUID, FormulaUsageOut]] = defaultdict(dict)
    for usage in usages:
        by_table[usage.table_id][usage.column_id] = usage
    columns = await column_crud.list_by_tables(session, set(by_table))
    known_tables = await table_crud.all_codes(session)
    for table_id, grouped in groupby(columns, key=lambda col: col.table_id):
        _check_table(list(grouped), by_table[table_id], known_tables, checks)
    if checks.new_refs:
        codes = {ref.table_code for _, refs in checks.new_refs for ref in refs}
        known = await column_crud.keys_in_tables(session, codes)
        for usage, refs in checks.new_refs:
            missing = sorted(
                f"{ref.table_code}.{ref.key}"
                for ref in refs
                if (ref.table_code, ref.key) not in known
            )
            if missing:
                checks.issues.append(
                    _column_issue(
                        usage,
                        f"列「{usage.column_name}」引入了不存在的外部列：{'、'.join(missing)}",
                    )
                )


def _check_table(
    columns: list[DatasetColumn],
    usages: dict[UUID, FormulaUsageOut],
    known_tables: frozenset[str],
    checks: _Changes,
) -> None:
    """取各引用列在新定义下的编译结果。

    Args: columns, usages, known_tables, checks。
    """
    formulas = [
        ColumnFormula(key=column.key, name=column.name, formula=column.formula)
        for column in columns
        if column.source == "formula" and column.formula
    ]
    try:
        plan = build_plan(
            formulas,
            {column.key for column in columns},
            known_tables=known_tables,
            library=checks.proposed,
        )
    except FormulaError as error:
        checks.issues.extend(
            _column_issue(usage, f"列「{usage.column_name}」：{error}")
            for usage in usages.values()
        )
        return
    for column in columns:
        if usage := usages.get(column.id):
            if reason := plan.failures.get(column.key):
                checks.issues.append(_column_issue(usage, reason))
            else:
                deps = plan.parsed[column.key].deps
                checks.record(usage, deps)
                column.formula_deps = deps.to_json()


def _column_issue(usage: FormulaUsageOut, reason: str) -> FieldError:
    """定位实际调用列。Args: usage, reason。"""
    return _issue(
        f"columns[{usage.table_code}.{usage.column_key}]",
        f"台账「{usage.table_name}」",
        reason,
    )


def _issue(field: str, label: str, reason: str) -> FieldError:
    """保留位置与编译原因。Args: field, label, reason。"""
    return FieldError(
        field=field, code="formula_incompatible", message=f"{label}：{reason}"
    )
