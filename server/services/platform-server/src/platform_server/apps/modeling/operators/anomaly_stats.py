"""正常工况的收缩协方差、校准与有界纯数值推理。"""

import math
from dataclasses import dataclass
from typing import Self

import numpy as np
from pydantic import Field, FiniteFloat, model_validator

from platform_server.apps.modeling.operators.base import (
    OperatorConfig,
    OperatorError,
)
from platform_server.apps.modeling.operators.frame import Frame, matrix_of

MAX_FEATURES = 16
MIN_TRAIN_ROWS = 80
MAX_VALUE = 1e100


class DistanceProfile(OperatorConfig):
    """按列名保存的正常工况参数与平方距离阈值。"""

    feature_keys: tuple[str, ...] = Field(min_length=1, max_length=MAX_FEATURES)
    center: dict[str, FiniteFloat]
    scale: dict[str, FiniteFloat]
    precision: dict[str, dict[str, FiniteFloat]]
    distance_threshold: FiniteFloat = Field(gt=0)

    @model_validator(mode="after")
    def coherent_parameters(self) -> Self:
        keys = set(self.feature_keys)
        if len(keys) != len(self.feature_keys) or "" in keys:
            raise ValueError("特征列必须非空且不重复")
        if any(
            set(part) != keys
            for part in (self.center, self.scale, self.precision)
        ):
            raise ValueError("正常工况参数的列名不一致")
        if any(value <= 0 for value in self.scale.values()):
            raise ValueError("数值尺度必须大于零")
        if any(set(row) != keys for row in self.precision.values()):
            raise ValueError("精度矩阵的列名不完整")
        matrix = np.asarray(
            [
                [self.precision[key][other] for other in self.feature_keys]
                for key in self.feature_keys
            ]
        )
        if not np.allclose(matrix, matrix.T, rtol=1e-10, atol=1e-12):
            raise ValueError("精度矩阵必须对称")
        try:
            np.linalg.cholesky(matrix)
        except np.linalg.LinAlgError as error:
            raise ValueError("精度矩阵必须正定") from error
        return self


@dataclass(frozen=True)
class FitOptions:
    """距离模型拟合口径。"""

    quantile: float
    shrinkage: float
    scale_floor: float


def checked_matrix(frame: Frame, keys: tuple[str, ...]) -> list[list[float]]:
    rows = matrix_of(frame, keys)
    if any(
        not math.isfinite(value) or abs(value) > MAX_VALUE
        for row in rows
        for value in row
    ):
        raise OperatorError("设备数据包含非有限数或超出支持范围的数值")
    return rows


def fit_profile(frame: Frame, options: FitOptions) -> DistanceProfile:
    """前 75% 拟合，后 25% 校准，测试帧不参与。Args: frame, options。"""
    if not 1 <= len(frame.columns) <= MAX_FEATURES:
        raise OperatorError(f"异常检测需要 1 到 {MAX_FEATURES} 个数值特征")
    if frame.row_count < MIN_TRAIN_ROWS:
        raise OperatorError(f"训练帧至少需要 {MIN_TRAIN_ROWS} 行正常工况样本")
    rows = checked_matrix(frame, frame.keys)
    cut = frame.row_count * 3 // 4
    learned = np.asarray(rows[:cut], dtype=np.float64)
    center = learned.mean(axis=0)
    scale = np.maximum(learned.std(axis=0), options.scale_floor)
    normalized = (learned - center) / scale
    covariance = normalized.T @ normalized / len(learned)
    covariance = (
        1 - options.shrinkage
    ) * covariance + options.shrinkage * np.eye(len(frame.keys))
    precision = np.linalg.inv(covariance)
    profile = DistanceProfile(
        feature_keys=frame.keys,
        center={
            key: float(center[seat]) for seat, key in enumerate(frame.keys)
        },
        scale={key: float(scale[seat]) for seat, key in enumerate(frame.keys)},
        precision={
            key: {
                other: float(precision[seat, column])
                for column, other in enumerate(frame.keys)
            }
            for seat, key in enumerate(frame.keys)
        },
        distance_threshold=1.0,
    )
    calibration = [score_row(profile, row) for row in rows[cut:]]
    threshold = max(
        1.0, float(np.quantile(calibration, options.quantile, method="higher"))
    )
    return profile.model_copy(update={"distance_threshold": threshold})


def score_row(profile: DistanceProfile, row: list[float]) -> float:
    """计算相对阈值的平方马氏距离。Args: profile, row。"""
    keys = profile.feature_keys
    if len(row) != len(keys):
        raise OperatorError("异常检测输入列数不一致")
    delta = {
        key: (value - profile.center[key]) / profile.scale[key]
        for key, value in zip(keys, row, strict=True)
    }
    distance = math.fsum(
        delta[key] * profile.precision[key][other] * delta[other]
        for key in keys
        for other in keys
    )
    score = max(0.0, distance) / profile.distance_threshold
    if not math.isfinite(score):
        raise OperatorError("异常分数超出支持范围，请检查输入量纲和数值")
    return score


def score_frame(profile: DistanceProfile, frame: Frame) -> list[float]:
    return [
        score_row(profile, row)
        for row in checked_matrix(frame, profile.feature_keys)
    ]
