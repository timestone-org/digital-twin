"""行级文本处理、数值变换和显式数值替换。"""

import math
from collections.abc import Callable
from dataclasses import replace
from typing import Literal, Self

from pydantic import Field, model_validator

from platform_server.apps.modeling.operators.base import (
    OperatorConfig,
    OperatorError,
    column_field,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    DTYPE_STRING,
    CellValue,
    Frame,
    frame_input,
    numbers_of,
    with_column_cast,
    with_column_values,
)
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.tabular import (
    MAX_TEXT,
    FrameOperator,
    finite,
    selected_keys,
)


class TextTransformConfig(OperatorConfig):
    """只接受固定文本操作，不解释表达式或正则。"""

    columns: list[str] = column_field(
        title="处理文本列",
        description="留空处理全部文本列；空值保持为空",
        default_factory=list[str],
    )
    method: Literal[
        "strip", "lower", "upper", "replace", "prefix", "suffix", "length"
    ] = Field(
        default="strip",
        title="文本操作",
        description="strip=清除两端空白；lower=转小写；upper=转大写；replace=替换固定文本；prefix=添加前缀；suffix=添加后缀；length=字符长度",
    )
    find: str = Field(
        default="",
        max_length=1024,
        title="查找文本",
        description="固定文本匹配；替换操作时必填",
        json_schema_extra={"x-dt-visible-when": {"method": ["replace"]}},
    )
    replacement: str = Field(
        default="",
        max_length=1024,
        title="替换或追加文本",
        description="替换操作可留空以删除文本；前缀和后缀操作使用此内容",
        json_schema_extra={
            "x-dt-visible-when": {"method": ["replace", "prefix", "suffix"]}
        },
    )

    @model_validator(mode="after")
    def replacement_has_needle(self) -> Self:
        if self.method == "replace" and not self.find:
            raise ValueError("替换操作必须填写非空的查找文本")
        return self


@register_operator
class TextTransform(FrameOperator):
    CODE = "text_transform"
    NAME = "文本处理"
    DESCRIPTION = "清理、转换和替换文本；字符长度可转成数值特征"
    CATEGORY = "preprocess"
    ICON = "list-checks"
    CONFIG_MODEL = TextTransformConfig
    ENABLED_IN_SERVING = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        config = TextTransformConfig.model_validate(self.config.model_dump())
        keys = config.columns or [
            column.key
            for column in frame.columns
            if column.dtype == DTYPE_STRING
        ]
        if not keys:
            raise OperatorError("没有文本列可处理")
        for key in selected_keys(frame, keys):
            if frame.column_of(key).dtype != DTYPE_STRING:
                raise OperatorError(f"列「{key}」不是文本列")
            values = [
                _text_value(value, config) for value in frame.values_of(key)
            ]
            dtype = DTYPE_NUMBER if config.method == "length" else DTYPE_STRING
            frame = with_column_cast(frame, key, values, dtype)
            if config.method == "length":
                frame = replace(
                    frame,
                    columns=tuple(
                        (
                            replace(column, unit="")
                            if column.key == key
                            else column
                        )
                        for column in frame.columns
                    ),
                )
        return frame


def _text_value(value: CellValue, config: TextTransformConfig) -> CellValue:
    if value is None:
        return None
    if not isinstance(value, str):
        raise OperatorError("文本列混入了其他类型，请先使用类型归一算子")
    if config.method == "length":
        return float(len(value))
    operations = {
        "strip": value.strip,
        "lower": value.lower,
        "upper": value.upper,
        "replace": lambda: value.replace(config.find, config.replacement),
        "prefix": lambda: config.replacement + value,
        "suffix": lambda: value + config.replacement,
    }
    result = operations[config.method]()
    if len(result) > MAX_TEXT:
        raise OperatorError("处理后的单个文本超过 4096 字符，请缩短文本")
    return result


class NumericTransformConfig(OperatorConfig):
    """固定数值函数及定义域错误策略。"""

    columns: list[str] = column_field(
        title="处理数值列",
        description="留空处理全部非目标数值列；直接修改所选列",
        default_factory=list[str],
    )
    method: Literal[
        "abs", "log", "log1p", "sqrt", "square", "exp", "round", "affine"
    ] = Field(
        default="abs",
        title="数值操作",
        description="abs=绝对值；log=自然对数；log1p=一加数值的自然对数；sqrt=平方根；square=平方；exp=指数；round=小数舍入；affine=乘系数再加常数",
    )
    factor: float = Field(
        default=1.0,
        title="乘数",
        description="线性变换时使用",
        json_schema_extra={"x-dt-visible-when": {"method": ["affine"]}},
    )
    offset: float = Field(
        default=0.0,
        title="加数",
        description="线性变换时使用",
        json_schema_extra={"x-dt-visible-when": {"method": ["affine"]}},
    )
    digits: int = Field(
        default=2,
        ge=-12,
        le=12,
        title="保留小数位",
        description="舍入时使用；负数表示向十位、百位等舍入",
        json_schema_extra={"x-dt-visible-when": {"method": ["round"]}},
    )
    on_invalid: Literal["error", "null"] = Field(
        default="error",
        title="定义域错误或溢出时",
        description="error=停止并报错；null=该格留空",
    )


@register_operator
class NumericTransform(FrameOperator):
    CODE = "numeric_transform"
    NAME = "数值变换"
    DESCRIPTION = "使用固定数学函数变换数值，空值不参与计算，定义域错误显式处理"
    CATEGORY = "feature"
    ICON = "ruler"
    CONFIG_MODEL = NumericTransformConfig
    ENABLED_IN_SERVING = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        config = NumericTransformConfig.model_validate(self.config.model_dump())
        for key in self.numeric_columns(frame, config.columns):
            values: list[CellValue] = [
                _numeric_value(value, config)
                for value in numbers_of(frame, key)
            ]
            frame = with_column_values(frame, key, values)
            if config.method not in {"abs", "round", "affine"}:
                frame = replace(
                    frame,
                    columns=tuple(
                        (
                            replace(column, unit="")
                            if column.key == key
                            else column
                        )
                        for column in frame.columns
                    ),
                )
        return frame


def _numeric_value(
    value: float | None, config: NumericTransformConfig
) -> float | None:
    if value is None:
        return None
    operations: dict[str, Callable[[float], float]] = {
        "abs": abs,
        "log": math.log,
        "log1p": math.log1p,
        "sqrt": math.sqrt,
        "square": lambda item: item * item,
        "exp": math.exp,
        "round": lambda item: round(item, config.digits),
        "affine": lambda item: item * config.factor + config.offset,
    }
    try:
        return finite(
            operations[config.method](value), on_invalid=config.on_invalid
        )
    except (ValueError, OverflowError) as error:
        if config.on_invalid == "null":
            return None
        raise OperatorError("数值超出该操作的定义域或可表示范围") from error


class ReplaceValuesConfig(OperatorConfig):
    """数值精确替换及可选的显式空值填充。"""

    columns: list[str] = column_field(
        title="替换数值列",
        description="留空处理全部非目标数值列",
        default_factory=list[str],
    )
    match: float = Field(
        default=0.0, title="待替换数值", description="仅精确相等的数值会被替换"
    )
    replacement: float = Field(default=1.0, title="替换为")
    should_include_missing: bool = Field(
        default=False,
        title="同时填充空值",
        description="仅开启此项后才把缺失值替换为指定值",
    )


@register_operator
class ReplaceValues(FrameOperator):
    CODE = "replace_values"
    NAME = "数值替换"
    DESCRIPTION = "精确替换选定数值，空值仅在明确开启填充时修改"
    CATEGORY = "preprocess"
    ICON = "list-checks"
    CONFIG_MODEL = ReplaceValuesConfig
    ENABLED_IN_SERVING = True

    def transform(self, inputs: dict[str, object]) -> Frame:
        frame = frame_input(inputs, "frame")
        config = ReplaceValuesConfig.model_validate(self.config.model_dump())
        for key in self.numeric_columns(frame, config.columns):
            values: list[CellValue] = [
                (
                    config.replacement
                    if value == config.match
                    or (value is None and config.should_include_missing)
                    else value
                )
                for value in numbers_of(frame, key)
            ]
            frame = with_column_values(frame, key, values)
        return frame
