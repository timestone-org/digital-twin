"""公式库的值对象：可被台账公式列 `@标识(实参)` 调用的具名计算单元。

⚠ 本期**没有 `dataset_formulas` 表**（随第 4 期落地），只有这道缝：引擎照常
认得 `@标识(...)` 并就地展开，快照由调用方给。默认是空库，于是「库里没有 X」
与「库还没建」在报错文案上就是同一句话，不会误导用户去找一条不存在的公式。

⚠ `FormulaLibrary` 是**快照不是活查询**：一次重算可能横跨上万行、共用同一套
定义，中途换定义会让同一批数据按两套口径算出来，而且没有任何症状。
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Self

# 库公式标识：与列 key 同一套禁令
# （`tokens.COLUMN_KEY_RE`）
FX_CODE_RE = re.compile(r"^[^\s@{}()\[\],:.'\"]{1,64}$")
# 实参必须是裸列引用：`PREV` / `*_OVER` / `*_ALL` 要知道是**哪一列**，
# 收不了表达式
PARAM_COLUMN = "column"
# 实参可以是任意表达式
PARAM_VALUE = "value"
FX_PARAM_KINDS = (PARAM_COLUMN, PARAM_VALUE)
# 嵌套层数：@A 调 @B 调 @C…
MAX_FX_DEPTH = 8
# 一条公式里总共展开多少次——挡的是「层数不深但极宽」那一路
MAX_FX_EXPANSIONS = 200


@dataclass(frozen=True)
class FxParam:
    """库公式的一个形参。"""

    name: str
    kind: str = PARAM_COLUMN
    label: str = ""
    hint: str = ""
    default: Any = None

    @property
    def display(self) -> str:
        """报错与模板里显示的名字。"""
        return self.label or self.name


@dataclass(frozen=True)
class FxEntry:
    """库里的一条公式。`expression` 里用 `{形参名}` 指代形参。"""

    code: str
    name: str
    expression: str
    params: tuple[FxParam, ...] = ()
    category: str = "custom"
    description: str = ""
    is_enabled: bool = True

    @property
    def arity(self) -> int:
        """要几个实参。"""
        return len(self.params)

    def signature(self) -> str:
        """`@标识(形参1, 形参2)`，报错与目录里都用它。"""
        return f"@{self.code}({', '.join(item.name for item in self.params)})"


@dataclass(frozen=True)
class FormulaLibrary:
    """一次解析期间用的库快照。"""

    entries: Mapping[str, FxEntry] = field(default_factory=dict[str, FxEntry])

    @classmethod
    def of(cls, entries: "list[FxEntry] | tuple[FxEntry, ...]") -> Self:
        """按 code 索引一批条目。

        Args: entries。
        """
        return cls(entries={item.code: item for item in entries})

    def get(self, code: str) -> FxEntry | None:
        """按标识取一条；停用的也取得到。

        ⚠ 停用的条目照样装进快照，`_require_entry` 才说得出「已停用」而不是
        「公式库里没有 X」——后者会把人送去建一条已经存在的公式。
        Args: code。
        """
        return self.entries.get(code)

    def enabled_entries(self) -> list[FxEntry]:
        """启用中的条目，按标识排序。"""
        return sorted(
            (item for item in self.entries.values() if item.is_enabled),
            key=lambda item: item.code,
        )

    def __bool__(self) -> bool:
        """空库为假，`uses_library` 之类的短路判断靠它。"""
        return bool(self.entries)


EMPTY_LIBRARY = FormulaLibrary()
