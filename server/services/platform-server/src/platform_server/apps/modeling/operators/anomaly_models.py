"""四种正常工况模型，内部留出校准并复用二进制发布通道。"""

from typing import Any

import numpy as np
from pydantic import ValidationError
from threadpoolctl import threadpool_limits

from platform_server.apps.modeling.operators.anomaly import (
    ANOMALY_THRESHOLD,
    FLAG_KEY,
    SCORE_KEY,
    TASK_ANOMALY,
)
from platform_server.apps.modeling.operators.anomaly_estimators import (
    ANOMALY_ROW_LIMITS,
    abnormality,
    create_anomaly,
    fit_anomaly,
    validate_anomaly_estimator,
)
from platform_server.apps.modeling.operators.anomaly_profile import (
    AnomalyProfile,
    relative_scores,
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
)
from platform_server.apps.modeling.operators.payloads import (
    MetricsPayload,
    ModelPayload,
)
from platform_server.apps.modeling.operators.registry import register_operator
from platform_server.apps.modeling.operators.reporting import (
    BlockAt,
    ReportBlock,
    Scale,
    annotated,
    breakdown_block,
    fits_block,
)
from platform_server.apps.modeling.operators.unsupervised_config import (
    AnomalyModelConfig,
)
from platform_server.apps.modeling.operators.unsupervised_data import (
    check_anomaly_pair,
    fit_scaling,
    numeric_matrix,
    scaled,
)


@register_operator
class AnomalyModel(OperatorBase):
    CODE = "anomaly_model"
    NAME = "通用异常检测模型"
    DESCRIPTION = (
        "孤立森林、局部离群、单类SVM或椭圆包络；"
        "正常训练段内校准，分数大于1判异常"
    )
    CATEGORY = "model"
    ICON = "activity"
    CONFIG_MODEL = AnomalyModelConfig
    MODEL_TASK = TASK_ANOMALY
    INPUTS = (
        PortSpec(name="train", contract=CONTRACT_FRAME, label="正常训练样本"),
        PortSpec(name="test", contract=CONTRACT_FRAME, label="独立测试样本"),
    )
    OUTPUTS = (
        PortSpec(name="model", contract=CONTRACT_MODEL, label="异常模型"),
        PortSpec(name="scored", contract=CONTRACT_FRAME, label="异常判定"),
        PortSpec(name="metrics", contract=CONTRACT_METRICS, label="测试概况"),
    )
    REQUIRES_FIT = True
    SERVING_CHANNEL = "binary"

    def __init__(self, config: OperatorConfig) -> None:
        super().__init__(config)
        self._anomaly = AnomalyModelConfig.model_validate(config.model_dump())
        self._profile: AnomalyProfile | None = None
        self._estimator: object | None = None
        self._scores: tuple[float, ...] | None = None

    @classmethod
    def describe_columns(
        cls, config: OperatorConfig, inputs: ColumnsByPort
    ) -> ColumnsByPort:
        del config, inputs
        return {"scored": (SCORE_KEY, FLAG_KEY)}

    def run(self, inputs: dict[str, object]) -> dict[str, object]:
        train, test = frame_input(inputs, "train"), frame_input(inputs, "test")
        check_anomaly_pair(
            train, test, ANOMALY_ROW_LIMITS[self._anomaly.algorithm]
        )
        numeric_matrix(test, test.keys)
        self._fit(train)
        scores = self.predict_rows(test)
        self._scores = tuple(scores)
        return {
            "model": ModelPayload(
                algo=self.CODE,
                task=TASK_ANOMALY,
                feature_keys=train.keys,
                target_key=None,
                hyper_params=self._anomaly.model_dump(),
                fitted=self.dump_fitted(),
                serving_channel=self.SERVING_CHANNEL,
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
                index_name=test.index_name,
                provenance=test.provenance,
            ),
            "metrics": MetricsPayload(
                task=TASK_ANOMALY, metrics=self._metrics(scores)
            ),
        }

    def _fit(self, train: Frame) -> None:
        config = self._anomaly
        rows = numeric_matrix(train, train.keys)
        cut = int(len(rows) * (1 - config.calibration_ratio))
        constants = tuple(
            key
            for seat, key in enumerate(train.keys)
            if np.ptp(rows[:cut, seat]) == 0
        )
        active = [
            seat for seat, key in enumerate(train.keys) if key not in constants
        ]
        if not active:
            raise OperatorError("正常样本没有变化，无法建立可用异常模型")
        center, scale = fit_scaling(rows[:cut], config.scale_floor)
        learned = scaled(rows[:cut], center, scale)[:, active]
        calibration = scaled(rows[cut:], center, scale)[:, active]
        try:
            with threadpool_limits(limits=1):
                estimator = create_anomaly(config, learned)
                fit_anomaly(estimator, learned)
                raw = abnormality(estimator, calibration)
        except (ValueError, np.linalg.LinAlgError) as error:
            raise OperatorError(
                "异常模型无法拟合当前样本，请检查样本数量、共线特征与算法参数"
            ) from error
        threshold = float(np.quantile(raw, config.quantile, method="higher"))
        score_scale = max(float(np.std(raw)), abs(threshold) * 1e-6, 1e-9)
        self._profile = AnomalyProfile(
            algorithm=config.algorithm,
            feature_keys=train.keys,
            center={
                key: float(center[seat]) for seat, key in enumerate(train.keys)
            },
            scale={
                key: float(scale[seat]) for seat, key in enumerate(train.keys)
            },
            threshold_raw=threshold,
            score_scale=score_scale,
            fit_rows=cut,
            calibration_rows=len(calibration),
            constant_columns=constants,
        )
        self._estimator = estimator

    def predict_rows(self, frame: Frame) -> list[float]:
        profile, estimator = self._profile, self._estimator
        if profile is None or estimator is None:
            raise OperatorError("异常模型尚未训练或本体尚未加载")
        if frame.keys != profile.feature_keys:
            raise OperatorError("异常模型输入列序与训练时不一致")
        rows = numeric_matrix(frame, profile.feature_keys)
        if not frame.rows:
            return []
        center = np.asarray(
            [profile.center[key] for key in profile.feature_keys],
            dtype=np.float64,
        )
        scale = np.asarray(
            [profile.scale[key] for key in profile.feature_keys],
            dtype=np.float64,
        )
        try:
            with threadpool_limits(limits=1):
                raw = abnormality(
                    estimator,
                    scaled(rows, center, scale)[:, profile.active_positions],
                )
        except ValueError as error:
            raise OperatorError(
                "异常模型无法判断此输入，请检查数值范围"
            ) from error
        return relative_scores(profile, raw)

    def trained_estimator(self) -> object | None:
        return self._estimator

    def attach_estimator(self, estimator: object) -> None:
        if self._profile is None:
            raise OperatorError("异常模型缺少冻结校准参数")
        validate_anomaly_estimator(
            estimator,
            self._profile.algorithm,
            len(self._profile.active_positions),
        )
        self._estimator = estimator

    def dump_fitted(self) -> dict[str, Any]:
        return (
            {}
            if self._profile is None
            else self._profile.model_dump(mode="json")
        )

    def load_fitted(self, params: dict[str, Any]) -> None:
        profile = _load_profile(params)
        if profile.algorithm != self._anomaly.algorithm:
            raise OperatorError("异常模型参数与算子算法不一致")
        self._profile = profile

    @classmethod
    def validate_fitted(cls, params: dict[str, Any]) -> None:
        _load_profile(params)

    def _metrics(self, scores: list[float]) -> dict[str, float | None]:
        profile = self._profile
        if profile is None:
            raise OperatorError("异常模型没有校准参数")
        return {
            "test_rows": float(len(scores)),
            "anomaly_rate": sum(score > 1 for score in scores) / len(scores),
            "threshold": 1.0,
            "fit_rows": float(profile.fit_rows),
            "calibration_rows": float(profile.calibration_rows),
            "raw_threshold": profile.threshold_raw,
            "score_scale": profile.score_scale,
            "calibration_quantile": self._anomaly.quantile,
        }

    def report(self) -> tuple[ReportBlock, ...]:
        profile, scores = self._profile, self._scores
        if profile is None:
            return ()
        fitted = self._fitted_report(profile)
        if scores is None:
            return (fitted,)
        anomalous = sum(score > 1 for score in scores)
        distribution = breakdown_block(
            BlockAt(
                zone="charts",
                title="独立测试段异常判定",
                port="scored",
                is_primary=True,
            ),
            Scale(label="分数大于1为异常；该分数不是概率", unit="行"),
            [
                {"name": "未判异常", "value": len(scores) - anomalous},
                {"name": "判为异常", "value": anomalous},
            ],
        )
        return (
            annotated(
                distribution,
                "alert",
                ["没有故障标签，异常率不代表准确率；模型不会在调用时自学习"],
            ),
            fitted,
        )

    def _fitted_report(self, profile: AnomalyProfile) -> ReportBlock:
        fitted = fits_block(
            BlockAt(zone="step", title="正常拟合与内部留出校准", port="model"),
            method=self._anomaly.algorithm,
            train_rows=profile.fit_rows,
            total_rows=profile.fit_rows + profile.calibration_rows,
            by_column=[
                {
                    "key": key,
                    "mean": profile.center[key],
                    "std": profile.scale[key],
                }
                for key in profile.feature_keys
            ],
        )
        fitted = annotated(
            fitted,
            "hint",
            [
                "拟合段学习缩放与模型，内部后段只校准阈值，独立测试段不参与拟合或校准"
            ],
        )
        if profile.constant_columns:
            names = "、".join(profile.constant_columns[:8])
            note = (
                f"拟合段没有变化的列（{names}，共{len(profile.constant_columns)}列）"
                "不参与拟合或异常评分；模型不保证检测这些列的任意偏离，"
                "请补充有变化的正常样本"
            )
            fitted = annotated(fitted, "alert", [note])
        return fitted


def _load_profile(params: dict[str, Any]) -> AnomalyProfile:
    try:
        return AnomalyProfile.model_validate(params)
    except ValidationError as error:
        raise OperatorError(
            "异常模型的冻结校准参数不完整或无效，请重新训练"
        ) from error
