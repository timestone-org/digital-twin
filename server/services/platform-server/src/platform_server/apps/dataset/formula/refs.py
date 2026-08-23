"""一条公式解析出来的东西：五类引用、依赖集合、已解析公式。

五类引用的连边规则不同（docs/DATASET_DESIGN.md §5.8）：只有「同行引用」与
「指向其它公式列的窗口引用」进依赖图，`PREV`、自引用窗口、整列聚合与跨表引用
都不连边——它们读的是别的行或别的表，不构成同一行内的先后关系。
"""

import ast
from dataclasses import dataclass, field
from typing import Any

from platform_server.apps.dataset.formula.tokens import split_external
from platform_server.apps.dataset.formula.windows import WindowSpec


@dataclass(frozen=True)
class PrevRef:
    """`PREV({列}, steps)`：往前第 steps 条记录的这一列。"""

    key: str
    steps: int = 1


@dataclass(frozen=True)
class ExternalRef:
    """`{表code.列key}`：另一张台账的一列，按 as-of 对齐。"""

    table_code: str
    key: str


@dataclass(frozen=True)
class WindowRef:
    """`FN_OVER({列}, '窗口')`。`key` 可能是 `表code.列key`。"""

    func: str
    key: str
    spec: WindowSpec

    @property
    def table_code(self) -> str | None:
        """跨表引用的表 code；本表引用给 None。"""
        return _table_code_of(self.key)

    @property
    def column_key(self) -> str:
        """去掉表前缀之后的列 key。"""
        return _column_key_of(self.key)


@dataclass(frozen=True)
class WholeRef:
    """`FN_ALL({列})`。`key` 可能是 `表code.列key`。"""

    func: str
    key: str

    @property
    def table_code(self) -> str | None:
        """跨表引用的表 code；本表引用给 None。"""
        return _table_code_of(self.key)

    @property
    def column_key(self) -> str:
        """去掉表前缀之后的列 key。"""
        return _column_key_of(self.key)


@dataclass
class FormulaDeps:
    """一条公式的全部依赖。落库的形态见 `to_json`。"""

    same_row: set[str] = field(default_factory=set[str])
    prev: set[PrevRef] = field(default_factory=set[PrevRef])
    window: set[WindowRef] = field(default_factory=set[WindowRef])
    whole: set[WholeRef] = field(default_factory=set[WholeRef])
    external: set[ExternalRef] = field(default_factory=set[ExternalRef])

    def to_json(self) -> dict[str, Any]:
        """落进 `dataset_columns.formula_deps` 的形态。

        ⚠ 每个列表都**确定性排序**：不排的话同一条公式两次保存写出两份不同的
        blob，diff 与幂等都跟着失效。
        ⚠ 键集必须与 `schemas.formula.FormulaDepsOut` 一致——Pydantic 默认
        忽略多余键，这里加一个键而那边忘了加，落库形态与契约形态就此分叉，
        没有任何东西会报。由契约测试锁死。
        """
        return {
            "same_row": sorted(self.same_row),
            "prev": sorted(
                ({"key": item.key, "steps": item.steps} for item in self.prev),
                key=lambda entry: (entry["key"], entry["steps"]),
            ),
            "window": sorted(
                (
                    {
                        "func": item.func,
                        "key": item.key,
                        "window": item.spec.literal,
                    }
                    for item in self.window
                ),
                key=lambda entry: (
                    entry["func"],
                    entry["key"],
                    entry["window"],
                ),
            ),
            "whole": sorted(
                ({"func": item.func, "key": item.key} for item in self.whole),
                key=lambda entry: (entry["func"], entry["key"]),
            ),
            "external": sorted(
                (
                    {"table": item.table_code, "key": item.key}
                    for item in self.external
                ),
                key=lambda entry: (entry["table"], entry["key"]),
            ),
            # 上面几项里本表列 key 的并集。⚠ 派生项，但它是「谁引用了这一列」
            # 那条反查的索引：只按 same_row 查会放行一次让 `PREV({x})` 那几列
            # 从此算不出数的删除
            "referenced_keys": sorted(self.referenced_keys),
        }

    @property
    def referenced_keys(self) -> set[str]:
        """本表内被引用到的列 key。

        ⚠ 跨表引用不在内：那些列属于另一张表，拿本表的已知列集合去校验必然
        报「引用了不存在的列」。
        """
        keys = set(self.same_row)
        keys |= {item.key for item in self.prev}
        keys |= {
            item.column_key
            for item in (*self.window, *self.whole)
            if item.table_code is None
        }
        return keys

    @property
    def external_table_codes(self) -> set[str]:
        """引用到的外部台账编码。

        ⚠ 三个入口都要收：直接引用、窗口聚合、整列聚合。漏一个的表现是取数期
        解析不出 table_id，那一列静默算空。
        """
        codes = {item.table_code for item in self.external}
        for item in (*self.window, *self.whole):
            if item.table_code is not None:
                codes.add(item.table_code)
        return codes


@dataclass(frozen=True)
class ParsedFormula:
    """解析产物：AST + 占位映射 + 依赖。求值与渲染都从这里出发。"""

    source: str
    tree: ast.Expression
    #: {占位符: 引用原文}，跨表的原文形如 `表code.列key`
    placeholders: dict[str, str]
    #: 上面那份里跨表的那些，预先拆好
    external_placeholders: dict[str, ExternalRef]
    deps: FormulaDeps
    #: 展开时碰过的全部库公式标识（含嵌套调用），供「谁在用这条库公式」反查
    used_fx: frozenset[str] = frozenset()


def _table_code_of(key: str) -> str | None:
    """引用原文里的表 code；不是跨表引用给 None。

    Args: key。
    """
    found = split_external(key)
    return None if found is None else found[0]


def _column_key_of(key: str) -> str:
    """引用原文里的列 key（去掉表前缀）。

    Args: key。
    """
    found = split_external(key)
    return key if found is None else found[1]
