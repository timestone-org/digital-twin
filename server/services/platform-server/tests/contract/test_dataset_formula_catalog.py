"""三张名单必须一致：元数、实现、给前端的目录。

⚠ 三者漂移**不会自报家门**——目录多一个，面板里点一下报「未知函数」；白名单多
一个，求值期抛 KeyError；实现多一个，是一段看起来可用的死代码。三种症状看着都
像别处坏了，所以这条只能是红灯，不能是评审清单（docs/DATASET_DESIGN.md §5.3）。
"""

import re
from typing import get_args

import pytest

from platform_server.apps.dataset.formula import (
    ALL_FUNCS,
    CATEGORIES,
    EMPTY_LIBRARY,
    OPERATORS,
    PREDICT_FUNC,
    PREV_FUNC,
    RULES,
    SCALAR_FUNCS,
    WINDOW_FUNCS,
    WINDOW_UNITS,
    CatalogFunction,
    FormulaDeps,
    build_catalog,
    parse_formula,
    parse_window,
)
from platform_server.apps.dataset.formula.functions import (
    LAZY_IMPL,
    SCALAR_IMPL,
)
from platform_server.apps.dataset.formula.library import (
    FX_CODE_RE,
    FX_PARAM_KINDS,
)
from platform_server.apps.dataset.formula.notation import (
    _AGG_SYMBOLS,
    _FN_LABELS,
)
from platform_server.apps.dataset.formula.signatures import (
    FIXED_ARITY,
    all_function_names,
)
from platform_server.apps.dataset.formula.tokens import COLUMN_KEY_RE
from platform_server.apps.dataset.models import KEY_PATTERN
from platform_server.apps.dataset.schemas import (
    FormulaDepsOut,
    FormulaParamSpec,
)

CATALOG = build_catalog(EMPTY_LIBRARY)
CATALOG_NAMES = {item.doc.name for item in CATALOG.functions}
# 五族的总数。写死是为了让「加了函数没加目录」在这里红
BUILTIN_COUNT = 60
# 有专属节点类型、故不进 `_FN_LABELS` 的那几个
OWN_NOTATION_NODE = frozenset({"IF", "IFS", "SQRT", "POW"})
# 逐字符比对两份列 key 规则时用的探针
KEY_PROBES = "abz09中文_-+=/*|~!#$^&`? \t@{}[]().,:'\"" + "\\"


def test_the_two_implementation_tables_are_mutually_exclusive() -> None:
    # 两张表里都有的话，跑哪一份取决于分支顺序，而两份实现的差异无从诊断
    assert not set(SCALAR_IMPL) & set(LAZY_IMPL)


def test_the_implementations_cover_the_arity_table_exactly() -> None:
    assert set(SCALAR_IMPL) | set(LAZY_IMPL) == set(SCALAR_FUNCS)


def test_the_branch_family_is_exactly_the_lazy_one() -> None:
    # 分支函数必须惰性，否则没被选中的那一支照样求值
    assert set(LAZY_IMPL) == {"IF", "IFS", "AND", "OR"}


def test_the_catalog_lists_every_built_in_and_nothing_else() -> None:
    assert all_function_names() == CATALOG_NAMES


def test_the_six_families_do_not_overlap() -> None:
    families = [
        set(SCALAR_FUNCS),
        set(WINDOW_FUNCS),
        set(ALL_FUNCS),
        {PREV_FUNC},
        {PREDICT_FUNC},
    ]
    total = sum(len(family) for family in families)
    assert len(set().union(*families)) == total == BUILTIN_COUNT


def test_the_catalog_carries_one_entry_per_built_in() -> None:
    assert len(CATALOG.functions) == BUILTIN_COUNT


@pytest.mark.parametrize(
    "item", CATALOG.functions, ids=lambda item: item.doc.name
)
def test_the_arity_is_injected_rather_than_hand_written(
    item: CatalogFunction,
) -> None:
    # ⚠ 前端按 min_args 生成模板空位数，手抄错一个数的症状是「点一下函数就报
    # 元数不对」——在界面上几乎归因不到
    expected = SCALAR_FUNCS.get(item.doc.name) or FIXED_ARITY[item.doc.name]
    assert (item.min_args, item.max_args) == expected


def test_every_catalog_entry_lands_in_a_declared_category() -> None:
    declared = {key for key, _ in CATEGORIES}
    assert {item.doc.category for item in CATALOG.functions} <= declared


def test_every_catalog_entry_names_itself_in_its_signature() -> None:
    assert all(
        item.doc.signature.startswith(item.doc.name)
        for item in CATALOG.functions
    )


@pytest.mark.parametrize(
    "example",
    sorted({item.doc.example for item in CATALOG.functions}),
)
def test_every_example_in_the_panel_actually_parses(example: str) -> None:
    # 面板里的样例是可以直接插进编辑器的，插进去解析不了就是发出去的坏样例
    assert parse_formula(example).source == example


def test_every_advertised_window_literal_parses() -> None:
    assert all(parse_window(literal) for literal, _ in WINDOW_UNITS)


def test_the_panel_ships_the_operator_and_rule_reference() -> None:
    assert len(OPERATORS) >= 1
    assert len(RULES) >= 1


def test_the_library_list_is_empty_until_the_library_lands() -> None:
    # 公式库随第 4 期落地；空表是正常状态，不是错误
    assert CATALOG.library == ()


def test_the_notation_symbol_table_covers_every_aggregate() -> None:
    # 少一个的表现是渲染时 KeyError，把校验端点打成 500
    assert set(WINDOW_FUNCS) | set(ALL_FUNCS) <= set(_AGG_SYMBOLS)


def test_the_notation_label_table_covers_every_scalar_function() -> None:
    assert set(SCALAR_FUNCS) - OWN_NOTATION_NODE <= set(_FN_LABELS)


def test_the_notation_tables_carry_nothing_that_is_not_a_function() -> None:
    assert set(_FN_LABELS) <= set(SCALAR_FUNCS)
    assert set(_AGG_SYMBOLS) <= set(WINDOW_FUNCS) | set(ALL_FUNCS)


@pytest.mark.parametrize("char", list(KEY_PROBES))
def test_the_engine_and_the_table_agree_on_what_a_column_key_may_hold(
    char: str,
) -> None:
    # ⚠ 两份写法（引擎的正则与建表 CHECK 的正则）分叉的表现是：一列在配置界面
    # 上看起来完全正常，公式里却永远引用不到它
    engine = COLUMN_KEY_RE.match(f"a{char}b") is not None
    table = re.compile(KEY_PATTERN).match(f"a{char}b") is not None
    assert engine == table


def test_the_persisted_dependency_shape_matches_the_contract_shape() -> None:
    # ⚠ Pydantic 默认忽略多余键：这边加一个键而那边忘了加，落库形态与契约形态
    # 就此分叉，没有任何东西会报
    assert set(FormulaDeps().to_json()) == set(FormulaDepsOut.model_fields)


def test_the_dependency_blob_round_trips_through_the_contract_model() -> None:
    blob = parse_formula(
        "PREV({a}) + SUM_OVER({b}, '1h') + SUM_ALL({c}) + {src.d}"
    ).deps.to_json()
    assert FormulaDepsOut.model_validate(blob).model_dump() == blob


def test_the_parameter_kinds_the_api_offers_match_the_engine() -> None:
    # ⚠ 分叉的表现是「界面上能选、保存时被拒」：入参那一档 Literal 与引擎的
    # 名单是同一条契约的两份写法
    offered = get_args(FormulaParamSpec.model_fields["kind"].annotation)
    assert set(offered) == set(FX_PARAM_KINDS)


def test_the_library_call_prefix_is_banned_from_both_identifier_rules() -> None:
    # ⚠ `@` 必须两边都禁：`{a@b} + 1` 在宏替换之后剩一个裸 `@`，报的是
    # 「调用库公式要带括号」——指向一个用户根本没写过的东西
    assert FX_CODE_RE.match("a@b") is None
    assert COLUMN_KEY_RE.match("a@b") is None
