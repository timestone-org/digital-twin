"""库公式展开：`@标识(实参)` 就地内联成引擎原生的节点。

展开之后表达式档的调用**不复存在**，于是依赖抽取、环检测、拓扑排序、记号树与
求值器一个字都不用知道公式库（docs/DATASET_DESIGN.md §5.1 第 4 步）。

⚠ **替换的是 AST 子树，不是文本。** 把 `{整体}` 按文本换成 `1+3`，
`{部分}/{整体}*100` 就成了 `1/1+3*100 = 301`，正确答案是 25——不报错，数还
长得挺像样。
⚠ **每处替换都 `deepcopy`**：同一个形参在体里出现两次会共用一个节点对象，
之后任何一次树改写都同时改到另一处。
"""

import ast
import copy
from dataclasses import dataclass, field

from platform_server.apps.dataset.formula.errors import FormulaError
from platform_server.apps.dataset.formula.library import (
    EMPTY_LIBRARY,
    MAX_FX_DEPTH,
    MAX_FX_EXPANSIONS,
    PARAM_COLUMN,
    FormulaLibrary,
    FxEntry,
)
from platform_server.apps.dataset.formula.tokens import (
    intern_ref,
    to_expression,
)


@dataclass
class Expansion:
    """一次解析期间共享的展开状态。"""

    library: FormulaLibrary = EMPTY_LIBRARY
    #: 调用方的占位空间，展开时会被就地扩充（库公式体里的跨表引用要并进来）
    placeholders: dict[str, str] = field(default_factory=dict[str, str])
    #: 碰过的全部库公式标识，含嵌套
    used: set[str] = field(default_factory=set[str])
    #: 剩余展开次数
    remaining: int = MAX_FX_EXPANSIONS


def expand_macros(
    tree: ast.Expression, codes: dict[str, str], state: Expansion
) -> ast.Expression:
    """把树上的库公式调用原地展开，返回展开后的树。

    Args: tree, codes（{占位函数名: 库公式标识}）, state。
    """
    tree.body = _Expander(codes, state, ()).visit(tree.body)
    return ast.fix_missing_locations(tree)


class _Expander(ast.NodeTransformer):
    """一层展开。`stack` 是正在展开的标识链，用来查环。"""

    def __init__(
        self, codes: dict[str, str], state: Expansion, stack: tuple[str, ...]
    ) -> None:
        """绑定这一层的占位表、共享状态与调用链。

        Args: codes, state, stack。
        """
        self._codes = codes
        self._state = state
        self._stack = stack

    def visit_Call(self, node: ast.Call) -> ast.AST:
        """展开一处调用。

        Args: node。
        """
        # 实参属于**调用方**：用调用方的调用链展开，嵌套调用才不会被误判成环
        node.args = [self.visit(arg) for arg in node.args]
        code = self._code_of(node)
        if code is None:
            return node
        entry = _require_entry(code, self._state.library)
        self._state.used.add(code)
        _check_call(entry, node, self._state.placeholders)
        self._guard(code)
        return self._inline(entry, node.args)

    def _code_of(self, node: ast.Call) -> str | None:
        """这处调用是不是库公式调用；不是则给 None。

        Args: node。
        """
        if not isinstance(node.func, ast.Name):
            return None
        return self._codes.get(node.func.id)

    def _guard(self, code: str) -> None:
        """环、深度与展开次数三道闸。

        Args: code。
        """
        if code in self._stack:
            chain = " → ".join([*self._stack, code])
            raise FormulaError(f"库公式互相调用成环：{chain}")
        if len(self._stack) >= MAX_FX_DEPTH:
            raise FormulaError(
                f"库公式嵌套超过 {MAX_FX_DEPTH} 层，请把中间口径拆成台账里的"
                "一列"
            )
        self._state.remaining -= 1
        if self._state.remaining < 0:
            raise FormulaError(
                f"一条公式最多展开 {MAX_FX_EXPANSIONS} 次库公式调用，"
                "请把重复的部分拆成台账里的一列"
            )

    def _inline(self, entry: FxEntry, args: list[ast.expr]) -> ast.AST:
        """解析公式体、绑上实参、再展开体里的嵌套调用。

        Args: entry, args。
        """
        body, body_placeholders, body_codes = _parse_body(entry)
        binding = self._bind(entry, args, body_placeholders)
        bound = _ParamSubstituter(binding).visit(body)
        return _Expander(
            body_codes, self._state, (*self._stack, entry.code)
        ).visit(bound)

    def _bind(
        self,
        entry: FxEntry,
        args: list[ast.expr],
        body_placeholders: dict[str, str],
    ) -> dict[str, ast.expr]:
        """公式体的占位符 → 要换上去的子树。

        Args: entry, args, body_placeholders。
        """
        # 元数已在 `_check_call` 里对齐，故 strict 只是把这条前提写死
        declared = {
            param.name: arg
            for param, arg in zip(entry.params, args, strict=True)
        }
        binding: dict[str, ast.expr] = {}
        for slot, ref_key in body_placeholders.items():
            given = declared.get(ref_key)
            if given is not None:
                binding[slot] = given
                continue
            # 体里的绝对引用（跨表列）：并进调用方的占位空间，换成它的占位名
            binding[slot] = ast.Name(
                id=intern_ref(ref_key, self._state.placeholders),
                ctx=ast.Load(),
            )
        return binding


class _ParamSubstituter(ast.NodeTransformer):
    """把公式体里的形参占位换成调用点的实参子树。"""

    def __init__(self, binding: dict[str, ast.expr]) -> None:
        """绑定这一次的替换表。

        Args: binding。
        """
        self._binding = binding

    def visit_Name(self, node: ast.Name) -> ast.AST:
        """占位符换成实参的**副本**。

        Args: node。
        """
        replacement = self._binding.get(node.id)
        if replacement is None:
            return node
        return copy.deepcopy(replacement)


def _require_entry(code: str, library: FormulaLibrary) -> FxEntry:
    """取库条目。

    ⚠ 「没有」与「已停用」是两句不同的话：快照里连停用的一起装着，正是为了
    说得出后一句——说成前一句会把人送去建一条已经存在的公式。
    Args: code, library。
    """
    entry = library.get(code)
    if entry is None:
        known = [item.code for item in library.enabled_entries()]
        hint = f"可用：{'、'.join(known)}" if known else "公式库当前是空的"
        raise FormulaError(f"公式库里没有 '{code}'。{hint}")
    if not entry.is_enabled:
        raise FormulaError(
            f"库公式 '{code}' 已停用——启用它，或把这一列改成别的算法"
        )
    return entry


def _check_call(
    entry: FxEntry, node: ast.Call, placeholders: dict[str, str]
) -> None:
    """元数与列实参形态。

    Args: entry, node, placeholders。
    """
    if node.keywords:
        raise FormulaError("函数不支持关键字参数")
    if len(node.args) != entry.arity:
        raise FormulaError(
            f"{entry.signature()} 需要 {entry.arity} 个参数，"
            f"实际 {len(node.args)} 个"
        )
    for position, (param, arg) in enumerate(
        zip(entry.params, node.args, strict=True), start=1
    ):
        if param.kind != PARAM_COLUMN:
            continue
        if not (isinstance(arg, ast.Name) and arg.id in placeholders):
            raise FormulaError(
                f"@{entry.code} 的第 {position} 个参数「{param.display}」"
                "必须是列引用，写作 {列key}"
            )


def _parse_body(
    entry: FxEntry,
) -> tuple[ast.expr, dict[str, str], dict[str, str]]:
    """解析一条库公式的体。

    Args: entry。
    """
    try:
        tree, placeholders, codes = to_expression(entry.expression)
    except FormulaError as error:
        raise FormulaError(f"库公式 '{entry.code}' 有误：{error}") from error
    return tree.body, placeholders, codes
