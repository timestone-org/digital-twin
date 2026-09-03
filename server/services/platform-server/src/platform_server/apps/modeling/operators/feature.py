"""特征工程算子：标准化与独热编码。

两个都在训练行上学一份参数、推理时回灌——拿推理那一行现学，尺度就是那个值
本身、类目就是那一个，而每一列看着都正常。
"""

from dataclasses import replace
from typing import Any, Literal, cast

from pydantic import Field

from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
    column_field,
)
from platform_server.apps.modeling.operators.fitting import (
    fit_columns,
    training_frame,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    CellValue,
    Frame,
    FrameColumn,
    frame_input,
    numbers_of,
    with_column_values,
)
from platform_server.apps.modeling.operators.registry import register_operator

type ScaleMethod = Literal["zscore", "minmax"]
# 训练行上只有一个取值时的处置。skip 那一档不给这列记尺度，推理时也就跟着不缩放
type ConstantColumnAction = Literal["error", "skip"]

# 尺度为 0 的列（整列同一个值）除不得。⚠ 这一条在**拟合期**就要拒绝，
# 不能留到推理期才抛：那样模型训出来了、上线才炸（docs/MODELING_DESIGN.md §7.3）
_ZERO_SCALE = 0.0


class StandardizeConfig(OperatorConfig):
    """标准化的参数。"""

    method: ScaleMethod = Field(
        default="zscore",
        title="标准化方式",
        description="zscore=减均值除标准差；minmax=线性压到 0~1",
    )
    columns: list[str] = column_field(
        title="处理哪些列",
        description="留空表示除目标列外的全部数值列",
        default_factory=list[str],
    )
    on_constant_column: ConstantColumnAction = Field(
        default="error",
        title="常量列时",
        description="error=报错；skip=这一列原样放过不缩放",
    )


@register_operator
class Standardize(OperatorBase):
    """把数值列压到同一尺度，尺度参数训练时学、推理时回灌。"""

    CODE = "standardize"
    NAME = "标准化"
    DESCRIPTION = "把数值列按 z-score 或 min-max 压到同一尺度"
    CATEGORY = "feature"
    ICON = "ruler"
    CONFIG_MODEL = StandardizeConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    REQUIRES_FIT = True

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._scales: dict[str, dict[str, float]] = {}

    @property
    def _config(self) -> StandardizeConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, StandardizeConfig):  # pragma: no cover
            raise OperatorError("标准化拿到了不匹配的参数")
        return self.config

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """训练时按训练行算尺度，推理时用回灌的那份。

        Args: inputs。
        """
        frame = frame_input(inputs, "frame")
        keys = (
            tuple(self._scales)
            if self._scales
            else fit_columns(frame, self._config.columns, self.split_plan)
        )
        if not self._scales:
            self._fits(training_frame(frame, self.split_plan), keys)
        for key in self._scales:
            frame = with_column_values(frame, key, self._scaled(frame, key))
        return {"frame": frame}

    def dump_fitted(self) -> dict[str, Any] | None:
        """按列 key 建键的尺度参数。"""
        return {key: dict(value) for key, value in self._scales.items()}

    def load_fitted(self, params: dict[str, Any]) -> None:
        """回灌尺度参数。

        Args: params。
        """
        self.validate_fitted(params)
        self._scales = {
            key: _scale_entry(key, value) for key, value in params.items()
        }

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        """尺度参数必须是「列 key → {center, scale}」且 scale 不为 0。

        ⚠ 严格度与 `dump_fitted` 对齐：拟合期已经拒过尺度为 0 的列，这里不会
        比那边更严。
        Args: params。
        """
        for key, value in params.items():
            scale = _scale_entry(key, value)
            if scale["scale"] == _ZERO_SCALE:
                raise OperatorError(f"列「{key}」的尺度为 0")

    def _fits(self, train: Frame, keys: tuple[str, ...]) -> None:
        config = self._config
        for key in keys:
            present = [
                value for value in numbers_of(train, key) if value is not None
            ]
            if not present:
                raise OperatorError(f"列「{key}」在训练行上整列都是空值")
            scale = _scale_of(config.method, present)
            if scale["scale"] != _ZERO_SCALE:
                self._scales[key] = scale
            elif config.on_constant_column != "skip":
                raise OperatorError(
                    f"列「{key}」在训练行上只有一个取值，标准化会除以 0，"
                    "请把这一列从这一步里去掉"
                )

    def _scaled(self, frame: Frame, key: str) -> list[CellValue]:
        scale = self._scales[key]
        center, span = scale["center"], scale["scale"]
        return [
            None if value is None else (value - center) / span
            for value in numbers_of(frame, key)
        ]


def _scale_entry(key: str, raw: object) -> dict[str, float]:
    """把一份落库的尺度参数还原成两个数；形状不对即抛。

    Args: key, raw。
    """
    if not isinstance(raw, dict):
        raise OperatorError(f"列「{key}」的尺度参数形状不对")
    entry = cast("dict[str, object]", raw)
    if set(entry) != {"center", "scale"}:
        raise OperatorError(f"列「{key}」的尺度参数缺 center / scale")
    return {name: float(str(entry[name])) for name in ("center", "scale")}


def _scale_of(method: ScaleMethod, present: list[float]) -> dict[str, float]:
    """一列的中心与尺度。整列同一个值时 scale 为 0，由调用方决定怎么处置。

    Args: method, present。
    """
    if method == "minmax":
        low, high = min(present), max(present)
        center, span = low, high - low
    else:
        center = sum(present) / len(present)
        variance = sum((value - center) ** 2 for value in present) / len(
            present
        )
        span = variance**0.5
    return {"center": center, "scale": span}


# 一列最多编出多少个类目。⚠ 必须封顶：一列高基数的文本能把帧撑成上万列，
# 而每一列都要参与拟合
DEFAULT_MAX_CATEGORIES = 20
MAX_CATEGORIES_LIMIT = 200
# 编出来的列名接法：`原列名=类目`
CATEGORY_JOINER = "="
# 类目太多时的处置。keep_top 只留最常见的那几个，其余落全零
type ManyCategoriesAction = Literal["error", "keep_top"]


class OneHotConfig(OperatorConfig):
    """独热编码的参数。"""

    columns: list[str] = column_field(
        title="编哪几列",
        description="留空表示一列都不编",
        default_factory=list[str],
    )
    max_categories: int = Field(
        default=DEFAULT_MAX_CATEGORIES,
        ge=2,
        le=MAX_CATEGORIES_LIMIT,
        title="每列最多几个类目",
        description="超过它按下面那一档处置",
    )
    on_many_categories: ManyCategoriesAction = Field(
        default="error",
        title="类目太多时",
        description="error=报错；keep_top=只留最常见的那几个，其余落全零",
    )


@register_operator
class OneHot(OperatorBase):
    """把类目列编成一组 0/1 列。

    ⚠ 类目在**训练行**上定，推理时回灌：拿推理那一行现定类目，编出来的列名与
    训练时对不上，而每一列看着都正常。
    ⚠ 推理时遇到没见过的类目**落全零**，不报错：线上出现新类目是常态，为此拒绝
    整次预测比给一个「哪一类都不是」的编码更糟。
    """

    CODE = "one_hot"
    NAME = "独热编码"
    DESCRIPTION = "把类目列编成一组 0/1 列，类目在训练行上定"
    CATEGORY = "feature"
    ICON = "layout-grid"
    CONFIG_MODEL = OneHotConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    REQUIRES_FIT = True

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._categories: dict[str, list[str]] = {}

    @property
    def _config(self) -> OneHotConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, OneHotConfig):  # pragma: no cover
            raise OperatorError("独热编码拿到了不匹配的参数")
        return self.config

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """编出来几列**静态推不出来**——取决于数据里有哪些类目。

        ⚠ 声明成「原样透传」的话，下游的列候选里会留着已经被编掉的原列，而它
        在帧上已经不存在了。发布期那一侧不靠这条声明，靠训练时实际流过的列（D3）。
        Args: config, inputs。
        """
        del config, inputs
        return {"frame": None}

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """训练时按训练行定类目，推理时用回灌的那份。

        Args: inputs。
        """
        frame = frame_input(inputs, "frame")
        if not self._categories:
            self._fits(training_frame(frame, self.split_plan))
        for key in self._categories:
            frame = _encoded(frame, key, self._categories[key])
        return {"frame": frame}

    def dump_fitted(self) -> dict[str, Any] | None:
        """按列 key 建键的类目清单，顺序即编码顺序。"""
        return {key: list(value) for key, value in self._categories.items()}

    def load_fitted(self, params: dict[str, Any]) -> None:
        """回灌类目清单。

        Args: params。
        """
        self.validate_fitted(params)
        self._categories = {
            key: [str(item) for item in cast("list[object]", value)]
            for key, value in params.items()
        }

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        """类目必须是「列 key → 一串不重样的文本」。

        Args: params。
        """
        for key, value in params.items():
            if not isinstance(value, list) or not value:
                raise OperatorError(f"列「{key}」没有类目")
            items = [str(item) for item in cast("list[object]", value)]
            if len(set(items)) != len(items):
                raise OperatorError(f"列「{key}」的类目有重复")

    def _fits(self, train: Frame) -> None:
        config = self._config
        for key in config.columns:
            found = _ranked_categories(train, key)
            if len(found) > config.max_categories:
                if config.on_many_categories != "keep_top":
                    raise OperatorError(
                        f"列「{key}」上有 {len(found)} 个类目，超过了上限 "
                        f"{config.max_categories}——请先归并类目，"
                        "或改成只留最常见的那几个"
                    )
                found = found[: config.max_categories]
            if not found:
                raise OperatorError(f"列「{key}」在训练行上一个类目都没有")
            self._categories[key] = found


def _ranked_categories(train: Frame, key: str) -> list[str]:
    """训练行上出现过的类目，按出现次数从多到少；同频按字典序。

    ⚠ 顺序必须是确定的：按集合迭代顺序取，同一份数据在不同进程上会编出不同的
    列名，而两次训练各自看着都对。
    Args: train, key。
    """
    counts: dict[str, int] = {}
    for value in train.values_of(key):
        if value is None:
            continue
        counts[str(value)] = counts.get(str(value), 0) + 1
    return sorted(counts, key=lambda item: (-counts[item], item))


def _encoded(frame: Frame, key: str, categories: list[str]) -> Frame:
    """把一列换成一组 0/1 列，原列去掉。

    Args: frame, key, categories。
    """
    values = frame.values_of(key)
    position = frame.position_of(key)
    made = tuple(
        FrameColumn(
            key=f"{key}{CATEGORY_JOINER}{category}",
            name=f"{frame.column_of(key).name}={category}",
            dtype=DTYPE_NUMBER,
            role=frame.column_of(key).role,
        )
        for category in categories
    )
    _refuse_encoded_clashes(frame, made)
    columns = (
        *frame.columns[:position],
        *made,
        *frame.columns[position + 1 :],
    )
    rows = tuple(
        (
            *row[:position],
            *_flags(values[index], categories),
            *row[position + 1 :],
        )
        for index, row in enumerate(frame.rows)
    )
    return replace(frame, columns=columns, rows=rows)


def _refuse_encoded_clashes(
    frame: Frame, made: tuple[FrameColumn, ...]
) -> None:
    """编出来的列名撞上已有的列就当场说清楚。

    Args: frame, made.
    """
    taken = set(frame.keys) & {column.key for column in made}
    if taken:
        raise OperatorError(f"编出来的列名已经有了：{'、'.join(sorted(taken))}")


def _flags(value: CellValue, categories: list[str]) -> tuple[CellValue, ...]:
    """一格类目编成一串 0/1。没见过的类目落全零。

    Args: value, categories。
    """
    text = None if value is None else str(value)
    return tuple(1.0 if text == category else 0.0 for category in categories)
