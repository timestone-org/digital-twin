"""AST → 记号树：把公式渲染成人读的数学式，供前端摆成 HTML 做校对。

除法摊成分式、聚合摊成带上下标的符号、分支收成一个大括号分段函数、列标识换成
列**名称**。放后端的理由：前端再解析一遍就是第二个解析器，两者对优先级的理解
迟早分叉，而分叉的表现是「读法显示的和实际算的不是一回事」，比不显示读法更糟
（docs/DATASET_DESIGN.md §5.9）。
"""

import ast
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from platform_server.apps.dataset.formula.errors import FormulaError
from platform_server.apps.dataset.formula.parser import (
    call_name,
    collect_arms,
    const_value,
    name_ref,
)
from platform_server.apps.dataset.formula.refs import ExternalRef, ParsedFormula
from platform_server.apps.dataset.formula.signatures import (
    ALL_FUNCS,
    PREV_FUNC,
    WINDOW_FUNCS,
)
from platform_server.apps.dataset.formula.tokens import split_external
from platform_server.apps.dataset.formula.windows import parse_window

# 一个记号节点。⚠ 它是要发给前端的 JSON，故是边界类型
NotationNode = dict[str, Any]

# 二元运算符 → 数学符号。除法不在此列：它被摊成分式
_BIN_SYMBOLS: dict[type[ast.operator], str] = {
    ast.Add: "+",
    ast.Sub: "−",
    ast.Mult: "×",
    ast.Mod: "mod",
    ast.FloorDiv: "÷",
}
_CMP_SYMBOLS: dict[type[ast.cmpop], str] = {
    ast.Eq: "=",
    ast.NotEq: "≠",
    ast.Lt: "<",
    ast.LtE: "≤",
    ast.Gt: ">",
    ast.GtE: "≥",
}
# 聚合函数 → 展示符号。Σ 只给求和，其余用小写词，生造符号反而难认
_AGG_SYMBOLS = {
    "SUM_OVER": "Σ",
    "AVG_OVER": "avg",
    "MIN_OVER": "min",
    "MAX_OVER": "max",
    "COUNT_OVER": "count",
    "FIRST_OVER": "first",
    "LAST_OVER": "last",
    "ALL_ZERO_OVER": "全为零",
    "SUM_ALL": "Σ",
    "AVG_ALL": "avg",
    "MIN_ALL": "min",
    "MAX_ALL": "max",
    "COUNT_ALL": "count",
}
# 标量函数 → 中文提示。⚠ `IF` / `IFS` / `SQRT` / `POW` 不在表里：它们有专门的
# 节点类型，不走 `fn`
_FN_LABELS = {
    "ABS": "绝对值",
    "ROUND": "四舍五入",
    "CEIL": "向上取整",
    "FLOOR": "向下取整",
    "TRUNC": "截断取整",
    "SIGN": "取符号",
    "MOD": "取余",
    "CLAMP": "夹在区间内",
    "HYPOT": "直角边求斜边",
    "LN": "自然对数",
    "LOG10": "常用对数",
    "LOG2": "二进制对数",
    "LOG": "对数",
    "EXP": "e 的幂",
    "SIN": "正弦",
    "COS": "余弦",
    "TAN": "正切",
    "ASIN": "反正弦",
    "ACOS": "反余弦",
    "ATAN": "反正切",
    "ATAN2": "两参反正切",
    "SINH": "双曲正弦",
    "COSH": "双曲余弦",
    "TANH": "双曲正切",
    "DEGREES": "弧度转角度",
    "RADIANS": "角度转弧度",
    "PI": "圆周率",
    "E": "自然常数",
    "MIN": "最小值",
    "MAX": "最大值",
    "SUM": "求和",
    "AVG": "平均",
    "MEDIAN": "中位数",
    "STDEV": "标准差",
    "VAR": "方差",
    "VARP": "总体方差",
    "COALESCE": "取第一个非空",
    "NOT": "取非",
    "ISBLANK": "是否为空",
    "AND": "且",
    "OR": "或",
}

# `PREV({列}, n)` 写了第二个实参时的实参个数
_PREV_WITH_STEPS = 2

# 运算优先级，决定要不要补括号（数越大越紧）。
# ⚠ 取非与取负**不同档**：`-x` 比加法紧，而 `not x` 比比较还松。合成一档的
# 表现是 `(not {a}) + 1` 画成「非 a + 1」——读起来成了 `not (a + 1)`，与真正
# 参与计算的式子不是一回事
_PREC_LOGIC = 1
_PREC_NOT = 2
_PREC_CMP = 3
_PREC_ADD = 4
_PREC_MUL = 5
_PREC_UNARY = 6
_PREC_POW = 7
# frac / sqrt / agg / fn / cases 自带视觉分组，不需要外层括号
_PREC_ATOM = 9


@dataclass(frozen=True)
class ColumnLabel:
    """渲染一列时要用的展示信息。"""

    name: str
    unit: str | None = None


@dataclass(frozen=True)
class TableLabels:
    """渲染跨表引用时要用的展示信息。"""

    name: str
    columns: Mapping[str, ColumnLabel] = field(
        default_factory=dict[str, ColumnLabel]
    )


def to_notation(
    parsed: ParsedFormula,
    columns: Mapping[str, ColumnLabel] | None = None,
    tables: Mapping[str, TableLabels] | None = None,
) -> NotationNode:
    """把已解析的公式翻成记号树。

    Args: parsed, columns（{列key: 展示信息}）, tables（{表code: 展示信息}）。
    """
    return _Builder(parsed, columns or {}, tables or {}).build()


class _Builder:
    """AST → 记号树。"""

    def __init__(
        self,
        parsed: ParsedFormula,
        columns: Mapping[str, ColumnLabel],
        tables: Mapping[str, TableLabels],
    ) -> None:
        """绑定这一次要渲染的公式与展示信息。

        Args: parsed, columns, tables。
        """
        self._parsed = parsed
        self._columns = columns
        self._tables = tables

    def build(self) -> NotationNode:
        """从表达式根节点开始渲染。"""
        return self.visit(self._parsed.tree.body)

    def visit(self, node: ast.expr) -> NotationNode:
        """渲染一个节点。

        Args: node。
        """
        if isinstance(node, ast.Constant):
            return _constant(node.value)
        if isinstance(node, ast.Name):
            return self._column(self._parsed.placeholders[node.id])
        if isinstance(node, ast.Call):
            return self._call(node)
        return self._operator(node)

    def _operator(self, node: ast.expr) -> NotationNode:
        """运算符节点。

        Args: node。
        """
        if isinstance(node, ast.BinOp):
            return self._binop(node)
        if isinstance(node, ast.UnaryOp):
            return self._unaryop(node)
        if isinstance(node, ast.BoolOp):
            return self._boolop(node)
        if isinstance(node, ast.Compare):
            return self._compare(node)
        if isinstance(node, ast.IfExp):
            return self._cases(node)
        raise FormulaError(f"无法渲染的表达式：{type(node).__name__}")

    def _column(self, key: str) -> NotationNode:
        """一列：本表画名称，跨表画「表名·列名」。

        Args: key。
        """
        external = split_external(key)
        if external is not None:
            return self._external(
                ExternalRef(table_code=external[0], key=external[1])
            )
        label = self._columns.get(key)
        return {
            # 有列名就用列名——公式要读起来像业务口径，而不是像代码
            "t": "col",
            "name": label.name if label is not None else key,
            "unit": label.unit if label is not None else None,
            "key": key,
        }

    def _external(self, ref: ExternalRef) -> NotationNode:
        """跨表引用画成「表名·列名」，让人一眼看出这不是本表的数。

        Args: ref。
        """
        table = self._tables.get(ref.table_code)
        label = table.columns.get(ref.key) if table is not None else None
        return {
            "t": "ext",
            "table": table.name if table is not None else ref.table_code,
            "table_code": ref.table_code,
            "name": label.name if label is not None else ref.key,
            "unit": label.unit if label is not None else None,
            "key": ref.key,
        }

    def _binop(self, node: ast.BinOp) -> NotationNode:
        """四则与幂。除法摊成分式，幂摊成上标。

        Args: node。
        """
        if isinstance(node.op, ast.Div):
            # 分子分母各自成块，天然分组，不用再补括号
            return {
                "t": "frac",
                "num": self.visit(node.left),
                "den": self.visit(node.right),
            }
        if isinstance(node.op, ast.Pow):
            return _power(
                _wrap(self.visit(node.left), _PREC_POW), self.visit(node.right)
            )
        symbol = _BIN_SYMBOLS.get(type(node.op))
        if symbol is None:  # pragma: no cover - 解析期白名单已拦
            raise FormulaError(f"无法渲染的运算符 {type(node.op).__name__}")
        prec = _PREC_ADD if symbol in ("+", "−") else _PREC_MUL
        # 右操作数在减法与取余下要更紧的优先级：a − (b − c) ≠ a − b − c
        tighter = prec + (1 if symbol in ("−", "mod") else 0)
        return {
            "t": "bin",
            "op": symbol,
            "l": _wrap(self.visit(node.left), prec),
            "r": _wrap(self.visit(node.right), tighter),
        }

    def _unaryop(self, node: ast.UnaryOp) -> NotationNode:
        """取负与取非；一元加号无意义，直接透传。

        Args: node。
        """
        if isinstance(node.op, ast.Not):
            return {"t": "not", "x": _wrap(self.visit(node.operand), _PREC_CMP)}
        inner = _wrap(self.visit(node.operand), _PREC_UNARY)
        if isinstance(node.op, ast.USub):
            return {"t": "neg", "x": inner}
        return inner

    def _boolop(self, node: ast.BoolOp) -> NotationNode:
        """`and` / `or` 画成「且」「或」。

        Args: node。
        """
        return {
            "t": "logic",
            "op": "且" if isinstance(node.op, ast.And) else "或",
            "args": [
                _wrap(self.visit(value), _PREC_NOT) for value in node.values
            ],
        }

    def _compare(self, node: ast.Compare) -> NotationNode:
        """链式比较摊成「且」，读起来更直观。

        Args: node。
        """
        links: list[NotationNode] = []
        left = node.left
        for operator, right in zip(node.ops, node.comparators, strict=True):
            symbol = _CMP_SYMBOLS.get(type(operator))
            if symbol is None:  # pragma: no cover - 解析期白名单已拦
                raise FormulaError(
                    f"无法渲染的比较符 {type(operator).__name__}"
                )
            links.append(
                {
                    "t": "cmp",
                    "op": symbol,
                    "l": _wrap(self.visit(left), _PREC_ADD),
                    "r": _wrap(self.visit(right), _PREC_ADD),
                }
            )
            left = right
        if len(links) == 1:
            return links[0]
        return {"t": "logic", "op": "且", "args": links}

    def _cases(self, node: ast.expr) -> NotationNode:
        """分支 → 大括号分段函数。嵌在「否则」位上的会被摊平成并列的几档。

        ⚠ **不设档数上限**：要画的是真正参与计算的那个式子，截断会画出一条与
        落库公式不一样的算式。摊不动时 `collect_arms` 原样退回入参，照常 visit
        下去会分派回本方法、在同一个节点上原地打转 → `RecursionError` → 详情页
        与校验端点一起 500，故在这里当场报错（docs/DATASET_DESIGN.md §5.9）。
        Args: node。
        """
        arms: list[tuple[ast.expr, ast.expr]] = []
        otherwise = collect_arms(node, arms)
        if not arms:
            raise FormulaError("分支公式摊不开，无法渲染成分段式")
        return {
            "t": "cases",
            # ⚠ 每一档也带 t 标签：「树上每个 dict 都是一个可分派的节点」这条
            # 不变量一破，任何按 t 递归的遍历都会在这个无标签的壳上撞出未知节点
            "arms": [
                {
                    "t": "arm",
                    "cond": self.visit(cond),
                    "then": self.visit(value),
                }
                for cond, value in arms
            ],
            "else": self.visit(otherwise),
        }

    def _call(self, node: ast.Call) -> NotationNode:
        """函数调用。四族各有各的画法。

        Args: node。
        """
        name = call_name(node)
        if name == PREV_FUNC:
            key = self._parsed.placeholders[name_ref(node.args[0])]
            steps = (
                const_value(node.args[1])
                if len(node.args) == _PREV_WITH_STEPS
                else 1
            )
            return {"t": "prev", "x": self._column(key), "n": int(steps)}
        if name in WINDOW_FUNCS or name in ALL_FUNCS:
            return self._aggregate(name, node)
        if name == "SQRT":
            return {"t": "sqrt", "x": self.visit(node.args[0])}
        if name == "POW":
            return _power(
                _wrap(self.visit(node.args[0]), _PREC_POW),
                self.visit(node.args[1]),
            )
        if name in ("IF", "IFS"):
            return self._cases(node)
        return {
            "t": "fn",
            "name": name,
            "label": _FN_LABELS.get(name, name),
            "args": [self.visit(arg) for arg in node.args],
        }

    def _aggregate(self, name: str, node: ast.Call) -> NotationNode:
        """时间窗与整列聚合。

        Args: name, node。
        """
        key = self._parsed.placeholders[name_ref(node.args[0])]
        is_window = name in WINDOW_FUNCS
        spec = (
            parse_window(str(const_value(node.args[1]))) if is_window else None
        )
        return {
            "t": "agg",
            "sym": _AGG_SYMBOLS[name],
            "label": f"近 {spec.label}" if spec is not None else "全表",
            # func / window 只给回写公式文本用，展示不需要
            "func": name,
            "window": spec.literal if spec is not None else None,
            "x": self._column(key),
        }


def _constant(value: object) -> NotationNode:
    """字面量。

    ⚠ 布尔与空值显示成中文，但**必须带上 raw**：没有它，回写时只能把「空」当
    普通字符串加引号写回，`None` 就成了字符串 `'空'`——而非空字符串恒为真，
    语义正好反过来，且不报任何错。
    Args: value。
    """
    if isinstance(value, bool):
        return {"t": "text", "v": "是" if value else "否", "raw": value}
    if value is None:
        return {"t": "text", "v": "空", "raw": None}
    if isinstance(value, str):
        return {"t": "text", "v": value}
    # 整数浮点去掉尾巴：3600.0 → 3600
    if isinstance(value, float) and value.is_integer():
        return {"t": "num", "v": str(int(value))}
    return {"t": "num", "v": str(value)}


def _power(base: NotationNode, exponent: NotationNode) -> NotationNode:
    """幂节点。中缀 `**` 与 `POW(x, y)` 画成同一个。

    Args: base, exponent。
    """
    return {"t": "pow", "base": base, "exp": exponent}


_NODE_PREC = {
    "logic": _PREC_LOGIC,
    "not": _PREC_NOT,
    "cmp": _PREC_CMP,
    "neg": _PREC_UNARY,
    "pow": _PREC_POW,
}


def _prec(node: NotationNode) -> int:
    """记号节点的优先级，用来判断子节点要不要加括号。

    Args: node。
    """
    kind = node.get("t")
    if kind == "bin":
        return _PREC_ADD if node["op"] in ("+", "−") else _PREC_MUL
    # frac / sqrt / agg / fn / cases 自带视觉分组，不需要外层括号
    return _NODE_PREC.get(str(kind), _PREC_ATOM)


def _wrap(node: NotationNode, min_prec: int) -> NotationNode:
    """优先级不够就补一层括号。

    Args: node, min_prec。
    """
    return node if _prec(node) >= min_prec else {"t": "paren", "x": node}


def to_plain_text(node: NotationNode) -> str:
    """记号树 → 一行纯文本，列表页、悬停提示与日志里用。

    ⚠ 认不出的节点渲染成 `?`，**绝不抛异常**：一个能识别的节点少了个子字段就
    会让递归撞上缺键，把整个弹窗打黑（docs/DATASET_DESIGN.md §5.9）。
    Args: node。
    """
    render = _PLAIN.get(str(node.get("t")))
    if render is None:
        return "?"
    try:
        return render(node)
    except (KeyError, TypeError, IndexError):
        return "?"


def _operand(node: NotationNode) -> str:
    """算式里的一个操作数。

    ⚠ **分段一律括起来**：二维渲染里大括号自带分组，摊成一行之后
    `IF({进水} > 1, 1, 0) + 3` 会念成「…否则 0 + 3」，`+3` 看着挂在兜底那一档
    上。`_prec` 表达不了这件事——同一棵树，二维里分段是原子，线性里不是。
    Args: node。
    """
    inner = to_plain_text(node)
    return f"({inner})" if node.get("t") == "cases" else inner


def _plain_cases(node: NotationNode) -> str:
    """分段函数摊成一行。

    Args: node。
    """
    arms = "，".join(to_plain_text(arm) for arm in node["arms"])
    return f"{arms}，否则 {_operand(node['else'])}"


def _plain_prev(node: NotationNode) -> str:
    """跨行引用。

    Args: node。
    """
    suffix = "" if node["n"] == 1 else f" 第{node['n']}条"
    return f"上一条的 {_operand(node['x'])}{suffix}"


_PLAIN: dict[str, Callable[[NotationNode], str]] = {
    "col": lambda node: str(node["name"]),
    "ext": lambda node: f"{node['table']}·{node['name']}",
    "num": lambda node: str(node["v"]),
    "text": lambda node: str(node["v"]),
    "paren": lambda node: f"({_operand(node['x'])})",
    "frac": lambda node: f"{_operand(node['num'])} ÷ {_operand(node['den'])}",
    "bin": lambda node: (
        f"{_operand(node['l'])} {node['op']} {_operand(node['r'])}"
    ),
    "cmp": lambda node: (
        f"{_operand(node['l'])} {node['op']} {_operand(node['r'])}"
    ),
    "logic": lambda node: f" {node['op']} ".join(
        _operand(arg) for arg in node["args"]
    ),
    "neg": lambda node: f"−{_operand(node['x'])}",
    "not": lambda node: f"非 {_operand(node['x'])}",
    "pow": lambda node: f"{_operand(node['base'])}^{_operand(node['exp'])}",
    "sqrt": lambda node: f"√({_operand(node['x'])})",
    "prev": _plain_prev,
    "agg": lambda node: (
        f"{node['label']}的 {node['sym']}({_operand(node['x'])})"
    ),
    "fn": lambda node: (
        f"{node['label']}({'，'.join(_operand(arg) for arg in node['args'])})"
    ),
    "arm": lambda node: (
        f"若 {_operand(node['cond'])} 则 {_operand(node['then'])}"
    ),
    "cases": _plain_cases,
}
