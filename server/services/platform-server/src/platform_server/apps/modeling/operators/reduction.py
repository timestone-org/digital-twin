"""把特征变少的两个算子：特征筛选与主成分。

⚠ 两个都会**减列 / 换列**，而减掉哪几列取决于数据——`describe_columns` 如实给
`None`。发布那一侧不靠这条声明，靠训练时实际流过的列
（docs/MODELING_PLATFORM_DESIGN.md D3）。
⚠ 两个都**只动特征列，不动目标列**：把目标列压进主成分或筛掉，下游切分就找不到
要预测的那一列了。
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
from platform_server.apps.modeling.operators.estimators import (
    PrincipalComponents,
    projected,
)
from platform_server.apps.modeling.operators.fitting import (
    PLAN_TARGET,
    fit_columns,
    training_frame,
)
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    Frame,
    FrameColumn,
    frame_input,
    matrix_of,
    numbers_of,
    without_columns,
)
from platform_server.apps.modeling.operators.registry import register_operator

# 主成分列的名字：pc1、pc2……
COMPONENT_PREFIX = "pc"
# 拟合参数里那几个键
_KEPT = "kept"
_COLUMNS = "columns"
_MEAN = "mean"
_COMPONENTS = "components"

type SelectMethod = Literal["variance", "correlation"]


class SelectFeatureConfig(OperatorConfig):
    """特征筛选的参数。"""

    method: SelectMethod = Field(
        default="variance",
        title="按什么筛",
        description=(
            "variance=方差大的留下（不看目标列）；"
            "correlation=与目标列相关性绝对值大的留下"
        ),
    )
    top_k: int = Field(
        default=5,
        ge=1,
        le=500,
        title="留几列",
        description="留下排在前面的这么多列",
    )
    columns: list[str] = column_field(
        title="在哪几列里筛",
        description="留空表示除目标列外的全部数值列",
        default_factory=list[str],
    )


@register_operator
class SelectFeature(OperatorBase):
    """按方差或与目标的相关性留下前若干列。

    ⚠ 排名在**训练行**上定、推理时回灌：拿推理那一行现排，方差全是 0、相关性
    算不出来，而留下来的列每次都可能不同。
    ⚠ `variance` 那一档对量纲敏感——单位大的列方差天然大。没标准化时它筛出来的
    多半只是「单位大的那几列」。
    """

    CODE = "select_feature"
    NAME = "特征筛选"
    DESCRIPTION = "按方差或与目标的相关性留下前若干列"
    CATEGORY = "feature"
    ICON = "list-checks"
    CONFIG_MODEL = SelectFeatureConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    REQUIRES_FIT = True

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._kept: list[str] = []

    @property
    def _config(self) -> SelectFeatureConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, SelectFeatureConfig):  # pragma: no cover
            raise OperatorError("特征筛选拿到了不匹配的参数")
        return self.config

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """留下哪几列**静态推不出来**——取决于数据的方差与相关性。

        Args: config, inputs。
        """
        del config, inputs
        return {"frame": None}

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """训练时定排名，推理时按回灌的名单收窄。

        Args: inputs。
        """
        frame = frame_input(inputs, "frame")
        if not self._kept:
            self._fits(frame)
        candidates = set(self._candidates(frame))
        dropped = tuple(
            key
            for key in frame.keys
            if key in candidates and key not in self._kept
        )
        return {"frame": without_columns(frame, dropped)}

    def dump_fitted(self) -> dict[str, Any] | None:
        """留下来的那几列，按排名。"""
        return {_KEPT: list(self._kept)}

    def load_fitted(self, params: dict[str, Any]) -> None:
        """回灌名单。

        Args: params。
        """
        self.validate_fitted(params)
        self._kept = [str(item) for item in cast("list[object]", params[_KEPT])]

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        """名单必须是一串不重样的列 key。

        Args: params。
        """
        raw: object = params.get(_KEPT)
        if not isinstance(raw, list) or not raw:
            raise OperatorError("特征筛选没有留下任何一列")
        kept = [str(item) for item in cast("list[object]", raw)]
        if len(set(kept)) != len(kept):
            raise OperatorError("留下来的列有重复")

    def _candidates(self, frame: Frame) -> tuple[str, ...]:
        return fit_columns(frame, self._config.columns, self.split_plan)

    def _fits(self, frame: Frame) -> None:
        config = self._config
        train = training_frame(frame, self.split_plan)
        candidates = self._candidates(frame)
        if not candidates:
            raise OperatorError("没有可筛的数值列")
        ranked = sorted(
            candidates,
            key=lambda key: (-self._score(train, key), key),
        )
        self._kept = ranked[: config.top_k]

    def _score(self, train: Frame, key: str) -> float:
        if self._config.method == "correlation":
            target = _target_key(self.split_plan)
            if target:
                return abs(_correlation(train, key, target))
        return _variance(train, key)


class PcaConfig(OperatorConfig):
    """主成分的参数。"""

    n_components: int = Field(
        default=2,
        ge=1,
        le=100,
        title="留几个主成分",
        description="压出这么多条互不相关的轴",
    )
    columns: list[str] = column_field(
        title="压哪几列",
        description="留空表示除目标列外的全部数值列",
        default_factory=list[str],
    )


@register_operator
class Pca(OperatorBase):
    """把若干列压成几个主成分。

    ⚠ 对量纲极其敏感：没接标准化时，单位大的那一列会独占第一主成分，而压出来的
    数看着完全正常。这里**不替用户偷偷标准化**——那会让「同一份数据两种结果」
    无从解释；要标准化就在上游显式接一步。
    """

    CODE = "pca"
    NAME = "主成分降维"
    DESCRIPTION = "把若干数值列压成几条互不相关的主成分轴"
    CATEGORY = "feature"
    ICON = "chart-mixed"
    CONFIG_MODEL = PcaConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输入"),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="输出"),)
    REQUIRES_FIT = True

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._columns: list[str] = []
        self._mean: list[float] = []
        self._components: list[list[float]] = []

    @property
    def _config(self) -> PcaConfig:
        # pragma 理由 —— 参数由注册表按算子造，型别不会错
        if not isinstance(self.config, PcaConfig):  # pragma: no cover
            raise OperatorError("主成分降维拿到了不匹配的参数")
        return self.config

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        """压掉哪几列取决于数据里有哪些数值列，**静态推不出来**。

        Args: config, inputs。
        """
        del config, inputs
        return {"frame": None}

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """训练时定轴，推理时按回灌的轴投影。

        Args: inputs。
        """
        frame = frame_input(inputs, "frame")
        if not self._components:
            self._fits(frame)
        return {"frame": _with_components(frame, self._columns, self._axes())}

    def dump_fitted(self) -> dict[str, Any] | None:
        """压了哪几列、中心点在哪、几条轴各自的权重。"""
        return {
            _COLUMNS: list(self._columns),
            _MEAN: list(self._mean),
            _COMPONENTS: [list(row) for row in self._components],
        }

    def load_fitted(self, params: dict[str, Any]) -> None:
        """回灌轴。

        Args: params。
        """
        self.validate_fitted(params)
        self._columns = [
            str(item) for item in cast("list[object]", params[_COLUMNS])
        ]
        self._mean = [
            float(str(item)) for item in cast("list[object]", params[_MEAN])
        ]
        self._components = [
            [float(str(value)) for value in cast("list[object]", row)]
            for row in cast("list[object]", params[_COMPONENTS])
        ]

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        """列名、中心点、轴三样的宽度必须一致。

        ⚠ 宽度对不上时投影照样算得出来（zip 会截断），只是每一列都错位了——
        必须在这里拦下（§5.2）。
        Args: params。
        """
        columns = _as_list(params, _COLUMNS)
        mean = _as_list(params, _MEAN)
        axes = _as_list(params, _COMPONENTS)
        if not columns or not axes:
            raise OperatorError("主成分参数不完整")
        if len(mean) != len(columns):
            raise OperatorError("主成分的中心点与列数对不上")
        for row in axes:
            if not isinstance(row, list) or len(
                cast("list[object]", row)
            ) != len(columns):
                raise OperatorError("主成分的轴与列数对不上")

    def _axes(self) -> tuple[list[float], list[list[float]]]:
        return self._mean, self._components

    def _fits(self, frame: Frame) -> None:
        config = self._config
        columns = fit_columns(frame, config.columns, self.split_plan)
        if not columns:
            raise OperatorError("没有可压的数值列")
        estimator = PrincipalComponents(n_components=config.n_components)
        estimator.fit(
            matrix_of(training_frame(frame, self.split_plan), columns)
        )
        self._columns = list(columns)
        self._mean = estimator.mean
        self._components = estimator.components


def _as_list(params: dict[str, Any], key: str) -> list[object]:
    raw: object = params.get(key)
    return cast("list[object]", raw) if isinstance(raw, list) else []


def _variance(train: Frame, key: str) -> float:
    """一列在训练行上的方差；一个值都没有时给 0。

    Args: train, key。
    """
    present = [value for value in numbers_of(train, key) if value is not None]
    if not present:
        return 0.0
    mean = sum(present) / len(present)
    return sum((value - mean) ** 2 for value in present) / len(present)


def _correlation(train: Frame, key: str, target: str) -> float:
    """一列与目标列的皮尔逊相关系数；算不出来时给 0。

    ⚠ 只取两边都不空的那些行：一边补 0 会把「没测到」当成一个真实取值，
    相关性因此被拉向 0 或拉出一个假的相关。
    Args: train, key, target。
    """
    pairs = [
        (left, right)
        for left, right in zip(
            numbers_of(train, key), numbers_of(train, target), strict=True
        )
        if left is not None and right is not None
    ]
    if len(pairs) < 2:  # noqa: PLR2004 —— 少于两个点谈不上相关性
        return 0.0
    lefts = [item[0] for item in pairs]
    rights = [item[1] for item in pairs]
    left_mean = sum(lefts) / len(lefts)
    right_mean = sum(rights) / len(rights)
    covariance = sum(
        (left - left_mean) * (right - right_mean)
        for left, right in zip(lefts, rights, strict=True)
    )
    spread = (
        sum((left - left_mean) ** 2 for left in lefts)
        * sum((right - right_mean) ** 2 for right in rights)
    ) ** 0.5
    return 0.0 if spread == 0.0 else covariance / spread


def _target_key(split_plan: dict[str, Any] | None) -> str:
    """下游切分指定的目标列；图里没有切分时给空串。

    Args: split_plan。
    """
    return "" if split_plan is None else str(split_plan[PLAN_TARGET])


def _with_components(
    frame: Frame,
    columns: list[str],
    axes: tuple[list[float], list[list[float]]],
) -> Frame:
    """把那几列换成主成分列。

    Args: frame, columns, axes。
    """
    mean, components = axes
    rows = matrix_of(frame, tuple(columns))
    made = [projected(mean, components, row) for row in rows]
    kept = without_columns(frame, tuple(columns))
    made_columns = tuple(
        FrameColumn(
            key=f"{COMPONENT_PREFIX}{index + 1}",
            name=f"主成分 {index + 1}",
            dtype=DTYPE_NUMBER,
        )
        for index in range(len(components))
    )
    taken = set(kept.keys) & {column.key for column in made_columns}
    if taken:
        raise OperatorError(f"主成分列名已经有了：{'、'.join(sorted(taken))}")
    return replace(
        kept,
        columns=(*kept.columns, *made_columns),
        rows=tuple(
            (*row, *made[position]) for position, row in enumerate(kept.rows)
        ),
    )
