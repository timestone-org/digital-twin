"""求值：纯同步递归下降，不碰数据库、不发起任何 IO。

取数（异步）与求值（同步）分成两段，跨行 / 窗口 / 整列 / 跨表四类值由调用方
**预先取好**放进 `externals`。于是整个公式子系统的单元测试一个 fixture 都不用
（docs/DATASET_DESIGN.md §5.6）。
"""

import ast
from collections.abc import Callable
from dataclasses import dataclass, field

from platform_server.apps.dataset.formula.analysis import (
    AnalysisModel,
    AnalysisUnavailable,
)
from platform_server.apps.dataset.formula.errors import (
    ExternalsNotPrefetched,
    FormulaError,
)
from platform_server.apps.dataset.formula.functions import (
    LAZY_IMPL,
    SCALAR_IMPL,
    kleene,
)
from platform_server.apps.dataset.formula.parser import (
    call_name,
    const_value,
    name_ref,
)
from platform_server.apps.dataset.formula.refs import ParsedFormula
from platform_server.apps.dataset.formula.signatures import (
    ALL_FUNCS,
    PREDICT_FUNC,
    PREV_FUNC,
    WINDOW_FUNCS,
)
from platform_server.apps.dataset.formula.values import (
    finite,
    finite_constant,
    to_number,
    truthy,
)
from platform_server.apps.dataset.formula.windows import parse_window

# 预取值的键，四种形状：
# `("prev", 列key, 期数)` / `("win", 函数名, 列key, 窗口规范写法)`
# `("all", 函数名, 列key)` / `("ext", 表code, 列key)`
# ⚠ `win` / `all` 的列key 保留 `表code.` 前缀，跨表与本表因此不会撞键
ExternalKey = tuple[str | int, ...]

# `PREV({列}, n)` 写了第二个实参时的实参个数
_PREV_WITH_STEPS = 2


def _safe_pow(left: float, right: float) -> float | None:
    """幂运算，溢出与定义域外收成空。

    Args: left, right。
    """
    try:
        return finite(pow(left, right))
    except (OverflowError, ValueError, ZeroDivisionError):
        return None


_BINOP: dict[type[ast.operator], Callable[[float, float], float | None]] = {
    ast.Add: lambda left, right: left + right,
    ast.Sub: lambda left, right: left - right,
    ast.Mult: lambda left, right: left * right,
    # 除零得空，不抛异常（docs/DATASET_DESIGN.md §5.4 第 2 条）
    ast.Div: lambda left, right: None if right == 0 else left / right,
    ast.FloorDiv: lambda left, right: None if right == 0 else left // right,
    # ⚠ 与 `MOD()` 同一个口径：结果随除数符号（`-1 % 3 == 2`）
    ast.Mod: lambda left, right: None if right == 0 else left % right,
    ast.Pow: _safe_pow,
}


@dataclass
class EvalContext:
    """一次求值的全部输入。"""

    #: 当前行的值：原始录入值 ∪ 本行已算出的公式列（拓扑序保证先算的可见）
    values: dict[str, object] = field(default_factory=dict[str, object])
    #: 预取好的跨行 / 窗口 / 整列 / 跨表值
    externals: dict[ExternalKey, object] = field(
        default_factory=dict[ExternalKey, object]
    )


def evaluate(parsed: ParsedFormula, context: EvalContext) -> object:
    """求值一条已解析的公式。

    类型不匹配这类真错误抛 `FormulaError`；空值与除零不在此列，返回 `None`。
    Args: parsed, context。
    """
    return _Evaluator(parsed, context).run()


class _Evaluator:
    """一次求值的执行体。"""

    def __init__(self, parsed: ParsedFormula, context: EvalContext) -> None:
        """绑定这一次要算的公式与取值上下文。

        Args: parsed, context。
        """
        self._parsed = parsed
        self._context = context

    def run(self) -> object:
        """从表达式根节点开始算。"""
        return self.visit(self._parsed.tree.body)

    def visit(self, node: ast.expr) -> object:
        """算一个节点。

        Args: node。
        """
        if isinstance(node, ast.Constant):
            return finite_constant(node.value)
        if isinstance(node, ast.Name):
            return self._reference(node)
        if isinstance(node, ast.Call):
            return self._call(node)
        return self._operator(node)

    def _operator(self, node: ast.expr) -> object:
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
            return self._ifexp(node)
        # 解析期已白名单校验过，走到这里说明两边不同步了
        raise FormulaError(f"无法求值的表达式：{type(node).__name__}")

    def _external(self, key: ExternalKey) -> object:
        """取一个预取好的外部值。

        ⚠ 「键不在场」与「取到的就是空」是两回事。`build_externals` 按公式的
        依赖建键，一个都不会少；少了就说明调用方漏装了一个取数相位。当空处理
        的话整列静默算空，与「数据本身就是空」在界面上分不开。
        Args: key。
        """
        if key not in self._context.externals:
            raise ExternalsNotPrefetched(
                f"外部值未预取：{key}；"
                "调用方须先经 build_externals 装好取数相位"
            )
        return self._context.externals[key]

    def _reference(self, node: ast.Name) -> object:
        """一个列引用：本表读当前行，跨表读预取好的 as-of 值。

        Args: node。
        """
        external = self._parsed.external_placeholders.get(node.id)
        if external is not None:
            return self._external(("ext", external.table_code, external.key))
        return self._context.values.get(self._parsed.placeholders[node.id])

    def _call(self, node: ast.Call) -> object:
        """函数调用。

        Args: node。
        """
        name = call_name(node)
        if name == PREDICT_FUNC:
            return self._predict(node)
        key = self._history_key(name, node)
        if key is not None:
            return self._external(key)
        lazy = LAZY_IMPL.get(name)
        if lazy is not None:
            return lazy(node.args, self.visit)
        scalar = SCALAR_IMPL.get(name)
        if scalar is None:  # pragma: no cover - 三张名单由契约测试锁死
            raise FormulaError(f"未实现的函数 {name}")
        return scalar([self.visit(arg) for arg in node.args])

    def _predict(self, node: ast.Call) -> object:
        """`PREDICT('模型标识', 实参…)`：把实参算出来交给模型。

        ⚠ 实参在**行内**求值，所以它们可以是任意表达式、含公式列——依赖图会
        把被引用的公式列排在前面。这正是走 `externals` 装「模型定义」而不是
        「逐行请求」换来的（docs/MODELING_DESIGN.md D26）。
        ⚠ 模型用不了时抛 `FormulaError`，那句原因会落到这一格的
        `compute_error` 上——空着而不说原因，用户无从判断是数据没有还是没接上。
        Args: node。
        """
        code = str(const_value(node.args[0]))
        model = self._external(("model", code))
        if isinstance(model, AnalysisUnavailable):
            raise FormulaError(model.reason)
        if not isinstance(model, AnalysisModel):  # pragma: no cover - 装配保证
            raise FormulaError(f"模型「{code}」不可用")
        return model.predict(
            [to_number(self.visit(item)) for item in node.args[1:]]
        )

    def _history_key(self, name: str, node: ast.Call) -> ExternalKey | None:
        """要读历史的三族：算出它的预取键；不是这三族给 None。

        Args: name, node。
        """
        if name == PREV_FUNC:
            key = self._parsed.placeholders[name_ref(node.args[0])]
            steps = (
                const_value(node.args[1])
                if len(node.args) == _PREV_WITH_STEPS
                else 1
            )
            return ("prev", key, int(steps))
        if name in WINDOW_FUNCS:
            key = self._parsed.placeholders[name_ref(node.args[0])]
            # 求值期重新规范化，`'3月'` 与 `'3mo'` 才落到同一个键上
            literal = parse_window(str(const_value(node.args[1]))).literal
            return ("win", name, key, literal)
        if name in ALL_FUNCS:
            return (
                "all",
                name,
                self._parsed.placeholders[name_ref(node.args[0])],
            )
        return None

    def _binop(self, node: ast.BinOp) -> object:
        """四则与幂：任一操作数为空即空。

        Args: node。
        """
        left = to_number(self.visit(node.left), where="算术运算")
        right = to_number(self.visit(node.right), where="算术运算")
        if left is None or right is None:
            return None
        function = _BINOP.get(type(node.op))
        if function is None:  # pragma: no cover - 解析期白名单已拦
            raise FormulaError(f"不支持的运算符 {type(node.op).__name__}")
        result = function(left, right)
        return None if result is None else finite(result)

    def _unaryop(self, node: ast.UnaryOp) -> object:
        """`not` 走真假口径，正负号走数值口径。

        Args: node。
        """
        value = self.visit(node.operand)
        if isinstance(node.op, ast.Not):
            flag = truthy(value)
            return None if flag is None else (not flag)
        number = to_number(value, where="正负号")
        if number is None:
            return None
        return -number if isinstance(node.op, ast.USub) else number

    def _boolop(self, node: ast.BoolOp) -> object:
        """中缀 `and` / `or`。

        ⚠ 与函数写法 `AND()` / `OR()` **共用同一份实现**，否则同一个意思换个
        写法算出不同的数。
        Args: node。
        """
        return kleene(
            (self.visit(value) for value in node.values),
            should_stop_on=not isinstance(node.op, ast.And),
        )

    def _ifexp(self, node: ast.IfExp) -> object:
        """三元式 `真值 if 条件 else 假值`。

        ⚠ 与 `IF` 语义必须一致：条件为空整条中止为空。
        Args: node。
        """
        flag = truthy(self.visit(node.test))
        if flag is None:
            return None
        return self.visit(node.body if flag else node.orelse)

    def _compare(self, node: ast.Compare) -> object:
        """链式比较 `0 < x < 100`：从左到右，一环不成立就定案。

        Args: node。
        """
        left = self.visit(node.left)
        for link, right_node in zip(node.ops, node.comparators, strict=True):
            right = self.visit(right_node)
            outcome = _compare_pair(left, right, link)
            if outcome is None or outcome is False:
                return outcome
            left = right
        return True


def _compare_pair(left: object, right: object, link: ast.cmpop) -> object:
    """比较一环。两侧都是字符串按字典序，否则一律走数值口径。

    Args: left, right, link。
    """
    if left is None or right is None:
        return None
    if isinstance(left, str) and isinstance(right, str):
        return _apply(link, left, right)
    left_number = to_number(left, where="比较")
    right_number = to_number(right, where="比较")
    if left_number is None or right_number is None:
        return None
    return _apply(link, left_number, right_number)


def _apply[T: (float, str)](link: ast.cmpop, left: T, right: T) -> bool:
    """对同类型的两侧施加一个比较符。

    ⚠ 泛型约束成「都是数」或「都是串」两种实例：混着比（`1 < 'a'`）在 Python
    里是 TypeError，而调用方已经保证了同类型。
    Args: link, left, right。
    """
    if isinstance(link, ast.Eq):
        return left == right
    if isinstance(link, ast.NotEq):
        return left != right
    if isinstance(link, ast.Lt):
        return left < right
    if isinstance(link, ast.LtE):
        return left <= right
    if isinstance(link, ast.Gt):
        return left > right
    if isinstance(link, ast.GtE):
        return left >= right
    # 解析期白名单已拦，走到这里说明两边不同步了
    raise FormulaError(f"不支持的比较符 {type(link).__name__}")
