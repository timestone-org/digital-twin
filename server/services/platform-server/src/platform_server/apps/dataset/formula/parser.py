"""解析一条公式：两趟替换 → `ast.parse` → 展开库公式 → 白名单遍历 + 抽依赖。

公式**不执行**。第 3 步借的是 CPython 自己的表达式语法，第 5 步逐节点、逐运算符
过白名单，凡不在名单上的写法（下标、属性访问、lambda、推导式、f-string、`is`、
`in`、位运算、海象）一律拒绝（docs/DATASET_DESIGN.md §5.1）。
"""

import ast
from typing import Any

from platform_server.apps.dataset.formula.errors import FormulaError
from platform_server.apps.dataset.formula.library import (
    EMPTY_LIBRARY,
    FX_CODE_RE,
    FormulaLibrary,
)
from platform_server.apps.dataset.formula.macros import Expansion, expand_macros
from platform_server.apps.dataset.formula.refs import (
    ExternalRef,
    FormulaDeps,
    ModelRef,
    ParsedFormula,
    PrevRef,
    WholeRef,
    WindowRef,
)
from platform_server.apps.dataset.formula.signatures import (
    ALL_FUNCS,
    MAX_PREDICT_ARGS,
    MAX_PREV_N,
    PREDICT_FUNC,
    PREV_FUNC,
    SCALAR_FUNCS,
    WINDOW_FUNCS,
)
from platform_server.apps.dataset.formula.tokens import (
    split_external,
    to_expression,
)
from platform_server.apps.dataset.formula.windows import parse_window

_ALLOWED_NODES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.BoolOp,
    ast.Compare,
    ast.IfExp,
    ast.Call,
    ast.Constant,
    ast.Name,
    ast.Load,
)
_ALLOWED_OPS = (
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.FloorDiv,
    ast.Mod,
    ast.Pow,
    ast.USub,
    ast.UAdd,
    ast.Not,
    ast.And,
    ast.Or,
    ast.Eq,
    ast.NotEq,
    ast.Lt,
    ast.LtE,
    ast.Gt,
    ast.GtE,
)
_LITERAL_TYPES = (int, float, str, bool, type(None))
# `PREDICT` 至少要有模型标识 + 一个实参
_MIN_PREDICT_ARGS = 2
# 标量聚合 → 对应的整列聚合，用于把「MIN({列})」这类写法拦下来并指出该用哪个
_SCALAR_TO_ALL = {
    "MIN": "MIN_ALL",
    "MAX": "MAX_ALL",
    "SUM": "SUM_ALL",
    "AVG": "AVG_ALL",
}
# 同一个陷阱，但这几个没有整列变体，只能改口说「多给几个值」
_MULTI_VALUE_AGGS = ("MEDIAN", "STDEV", "VAR", "VARP")
# `IF(条件, 真值, 假值)` 的实参个数，也是 `IFS` 的下限（一档 + 兜底）
_IF_ARGS = 3
# `PREV({列}, n)` 与 `FN_OVER({列}, '窗口')` 写满时的实参个数
_TWO_ARGS = 2


def parse_formula(
    source: str,
    known_keys: set[str] | None = None,
    *,
    library: FormulaLibrary = EMPTY_LIBRARY,
) -> ParsedFormula:
    """解析并校验一条公式；任何不合法都抛 `FormulaError`。

    Args: source（表达式原文，列引用写作 `{列key}`）, known_keys（表内已知列
        集合，给了就校验引用的列存不存在）, library（公式库快照）。
    """
    if not source or not source.strip():
        raise FormulaError("公式不能为空")
    tree, placeholders, codes = to_expression(source)
    state = Expansion(library=library, placeholders=placeholders)
    deps = FormulaDeps()
    try:
        tree = expand_macros(tree, codes, state)
        _Walker(placeholders, deps).walk(tree)
    except RecursionError as error:
        raise FormulaError("公式嵌套过深，请拆成多列分步计算") from error
    if known_keys is not None:
        _require_known(deps, known_keys)
    return ParsedFormula(
        source=source,
        tree=tree,
        placeholders=placeholders,
        external_placeholders=_external_placeholders(placeholders),
        deps=deps,
        used_fx=frozenset(state.used),
    )


def call_name(node: ast.Call) -> str:
    """取调用的函数名（`parse_formula` 保证 `func` 是 `ast.Name`）。

    Args: node。
    """
    if not isinstance(node.func, ast.Name):  # pragma: no cover - 解析期已拦
        raise FormulaError("函数调用形态非法")
    return node.func.id


def name_ref(node: ast.expr) -> str:
    """取列引用实参的占位符名（`parse_formula` 保证是 `ast.Name`）。

    Args: node。
    """
    if not isinstance(node, ast.Name):  # pragma: no cover - 解析期已拦
        raise FormulaError("该位置必须是列引用，写作 {列key}")
    return node.id


def const_value(node: ast.expr) -> Any:
    """取字面量实参的值（`parse_formula` 保证是 `ast.Constant`）。

    Args: node。
    """
    if not isinstance(node, ast.Constant):  # pragma: no cover - 解析期已拦
        raise FormulaError("该位置必须是字面量")
    return node.value


def collect_arms(
    node: ast.expr, arms: list[tuple[ast.expr, ast.expr]]
) -> ast.expr:
    """摘出一层层分支，返回最末一档「否则」的节点。

    `IF` / `IFS` / 三元式一视同仁，嵌在**否则位**上的会被摊平成并列的几档。
    ⚠ 只摊否则位：`IF(a, IF(b,1,2), 3)` 摊成三档并列会把该算 2 的算成 3。
    ⚠ **不设档数上限。** 上限属于将来的分段编辑面，不属于这里：渲染要画的是
    真正参与计算的那个式子，在这里截断会画出一条与落库公式不一样的算式。而且
    截断时本函数原样退回入参节点，调用方继续递归就会在同一个节点上原地打转
    → `RecursionError` → 详情页永久 500（docs/DATASET_DESIGN.md §5.9）。
    Args: node, arms（就地累加，调用方传一个空 list）。
    """
    if isinstance(node, ast.IfExp):
        arms.append((node.test, node.body))
        return collect_arms(node.orelse, arms)
    if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
        return node
    name = node.func.id
    if name == "IF" and len(node.args) == _IF_ARGS:
        arms.append((node.args[0], node.args[1]))
        return collect_arms(node.args[2], arms)
    if name == "IFS" and len(node.args) >= _IF_ARGS and len(node.args) % 2:
        arms.extend(
            (node.args[index], node.args[index + 1])
            for index in range(0, len(node.args) - 1, 2)
        )
        return collect_arms(node.args[-1], arms)
    return node


class _Walker:
    """白名单遍历 + 依赖抽取。"""

    def __init__(self, placeholders: dict[str, str], deps: FormulaDeps) -> None:
        """绑定这一次遍历的占位表与要填的依赖集合。

        Args: placeholders, deps。
        """
        self._placeholders = placeholders
        self._deps = deps

    def walk(self, node: ast.AST) -> None:
        """深度遍历一个节点。

        Args: node。
        """
        if isinstance(node, ast.Call):
            self._call(node)
            return
        if not isinstance(node, _ALLOWED_NODES):
            raise FormulaError(f"公式不支持的写法：{type(node).__name__}")
        if isinstance(node, ast.Name):
            self._reference(node)
            return
        if isinstance(node, ast.Constant):
            if not isinstance(node.value, _LITERAL_TYPES):
                raise FormulaError(
                    "公式里只允许数字 / 字符串 / 布尔 / null 字面量"
                )
            return
        self._children(node)

    def _children(self, node: ast.AST) -> None:
        """校验挂在节点上的运算符，再递归子节点。

        Args: node。
        """
        for operator in _iter_ops(node):
            if not isinstance(operator, _ALLOWED_OPS):
                raise FormulaError(
                    f"公式不支持的运算符：{type(operator).__name__}"
                )
        for child in ast.iter_child_nodes(node):
            if isinstance(
                child, (ast.operator, ast.unaryop, ast.boolop, ast.cmpop)
            ):
                continue
            self.walk(child)

    def _reference(self, node: ast.Name) -> None:
        """一个占位标识符：进 same_row，或进 external。

        Args: node。
        """
        if node.id not in self._placeholders:
            raise FormulaError(
                f"未知标识符 '{node.id}'；列引用请写作 {{列key}}，"
                "函数名区分大小写"
            )
        ref = self._placeholders[node.id]
        external = split_external(ref)
        if external is None:
            self._deps.same_row.add(ref)
            return
        # ⚠ 跨表引用不进 same_row：它取的是另一张表的行，与本表的求值顺序、
        # 环检测都无关
        self._deps.external.add(
            ExternalRef(table_code=external[0], key=external[1])
        )

    def _call(self, node: ast.Call) -> None:
        """函数调用：校验函数名与元数，抽 prev / window / whole 依赖。

        Args: node。
        """
        if node.keywords:
            raise FormulaError("函数不支持关键字参数")
        if not isinstance(node.func, ast.Name):
            raise FormulaError("只能调用内置函数，不支持属性调用")
        name = node.func.id
        # ⚠ 按族查表而不是长 elif 链：加一族只加一行，链子长了会顶穿嵌套上限，
        # 而那时被迫做的拆分与「哪一族归谁管」这件事毫无关系
        if name == PREV_FUNC:
            self._prev(node)
            return
        if name == PREDICT_FUNC:
            self._predict(node)
            return
        if name in WINDOW_FUNCS:
            self._window(name, node)
            return
        if name in ALL_FUNCS:
            self._whole(name, node)
            return
        if name not in SCALAR_FUNCS:
            raise FormulaError(_unknown_function(name))
        self._scalar(name, node)

    def _prev(self, node: ast.Call) -> None:
        """`PREV({列})` / `PREV({列}, n)`。

        ⚠ 列实参**只收本表**：「上一条」要先确定站在对方表的哪一行上。
        Args: node。
        """
        if not 1 <= len(node.args) <= _TWO_ARGS:
            raise FormulaError("PREV 用法：PREV({列key}) 或 PREV({列key}, n)")
        key = self._column_ref_of(node.args[0], allow_external=False)
        steps = (
            _const_steps_of(node.args[1]) if len(node.args) == _TWO_ARGS else 1
        )
        if not 1 <= steps <= MAX_PREV_N:
            raise FormulaError(f"PREV 的 n 需在 1..{MAX_PREV_N}")
        self._deps.prev.add(PrevRef(key=key, steps=steps))

    def _predict(self, node: ast.Call) -> None:
        """`PREDICT('模型标识', 实参…)`。

        ⚠ 第一个实参必须是**字符串字面量**：模型标识要在解析期就拿得到，
        才建得出预取键。其余实参照常走白名单遍历——它们可以是任意表达式，
        含公式列，因为模型是在**行内**求值的。
        Args: node。
        """
        self._deps.model.add(ModelRef(code=_predict_code_of(node)))
        for argument in node.args[1:]:
            self.walk(argument)

    def _window(self, name: str, node: ast.Call) -> None:
        """`FN_OVER({列}, '窗口')`。

        Args: name, node。
        """
        if len(node.args) != _TWO_ARGS:
            raise FormulaError(f"{name} 用法：{name}({{列key}}, '1h')")
        key = self._column_ref_of(node.args[0], allow_external=True)
        spec = parse_window(_const_str_of(node.args[1]))
        self._deps.window.add(WindowRef(func=name, key=key, spec=spec))

    def _whole(self, name: str, node: ast.Call) -> None:
        """`FN_ALL({列})`。

        Args: name, node。
        """
        if len(node.args) != 1:
            raise FormulaError(f"{name} 用法：{name}({{列key}})")
        key = self._column_ref_of(node.args[0], allow_external=True)
        self._deps.whole.add(WholeRef(func=name, key=key))

    def _scalar(self, name: str, node: ast.Call) -> None:
        """标量函数：元数校验之后照常递归实参。

        ⚠ 实参在这里**照常递归**，而 PREV / *_OVER / *_ALL 的列实参被上面几个
        方法直接摘走、不递归——正是这一点让 `SUM_OVER({自己}, '1y')` 不会被判
        成自环（docs/DATASET_DESIGN.md §5.8）。
        Args: name, node。
        """
        self._reject_single_column(name, node)
        _check_arity(name, len(node.args))
        for arg in node.args:
            self.walk(arg)

    def _reject_single_column(self, name: str, node: ast.Call) -> None:
        """`MIN({列})` 这类写法当场报错，并指出该用哪个函数。

        ⚠ 放行的话，极差标准化写成 `({值}-MIN({值}))/(MAX({值})-MIN({值}))`
        会退化成 `0/0`——按「除零得空」整列算空且不报错，是最难查的一种失败
        （docs/DATASET_DESIGN.md §5.5）。
        Args: name, node。
        """
        if len(node.args) != 1 or not isinstance(node.args[0], ast.Name):
            return
        column = self._placeholders.get(node.args[0].id)
        if column is None:
            return
        if name in _SCALAR_TO_ALL:
            raise FormulaError(
                f"{name}({{{column}}}) 只有一个值，取最值没有意义。"
                f"要对整列聚合请用 {_SCALAR_TO_ALL[name]}({{{column}}})；"
                f"只要最近一段时间请用 {name}_OVER({{{column}}}, '30d')"
            )
        if name in _MULTI_VALUE_AGGS:
            raise FormulaError(
                f"{name}({{{column}}}) 只有一个值，统计量没有意义——"
                f"请把要一起统计的几列都列进来，"
                f"如 {name}({{{column}}}, {{另一列}}, ...)"
            )

    def _column_ref_of(self, node: ast.expr, *, allow_external: bool) -> str:
        """把「必须是列引用」的实参取成引用原文。

        Args: node, allow_external。
        """
        if isinstance(node, ast.Name) and node.id in self._placeholders:
            ref = self._placeholders[node.id]
            if not allow_external and split_external(ref) is not None:
                raise FormulaError(
                    f"{{{ref}}} 是跨表引用，不能放在 PREV 里——「上一条」要先"
                    "确定站在对方表的哪一行上。跨表列可以直接参与四则运算，"
                    "也可以放进时间窗 / 整列聚合"
                )
            return ref
        raise FormulaError("该位置必须是列引用，写作 {列key}")


def _iter_ops(node: ast.AST) -> list[ast.AST]:
    """取出挂在节点上的运算符。

    Args: node。
    """
    if isinstance(node, (ast.BinOp, ast.UnaryOp, ast.BoolOp)):
        return [node.op]
    if isinstance(node, ast.Compare):
        return list(node.ops)
    return []


def _check_arity(name: str, given: int) -> None:
    """标量函数的元数。

    ⚠ `IFS` 单列一条：元数表只有上下界，表达不了「必须成对再加一个兜底」。
    缺了兜底的 IFS 在所有条件都不成立时该给什么值没有答案。
    Args: name, given。
    """
    low, high = SCALAR_FUNCS[name]
    if given < low or (high is not None and given > high):
        expect = f"{low}" if high == low else f"{low}~{high or '不限'}"
        raise FormulaError(f"{name} 需要 {expect} 个参数，实际 {given} 个")
    if name == "IFS" and given % 2 == 0:
        raise FormulaError(
            "IFS 的参数个数必须是奇数：IFS(条件1, 值1, 条件2, 值2, …, 兜底值)"
            f"——实际 {given} 个，末尾缺一个兜底值"
        )


def _const_str_of(node: ast.expr) -> str:
    """把「必须是字符串字面量」的实参取出来。

    Args: node。
    """
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    raise FormulaError("时间窗必须是字符串字面量，如 '1h'")


def _const_steps_of(node: ast.expr) -> int:
    """把 `PREV` 的第 2 个实参取成正整数。

    ⚠ `bool` 明确排除：`PREV({x}, True)` 在 Python 里是 `PREV({x}, 1)`，
    而用户写的是一句根本没有意义的话。
    Args: node。
    """
    if (
        isinstance(node, ast.Constant)
        and isinstance(node.value, int)
        and not isinstance(node.value, bool)
    ):
        return node.value
    raise FormulaError("PREV 的第 2 个参数必须是正整数字面量")


def _predict_code_of(node: ast.Call) -> str:
    """`PREDICT` 的模型标识。必须是字符串字面量且形状合法。

    Args: node。
    """
    if not _MIN_PREDICT_ARGS <= len(node.args) <= MAX_PREDICT_ARGS:
        raise FormulaError(
            f"{PREDICT_FUNC} 用法：{PREDICT_FUNC}('模型标识', 实参…)，"
            f"最多 {MAX_PREDICT_ARGS - 1} 个实参"
        )
    code = _const_str_of(node.args[0])
    if not FX_CODE_RE.match(code):
        raise FormulaError("模型标识不合法")
    return code


def _unknown_function(name: str) -> str:
    """未知函数的报错文案，把可用的名字全列出来。

    Args: name。
    """
    return (
        f"未知函数 '{name}'。可用：{', '.join(sorted(SCALAR_FUNCS))}, "
        f"{PREV_FUNC}, {', '.join(WINDOW_FUNCS)}, {', '.join(ALL_FUNCS)}；"
        "库公式请写作 @公式标识(实参)"
    )


def _require_known(deps: FormulaDeps, known_keys: set[str]) -> None:
    """引用的本表列必须都存在。

    Args: deps, known_keys。
    """
    unknown = sorted(deps.referenced_keys - known_keys)
    if unknown:
        raise FormulaError(f"引用了不存在的列：{', '.join(unknown)}")


def _external_placeholders(
    placeholders: dict[str, str],
) -> dict[str, ExternalRef]:
    """占位表里跨表的那些，预先拆好供求值与渲染直接用。

    Args: placeholders。
    """
    found: dict[str, ExternalRef] = {}
    for name, ref in placeholders.items():
        external = split_external(ref)
        if external is not None:
            found[name] = ExternalRef(table_code=external[0], key=external[1])
    return found
