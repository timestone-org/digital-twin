"""公式面的入参与出参：函数目录、校验、试算，以及落库的依赖形态。"""

from typing import Any

from pydantic import Field

from platform_server.apps.dataset.models import MAX_FORMULA_LENGTH
from platform_server.apps.dataset.protocols import ColumnSource, ColumnType
from platform_server.apps.dataset.schemas.common import (
    ColumnKey,
    InputModel,
    OutputModel,
)

# 试算一次最多收多少个样例值。⚠ 有上限不是省流量：这是个无界字典入参
MAX_PREVIEW_VALUES = 200


class FormulaPrevDepOut(OutputModel):
    """一处跨行引用。"""

    key: str
    steps: int


class FormulaWindowDepOut(OutputModel):
    """一处时间窗引用。`key` 跨表时形如 `表code.列key`。"""

    func: str
    key: str
    window: str


class FormulaWholeDepOut(OutputModel):
    """一处整列聚合引用。"""

    func: str
    key: str


class FormulaExternalDepOut(OutputModel):
    """一处跨表直接引用。"""

    table: str
    key: str


class FormulaDepsOut(OutputModel):
    """保存公式时解析出的依赖，也是 `dataset_columns.formula_deps` 的形态。

    ⚠ 键集与 `formula.FormulaDeps.to_json()` 必须逐字一致：Pydantic 默认忽略
    多余键，那边加一个键而这里忘了加，落库形态与契约形态就此分叉，没有任何
    东西会报。由契约测试锁死。
    """

    same_row: list[str]
    prev: list[FormulaPrevDepOut]
    window: list[FormulaWindowDepOut]
    whole: list[FormulaWholeDepOut]
    external: list[FormulaExternalDepOut]
    # 上面几项里**本表**列 key 的并集，供「谁引用了这一列」反查
    referenced_keys: list[str]


class CatalogChoiceOut(OutputModel):
    """目录里的一个可选项：分类、运算符、时间窗写法共用这一个形状。"""

    value: str
    label: str


class CatalogFunctionOut(OutputModel):
    """函数面板里的一个函数。

    ⚠ `min_args` / `max_args` 由后端从元数表注入，不是手写的：前端按
    `min_args` 生成模板空位数（docs/DATASET_DESIGN.md §5.3）。
    """

    name: str
    category: str
    signature: str
    description: str
    example: str
    args: list[str]
    min_args: int
    # 不限参数个数时给 null
    max_args: int | None


class FormulaColumnOut(OutputModel):
    """公式里可引用的一列。"""

    key: str
    name: str
    unit: str | None
    data_type: ColumnType
    source: ColumnSource


class FormulaTableOut(OutputModel):
    """公式里可跨表引用的一张台账。"""

    code: str
    name: str


class FormulaFunctionsOut(OutputModel):
    """函数目录 + 可引用的列与表 + 库公式。"""

    categories: list[CatalogChoiceOut]
    functions: list[CatalogFunctionOut]
    operators: list[CatalogChoiceOut]
    window_units: list[CatalogChoiceOut]
    rules: list[str]
    columns: list[FormulaColumnOut]
    tables: list[FormulaTableOut]
    # 库公式标识。⚠ 公式库随第 4 期落地，在那之前恒为空
    library: list[str]


class FormulaValidateIn(InputModel):
    """校验一条公式。

    `column_key` 是正在编辑的那一列；给了才做环检测——新建时它还不存在，
    但它的 key 已经定下来了。
    """

    formula: str = Field(min_length=1, max_length=MAX_FORMULA_LENGTH)
    column_key: ColumnKey | None = None


class FormulaValidateOut(OutputModel):
    """校验结果。

    ⚠ 语法错误走 **200 + `is_ok=false`**，不是 HTTP 错误：编辑器里「公式还没
    写完」是正常状态（docs/DATASET_DESIGN.md §6.1）。
    """

    is_ok: bool
    error: str | None = None
    deps: FormulaDepsOut | None = None
    # 记号树。⚠ 递归结构，故是一团自由 JSON；渲染失败时为 null 而不是报错
    notation: dict[str, Any] | None = None
    notation_text: str | None = None


class FormulaPreviewIn(InputModel):
    """用一组样例值试算一条公式。"""

    formula: str = Field(min_length=1, max_length=MAX_FORMULA_LENGTH)
    column_key: ColumnKey | None = None
    values: dict[str, Any] = Field(
        default_factory=dict, max_length=MAX_PREVIEW_VALUES
    )


class FormulaPreviewOut(OutputModel):
    """试算结果。"""

    is_ok: bool
    value: Any = None
    error: str | None = None
    # 公式引用了、但这次没给值的列——界面据此说清是**哪一列**让结果变空的
    missing: list[str] = Field(default_factory=list)
    # 仅当公式是纯加法、且结果正是被缺失值弄空时才为真——界面据此提议改用
    # `SUM(...)` 跳过缺失。
    # ⚠ 减 / 乘 / 除刻意不给这条建议：那里的空才是正确答案，劝人换写法就是劝
    # 人把一个正确的空换成一个错的数
    should_suggest_sum: bool = False
    # 读历史的引用。⚠ 试算**不取历史**，这些一律按空处理，界面要照实说
    history_refs: list[str] = Field(default_factory=list)
