"""无监督样本切分与正常工况异常检测算子。"""

from itertools import pairwise
from typing import Any, Literal

from pydantic import Field, ValidationError

from platform_server.apps.modeling.operators.anomaly_stats import (
    DistanceProfile,
    FitOptions,
    fit_profile,
    score_frame,
)
from platform_server.apps.modeling.operators.base import (
    CONTRACT_FRAME,
    CONTRACT_METRICS,
    CONTRACT_MODEL,
    ColumnsByPort,
    OperatorBase,
    OperatorConfig,
    OperatorError,
    PortSpec,
)
from platform_server.apps.modeling.operators.frame import (
    Frame,
    FrameColumn,
    frame_input,
    select_rows,
    split_row_indices,
)
from platform_server.apps.modeling.operators.payloads import (
    MetricsPayload,
    ModelPayload,
)
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.reporting import (
    TIER_SMALL,
    BlockAt,
    ReportBlock,
    RowCounts,
    Scale,
    breakdown_block,
    rows_block,
)

TASK_ANOMALY = "anomaly_detection"
ANOMALY_THRESHOLD = 1.0
SCORE_KEY = "anomaly_score"
FLAG_KEY = "is_anomaly"


class SplitSamplesConfig(OperatorConfig):
    """无目标列的时序切分参数。"""

    method: Literal["time_order"] = Field(
        default="time_order",
        title="切分方式",
        description="time_order=按时间先后留出测试段",
        json_schema_extra={"enum": ["time_order"]},
    )
    test_ratio: float = Field(default=0.2, gt=0, lt=0.5, title="测试段比例")
    random_state: int = Field(
        default=42,
        ge=0,
        title="保留的随机种子",
        description="仅用于统一切分计划，时序切分不使用随机数",
    )
    min_test_rows: int = Field(
        default=20, ge=1, le=10000, title="测试段最少行数"
    )


@register_operator
class SplitSamples(OperatorBase):
    """无监督数据按时间顺序切分，不伪造目标列。"""

    CODE = "split_samples"
    NAME = "无监督样本切分"
    DESCRIPTION = "按时间顺序切出训练与测试段，不需要目标列"
    CATEGORY = "model"
    ICON = "layers"
    CONFIG_MODEL = SplitSamplesConfig
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME, label="样本"),)
    OUTPUTS = (
        PortSpec(name="train", contract=CONTRACT_FRAME, label="训练"),
        PortSpec(name="test", contract=CONTRACT_FRAME, label="测试"),
    )
    ENABLED_IN_SERVING = False
    CHANGES_ROW_COUNT = True
    PROVIDES_SPLIT_PLAN = True

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._split = SplitSamplesConfig.model_validate(config.model_dump())
        self._counts: tuple[int, int] | None = None

    def run(self, inputs: dict[str, object]) -> dict[str, Frame]:
        frame = frame_input(inputs, "frame")
        _check_order(frame)
        config = self._split
        train, test = split_row_indices(
            frame.row_count,
            method=config.method,
            test_ratio=config.test_ratio,
            random_state=config.random_state,
        )
        if len(test) < config.min_test_rows:
            raise OperatorError(
                f"测试段不足 {config.min_test_rows} 行，请增加正常工况样本"
            )
        self._counts = (len(train), len(test))
        return {
            "train": select_rows(frame, train),
            "test": select_rows(frame, test),
        }

    def report(self) -> tuple[ReportBlock, ...]:
        if self._counts is None:
            return ()
        train, test = self._counts
        return (
            rows_block(
                BlockAt(zone="step", title="无监督时序切分"),
                RowCounts(
                    before=train + test,
                    after=train + test,
                    ratio_actual=test / (train + test),
                ),
            ),
        )


class AnomalyDistanceConfig(OperatorConfig):
    """正常工况距离模型参数。"""

    quantile: float = Field(
        default=0.99,
        ge=0.95,
        le=0.9999,
        title="校准分位数",
        description="越高越宽松；它不是故障概率或准确率",
    )
    shrinkage: float = Field(
        default=0.05,
        ge=0.001,
        le=1.0,
        title="协方差收缩",
        description="避免强相关或常量传感器导致矩阵奇异",
    )
    scale_floor: float = Field(
        default=0.01,
        ge=1e-9,
        le=1e6,
        title="最小数值尺度",
        description="各列标准差的下限，常量列也可检测偏离；按传感器单位设置",
    )


@register_operator
class AnomalyDistance(OperatorBase):
    """学习正常工况的联合分布，返回可发布的异常分数模型。"""

    CODE = "anomaly_distance"
    NAME = "设备工况异常检测"
    DESCRIPTION = "用正常样本学习多变量关系，分数大于 1 判异常；无需故障标签"
    CATEGORY = "model"
    ICON = "activity"
    CONFIG_MODEL = AnomalyDistanceConfig
    INPUTS = (
        PortSpec(name="train", contract=CONTRACT_FRAME, label="正常训练样本"),
        PortSpec(name="test", contract=CONTRACT_FRAME, label="测试样本"),
    )
    OUTPUTS = (
        PortSpec(name="model", contract=CONTRACT_MODEL, label="模型"),
        PortSpec(name="scored", contract=CONTRACT_FRAME, label="异常判定"),
        PortSpec(name="metrics", contract=CONTRACT_METRICS, label="测试概况"),
    )
    REQUIRES_FIT = True
    SERVING_CHANNEL = "json"

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._anomaly = AnomalyDistanceConfig.model_validate(
            config.model_dump()
        )
        self._profile: DistanceProfile | None = None
        self._scores: list[float] | None = None

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        del config, inputs
        return {"scored": (SCORE_KEY, FLAG_KEY)}

    def run(self, inputs: dict[str, object]) -> dict[str, object]:
        train, test = frame_input(inputs, "train"), frame_input(inputs, "test")
        _check_pair(train, test)
        config = self._anomaly
        self._profile = fit_profile(
            train,
            FitOptions(config.quantile, config.shrinkage, config.scale_floor),
        )
        scores = self.predict_rows(test)
        self._scores = scores
        return {
            "model": ModelPayload(
                algo=self.CODE,
                task=TASK_ANOMALY,
                feature_keys=train.keys,
                target_key=None,
                hyper_params=config.model_dump(),
                fitted=self.dump_fitted(),
            ),
            "scored": Frame(
                columns=(
                    FrameColumn(key=SCORE_KEY, name="异常分数", dtype="number"),
                    FrameColumn(key=FLAG_KEY, name="是否异常", dtype="bool"),
                ),
                rows=tuple(
                    (score, score > ANOMALY_THRESHOLD) for score in scores
                ),
                index=test.index,
                provenance=test.provenance,
            ),
            "metrics": MetricsPayload(
                task=TASK_ANOMALY,
                metrics={
                    "test_rows": float(len(scores)),
                    "anomaly_rate": sum(
                        score > ANOMALY_THRESHOLD for score in scores
                    )
                    / len(scores),
                    "threshold": ANOMALY_THRESHOLD,
                },
            ),
        }

    def predict_rows(self, frame: Frame) -> list[float]:
        if self._profile is None:
            raise OperatorError("异常检测模型尚未训练")
        return score_frame(self._profile, frame)

    def dump_fitted(self) -> dict[str, Any]:
        return (
            {}
            if self._profile is None
            else self._profile.model_dump(mode="json")
        )

    def load_fitted(self, params: dict[str, Any]) -> None:
        self._profile = _load_profile(params)

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        _load_profile(params)

    def report(self) -> tuple[ReportBlock, ...]:
        scores = self._scores
        if scores is None:
            return ()
        anomalous = sum(score > ANOMALY_THRESHOLD for score in scores)
        items = [
            {"name": "未判异常", "value": len(scores) - anomalous},
            {"name": "判为异常", "value": anomalous},
        ]
        scale = Scale(
            label="分数大于 1 判异常；未提供故障标签，不能据此计算准确率",
            unit="行",
        )
        return (
            breakdown_block(
                BlockAt(zone="step", title="独立测试段异常判定"),
                scale,
                items,
            ),
            breakdown_block(
                BlockAt(
                    zone="charts",
                    title="测试段判定分布",
                    tier=TIER_SMALL,
                    is_primary=True,
                ),
                scale,
                items,
            ),
        )


def _load_profile(params: dict[str, Any]) -> DistanceProfile:
    try:
        return DistanceProfile.model_validate(params)
    except ValidationError as error:
        raise OperatorError(
            "异常检测拟合参数不完整或无效，请重新训练"
        ) from error


def _check_order(frame: Frame) -> None:
    if frame.index is None or len(frame.index) != frame.row_count:
        raise OperatorError("无监督时序切分需要每行的时间索引")
    if any(right <= left for left, right in pairwise(frame.index)):
        raise OperatorError("样本时刻必须唯一且严格递增")


def _check_pair(train: Frame, test: Frame) -> None:
    _check_order(train)
    _check_order(test)
    if not train.rows or not test.rows:
        raise OperatorError("训练和测试样本都不能为空")
    if train.keys != test.keys or any(
        column.role != "feature" for column in train.columns
    ):
        raise OperatorError("异常检测只接收相同列序的特征帧，不需要目标列")
    if (
        train.index is not None
        and test.index is not None
        and train.index[-1] >= test.index[0]
    ):
        raise OperatorError("测试样本必须晚于训练样本，不能重叠")
