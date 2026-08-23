"""公式库面的入参与出参。ORM 模型绝不直接返给 HTTP 层。"""

import uuid
from typing import Any, Literal

from pydantic import Field

from platform_server.apps.dataset.models import (
    DEFAULT_CATEGORY,
    MAX_CATEGORY_LENGTH,
    MAX_FORMULA_LENGTH,
    MAX_FX_PARAMS,
)
from platform_server.apps.dataset.schemas.common import (
    ColumnKey,
    InputModel,
    Label,
    Note,
    OutputModel,
    UpdateModel,
    Utc,
)

# 形参种类。⚠ 两档差在**实参能是什么**：`column` 只收裸列引用，因为
# `PREV` / `*_OVER` / `*_ALL` 要知道是哪一列；`value` 收任意表达式
FormulaParamKind = Literal["column", "value"]
# 形参的显示名与提示语长度
MAX_PARAM_LABEL = 64
MAX_PARAM_HINT = 128


class FormulaParamSpec(OutputModel):
    """一个形参。出参与入参共用这一个形状——两边字段完全相同。"""

    name: ColumnKey
    kind: FormulaParamKind = "column"
    # 报错与模板里显示的名字，空则退回 `name`
    label: str = Field(default="", max_length=MAX_PARAM_LABEL)
    hint: str = Field(default="", max_length=MAX_PARAM_HINT)
    # ⚠ `value` 形参的默认值不是界面预填：它是「这个位置该放什么」的唯一声明。
    # 落在只收字面量的位置（时间窗、PREV 的期数）而没有默认值，校验必然失败
    default: Any = None


class FormulaDefOut(OutputModel):
    """一条库公式。"""

    id: uuid.UUID
    code: str
    name: str
    category: str
    expression: str
    params: list[FormulaParamSpec]
    description: str | None
    # 出厂预设：删不得（只能停用），改坏了能恢复出厂口径
    is_builtin: bool
    # ⚠ 停用不是「藏起来」：引用它的台账列会在解析期报错，那张表的录入、导入、
    # 修正与重算一起失败（docs/DATASET_DESIGN.md §5.11）
    is_enabled: bool
    # `@标识(形参1, 形参2)`，界面直接展示
    signature: str
    created_at: Utc
    updated_at: Utc


class FormulaUsageOut(OutputModel):
    """一处引用：哪张台账的哪一列在用这条公式。"""

    table_id: uuid.UUID
    table_code: str
    table_name: str
    column_id: uuid.UUID
    column_key: str
    column_name: str
    formula: str
    # 直接写了 `@标识(`；假表示是被别的库公式间接带进来的
    is_direct: bool


class FormulaDefWithUsagesOut(FormulaDefOut):
    """改完一条公式的回执：连引用面一起给。

    ⚠ 改动**即刻**对全部引用方生效，但历史行要等重算才跟上——界面据此提示去
    重算，不提示的话用户会以为改完就完了。
    """

    usages: list[FormulaUsageOut]


class FormulaCreateIn(InputModel):
    """新建一条库公式。"""

    # ⚠ `code` 建后不可改：它就是调用点上的那个字面量，改一次等于让每一处
    # `@旧标识(…)` 当场解析失败
    code: ColumnKey
    name: Label
    category: str = Field(
        default=DEFAULT_CATEGORY, min_length=1, max_length=MAX_CATEGORY_LENGTH
    )
    expression: str = Field(min_length=1, max_length=MAX_FORMULA_LENGTH)
    params: list[FormulaParamSpec] = Field(
        default_factory=list[FormulaParamSpec], max_length=MAX_FX_PARAMS
    )
    description: Note | None = None
    is_enabled: bool = True


class FormulaUpdateIn(UpdateModel):
    """改一条库公式。缺省的字段不动。`code` 不在这里。"""

    NON_NULLABLE = frozenset(
        {"name", "category", "expression", "params", "is_enabled"}
    )

    name: Label | None = None
    category: str | None = Field(
        default=None, min_length=1, max_length=MAX_CATEGORY_LENGTH
    )
    expression: str | None = Field(
        default=None, min_length=1, max_length=MAX_FORMULA_LENGTH
    )
    params: list[FormulaParamSpec] | None = Field(
        default=None, max_length=MAX_FX_PARAMS
    )
    description: Note | None = None
    is_enabled: bool | None = None
