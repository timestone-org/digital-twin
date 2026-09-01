"""公式引擎：解析（纯）→ 取数（异步，调用方做）→ 求值（纯同步）。

三段切分是承重的：本包不碰数据库、不碰 ORM、不发起任何 IO，于是它的单元测试
一个 fixture 都不用。跨模块只从这个桶导入，不深链到内部文件。
"""

from platform_server.apps.dataset.formula.analysis import (
    AnalysisModel,
    AnalysisUnavailable,
)
from platform_server.apps.dataset.formula.catalog import (
    CATEGORIES,
    OPERATORS,
    RULES,
    WINDOW_UNITS,
    CatalogFunction,
    FormulaCatalog,
    build_catalog,
)
from platform_server.apps.dataset.formula.context import (
    HistoryCache,
    RowSnapshot,
    WholeStats,
    build_externals,
    empty_cache,
)
from platform_server.apps.dataset.formula.deps import (
    ColumnFormula,
    ComputePlan,
    build_plan,
    topo_order,
)
from platform_server.apps.dataset.formula.entry import (
    check_params,
    merged_library,
    sample_call,
    validate_entry,
)
from platform_server.apps.dataset.formula.errors import (
    ExternalsNotPrefetched,
    FormulaError,
)
from platform_server.apps.dataset.formula.evaluator import (
    EvalContext,
    ExternalKey,
    evaluate,
)
from platform_server.apps.dataset.formula.library import (
    EMPTY_LIBRARY,
    FX_PARAM_KINDS,
    PARAM_COLUMN,
    PARAM_VALUE,
    FormulaLibrary,
    FxEntry,
    FxParam,
)
from platform_server.apps.dataset.formula.notation import (
    ColumnLabel,
    NotationNode,
    TableLabels,
    to_notation,
    to_plain_text,
)
from platform_server.apps.dataset.formula.parser import parse_formula
from platform_server.apps.dataset.formula.refs import (
    ExternalRef,
    FormulaDeps,
    ParsedFormula,
    PrevRef,
    WholeRef,
    WindowRef,
)
from platform_server.apps.dataset.formula.signatures import (
    ALL_FUNCS,
    MAX_PREV_N,
    PREDICT_FUNC,
    PREV_FUNC,
    SCALAR_FUNCS,
    WINDOW_FUNCS,
)
from platform_server.apps.dataset.formula.windows import (
    MAX_WINDOW_YEARS,
    WindowSpec,
    parse_window,
    window_lower_bound,
)

__all__ = [
    "ALL_FUNCS",
    "CATEGORIES",
    "EMPTY_LIBRARY",
    "FX_PARAM_KINDS",
    "MAX_PREV_N",
    "MAX_WINDOW_YEARS",
    "OPERATORS",
    "PARAM_COLUMN",
    "PARAM_VALUE",
    "PREDICT_FUNC",
    "PREV_FUNC",
    "RULES",
    "SCALAR_FUNCS",
    "WINDOW_FUNCS",
    "WINDOW_UNITS",
    "AnalysisModel",
    "AnalysisUnavailable",
    "CatalogFunction",
    "ColumnFormula",
    "ColumnLabel",
    "ComputePlan",
    "EvalContext",
    "ExternalKey",
    "ExternalRef",
    "ExternalsNotPrefetched",
    "FormulaCatalog",
    "FormulaDeps",
    "FormulaError",
    "FormulaLibrary",
    "FxEntry",
    "FxParam",
    "HistoryCache",
    "NotationNode",
    "ParsedFormula",
    "PrevRef",
    "RowSnapshot",
    "TableLabels",
    "WholeRef",
    "WholeStats",
    "WindowRef",
    "WindowSpec",
    "build_catalog",
    "build_externals",
    "build_plan",
    "check_params",
    "empty_cache",
    "evaluate",
    "merged_library",
    "parse_formula",
    "parse_window",
    "sample_call",
    "to_notation",
    "to_plain_text",
    "topo_order",
    "validate_entry",
    "window_lower_bound",
]
