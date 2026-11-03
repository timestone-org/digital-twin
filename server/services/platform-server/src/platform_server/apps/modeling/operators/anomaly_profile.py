"""异常模型的纯数值校准表示与严格回灌。"""

from typing import Annotated, Literal, Self

import numpy as np
from pydantic import Field, FiniteFloat, model_validator

from platform_server.apps.modeling.operators.base import OperatorConfig
from platform_server.apps.modeling.operators.unsupervised_config import (
    AnomalyAlgorithm,
)
from platform_server.apps.modeling.operators.unsupervised_data import Matrix

type Positive = Annotated[FiniteFloat, Field(gt=0)]


class AnomalyProfile(OperatorConfig):
    """数值缩放、独立校准阈值与算法身份。"""

    format_version: Literal["1.0"] = "1.0"
    algorithm: AnomalyAlgorithm
    feature_keys: tuple[str, ...] = Field(min_length=1, max_length=16)
    center: dict[str, FiniteFloat]
    scale: dict[str, Positive]
    threshold_raw: FiniteFloat
    score_scale: Positive
    fit_rows: int = Field(ge=2)
    calibration_rows: int = Field(ge=1)
    constant_columns: tuple[str, ...] = ()

    @model_validator(mode="after")
    def coherent_columns(self) -> Self:
        keys = set(self.feature_keys)
        if len(keys) != len(self.feature_keys) or "" in keys:
            raise ValueError("异常模型特征列必须非空且不重复")
        if set(self.center) != keys or set(self.scale) != keys:
            raise ValueError("异常模型缩放参数与特征列不一致")
        constants = set(self.constant_columns)
        if (
            len(constants) != len(self.constant_columns)
            or not constants <= keys
        ):
            raise ValueError("常量列记录必须来自模型特征且不能重复")
        if constants == keys:
            raise ValueError("正常样本没有变化，无法建立可用异常模型")
        return self

    @property
    def active_positions(self) -> tuple[int, ...]:
        return tuple(
            seat
            for seat, key in enumerate(self.feature_keys)
            if key not in self.constant_columns
        )


def relative_scores(profile: AnomalyProfile, raw: Matrix) -> list[float]:
    """冻结阈值映射到1，越大越异常；Args: profile, raw。"""
    values = np.exp(
        np.clip((raw - profile.threshold_raw) / profile.score_scale, -30, 30)
    )
    return [float(value) for value in values]
