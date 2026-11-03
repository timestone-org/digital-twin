"""两列或列与常数的闭合算术运算。"""

from typing import Literal, Self

from pydantic import Field, model_validator

from platform_server.apps.modeling.operators.base import (
    ColumnsByPort,
    OperatorConfig,
    OperatorError,
    column_field,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    Frame,
    FrameColumn,
    frame_input,
    numbers_of,
)
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.tabular import (
    FrameOperator,
    appended,
    finite,
)


class ColumnMathConfig(OperatorConfig):
    """算术两端、输出名称与错误策略。"""

    left_column: str = column_field(title="左侧数值列")
    right_mode: Literal["column", "constant"] = Field(
        default="constant",
        title="右侧取值",
        description="column=另一数值列；constant=固定常数",
    )
    right_column: str = Field(
        title="右侧数值列",
        description="右侧取值选择数值列时必填",
        default="",
        json_schema_extra={
            "x-dt-widget": "column",
            "x-dt-visible-when": {"right_mode": ["column"]},
        },
    )
    constant: float = Field(
        default=1.0,
        title="右侧常数",
        json_schema_extra={"x-dt-visible-when": {"right_mode": ["constant"]}},
    )
    method: Literal["add", "subtract", "multiply", "divide", "min", "max"] = (
        Field(
            default="add",
            title="运算",
            description="add=相加；subtract=左减右；multiply=相乘；divide=左除右；min=取较小值；max=取较大值",
        )
    )
    output_column: str = Field(
        default="calculated",
        min_length=1,
        max_length=128,
        title="输出列名",
        description="新增一列，不覆盖已有列",
    )
    on_invalid: Literal["error", "null"] = Field(
        default="error",
        title="除零或溢出时",
        description="error=停止并报错；null=该格留空",
    )

    @model_validator(mode="after")
    def right_column_when_selected(self) -> Self:
        if self.right_mode == "column" and not self.right_column:
            raise ValueError("使用右侧数值列时必须选择该列")
        return self


@register_operator
class ColumnMath(FrameOperator):
    CODE = "column_math"
    NAME = "列间计算"
    DESCRIPTION = (
        "通过固定运算生成数值列，不执行自由表达式；任一输入为空则结果为空"
    )
    CATEGORY = "feature"
    ICON = "ruler"
    CONFIG_MODEL = ColumnMathConfig
    ENABLED_IN_SERVING = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        config = ColumnMathConfig.model_validate(self.config.model_dump())
        left = numbers_of(frame, config.left_column)
        right = (
            numbers_of(frame, config.right_column)
            if config.right_mode == "column"
            else [config.constant] * frame.row_count
        )
        values = [
            _calculate(first, second, config)
            for first, second in zip(left, right, strict=True)
        ]
        column = FrameColumn(
            key=config.output_column,
            name=config.output_column,
            dtype=DTYPE_NUMBER,
        )
        return appended(frame, [column], [values])

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        parsed = ColumnMathConfig.model_validate(config.model_dump())
        keys = inputs.get("frame")
        return {
            "frame": None if keys is None else (*keys, parsed.output_column)
        }


def _calculate(
    left: float | None, right: float | None, config: ColumnMathConfig
) -> float | None:
    if left is None or right is None:
        return None
    operations = {
        "add": lambda: left + right,
        "subtract": lambda: left - right,
        "multiply": lambda: left * right,
        "divide": lambda: left / right,
        "min": lambda: min(left, right),
        "max": lambda: max(left, right),
    }
    try:
        return finite(operations[config.method](), on_invalid=config.on_invalid)
    except ZeroDivisionError as error:
        if config.on_invalid == "null":
            return None
        raise OperatorError("列间计算遇到除零，请检查右侧取值") from error
