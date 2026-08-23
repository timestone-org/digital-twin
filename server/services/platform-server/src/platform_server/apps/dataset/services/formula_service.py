"""公式面：函数目录、校验、试算。

⚠ 校验与试算都用 **200 + `is_ok=false`** 报公式错误，不是 HTTP 错误：编辑器里
「公式还没写完」是正常状态，不是异常（docs/DATASET_DESIGN.md §6.1）。
"""

import ast
import uuid
from collections.abc import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.crud import column_crud, table_crud
from platform_server.apps.dataset.formula import (
    CATEGORIES,
    OPERATORS,
    RULES,
    WINDOW_UNITS,
    ColumnLabel,
    EvalContext,
    ExternalKey,
    FormulaError,
    ParsedFormula,
    build_catalog,
    build_externals,
    empty_cache,
    evaluate,
    parse_formula,
    to_notation,
    to_plain_text,
)
from platform_server.apps.dataset.formula.values import is_blank
from platform_server.apps.dataset.models import DatasetColumn
from platform_server.apps.dataset.protocols import (
    as_column_source,
    as_column_type,
)
from platform_server.apps.dataset.schemas import (
    CatalogChoiceOut,
    CatalogFunctionOut,
    FormulaColumnOut,
    FormulaDepsOut,
    FormulaFunctionsOut,
    FormulaPreviewIn,
    FormulaPreviewOut,
    FormulaTableOut,
    FormulaValidateIn,
    FormulaValidateOut,
)
from platform_server.apps.dataset.services.formula_cycles import (
    check_no_cycle,
)
from platform_server.apps.dataset.services.formula_library import (
    library_for,
    load_library,
)
from platform_server.apps.dataset.services.table_service import require_table


async def get_functions(
    session: AsyncSession, *, table_id: uuid.UUID
) -> FormulaFunctionsOut:
    """函数目录 + 这张台账可引用的列与表 + 库公式。

    Args: session, table_id。
    """
    table = await require_table(session, table_id)
    columns = await column_crud.list_by_table(session, table.id)
    # ⚠ 这里读整份库而不是走 `library_for` 那道 `@` 闸：面板要列出**可插入**
    # 的库公式，而「这张表现在还没用过任何库公式」正是最需要列出来的那一刻
    catalog = build_catalog(await load_library(session))
    tables = await table_crud.list_all(session)
    return FormulaFunctionsOut(
        categories=[_choice(item) for item in CATEGORIES],
        functions=[
            CatalogFunctionOut(
                name=item.doc.name,
                category=item.doc.category,
                signature=item.doc.signature,
                description=item.doc.description,
                example=item.doc.example,
                args=list(item.doc.args),
                min_args=item.min_args,
                max_args=item.max_args,
            )
            for item in catalog.functions
        ],
        operators=[_choice(item) for item in OPERATORS],
        window_units=[_choice(item) for item in WINDOW_UNITS],
        rules=list(RULES),
        columns=[_column_out(column) for column in columns],
        tables=[
            FormulaTableOut(code=item.code, name=item.name)
            for item in tables
            if item.id != table.id
        ],
        library=list(catalog.library),
    )


async def validate_formula(
    session: AsyncSession, *, table_id: uuid.UUID, payload: FormulaValidateIn
) -> FormulaValidateOut:
    """校验一条公式：语法、未知列、未知台账、整表成环。

    Args: session, table_id, payload。
    """
    table = await require_table(session, table_id)
    columns = await column_crud.list_by_table(session, table.id)
    try:
        parsed = await _parse_against(session, columns, payload)
        check_no_cycle(columns, key=payload.column_key, deps=parsed.deps)
    except FormulaError as error:
        return FormulaValidateOut(is_ok=False, error=str(error))
    notation, notation_text = _render(parsed, columns)
    return FormulaValidateOut(
        is_ok=True,
        deps=FormulaDepsOut.model_validate(parsed.deps.to_json()),
        notation=notation,
        notation_text=notation_text,
    )


async def preview_formula(
    session: AsyncSession, *, table_id: uuid.UUID, payload: FormulaPreviewIn
) -> FormulaPreviewOut:
    """用一组样例值试算一条公式。

    ⚠ 本期**不取历史**：`PREV` / 时间窗 / 整列 / 跨表一律按空处理，并在
    `history_refs` 里如实列出来。空着不说等于让人以为那些引用真的算了
    （docs/DATASET_DESIGN.md §7.13）。
    Args: session, table_id, payload。
    """
    table = await require_table(session, table_id)
    columns = await column_crud.list_by_table(session, table.id)
    try:
        parsed = await _parse_against(session, columns, payload)
        externals = build_externals(parsed.deps, empty_cache(), None)
        value = evaluate(
            parsed,
            EvalContext(values=dict(payload.values), externals=externals),
        )
    except FormulaError as error:
        return FormulaPreviewOut(is_ok=False, error=str(error))
    missing = sorted(
        key for key in parsed.deps.same_row if is_blank(payload.values.get(key))
    )
    return FormulaPreviewOut(
        is_ok=True,
        value=value,
        missing=missing,
        should_suggest_sum=bool(
            value is None and missing and _is_pure_addition(parsed)
        ),
        history_refs=sorted(_describe(key) for key in externals),
    )


async def _parse_against(
    session: AsyncSession,
    columns: Sequence[DatasetColumn],
    payload: FormulaValidateIn | FormulaPreviewIn,
) -> ParsedFormula:
    """按这张台账的已知列与已知台账解析一条公式草稿。

    Args: session, columns, payload。
    """
    known_keys = {column.key for column in columns}
    if payload.column_key is not None:
        # 新建那一列时它还不在库里，但它的 key 已经定下来了
        known_keys.add(payload.column_key)
    parsed = parse_formula(
        payload.formula,
        known_keys,
        library=await library_for(session, columns, extra=payload.formula),
    )
    known_tables = await table_crud.all_codes(session)
    missing = sorted(parsed.deps.external_table_codes - known_tables)
    if missing:
        raise FormulaError(f"引用了不存在的台账：{'、'.join(missing)}")
    return parsed


def _render(
    parsed: ParsedFormula, columns: Sequence[DatasetColumn]
) -> tuple[dict[str, object] | None, str | None]:
    """渲染记号树与一行读法。

    ⚠ 这里**吞掉全部异常**是刻意的：渲染器上的一个 `RecursionError` 不该把
    校验端点打成 500，而校验端点只要读权限就能调
    （docs/DATASET_DESIGN.md §5.9）。
    Args: parsed, columns。
    """
    labels = {
        column.key: ColumnLabel(name=column.name, unit=column.unit)
        for column in columns
    }
    try:
        notation = to_notation(parsed, labels)
        return notation, to_plain_text(notation)
    except Exception:
        return None, None


def _choice(item: tuple[str, str]) -> CatalogChoiceOut:
    """目录里的一个可选项。

    Args: item。
    """
    return CatalogChoiceOut(value=item[0], label=item[1])


def _column_out(column: DatasetColumn) -> FormulaColumnOut:
    """公式里可引用的一列。

    Args: column。
    """
    return FormulaColumnOut(
        key=column.key,
        name=column.name,
        unit=column.unit,
        data_type=as_column_type(column.data_type),
        source=as_column_source(column.source),
    )


def _describe(key: ExternalKey) -> str:
    """把一个预取键还原成用户写得出来的样子。

    Args: key。
    """
    kind = key[0]
    if kind == "prev":
        tail = "" if key[2] == 1 else f", {key[2]}"
        return f"PREV({{{key[1]}}}{tail})"
    if kind == "win":
        return f"{key[1]}({{{key[2]}}}, '{key[3]}')"
    if kind == "all":
        return f"{key[1]}({{{key[2]}}})"
    return f"{{{key[1]}.{key[2]}}}"


def _is_pure_addition(parsed: ParsedFormula) -> bool:
    """这条公式是不是纯加法。

    只有纯加法才建议改用 `SUM(...)` 跳过缺失——减 / 乘 / 除那里，空才是正确
    答案，劝人换写法就是劝人把一个正确的空换成一个错的数。
    Args: parsed。
    """
    for node in ast.walk(parsed.tree):
        if isinstance(
            node, (ast.Call, ast.UnaryOp, ast.Compare, ast.BoolOp, ast.IfExp)
        ):
            return False
        if isinstance(node, ast.BinOp) and not isinstance(node.op, ast.Add):
            return False
    return True
