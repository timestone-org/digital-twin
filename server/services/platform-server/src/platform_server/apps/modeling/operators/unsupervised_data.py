"""无监督算子的有限数值、样本分段与缩放参数。"""

import math
from itertools import pairwise

import numpy as np
from numpy.typing import NDArray

from platform_server.apps.modeling.operators.base import OperatorError
from platform_server.apps.modeling.operators.frame import (
    DTYPE_NUMBER,
    ROLE_FEATURE,
    Frame,
    matrix_of,
)

MAX_UNSUPERVISED_VALUE = 1e100
MAX_SCALED_VALUE = 1e30
MIN_ANOMALY_TRAIN_ROWS = 80
MAX_ANOMALY_FEATURES = 16
type Matrix = NDArray[np.float64]


def numeric_matrix(frame: Frame, keys: tuple[str, ...]) -> Matrix:
    """拒绝缺失、布尔值、非有限数与不可信类型；Args: frame, keys。"""
    if not keys or len(set(keys)) != len(keys):
        raise OperatorError("数值特征列必须非空且不重复")
    for key in keys:
        if frame.column_of(key).dtype != DTYPE_NUMBER:
            raise OperatorError(f"列「{key}」不是数值列")
        for value in frame.values_of(key):
            if isinstance(value, bool) or not isinstance(value, (float, int)):
                raise OperatorError(f"列「{key}」含有缺失或非数值，请先处理")
            if not math.isfinite(value) or abs(value) > MAX_UNSUPERVISED_VALUE:
                raise OperatorError(f"列「{key}」含有非有限数或过大数值")
    return np.asarray(matrix_of(frame, keys), dtype=np.float64)


def fit_scaling(rows: Matrix, floor: float) -> tuple[Matrix, Matrix]:
    center = np.mean(rows, axis=0)
    scale = np.maximum(np.std(rows, axis=0), floor)
    if not np.isfinite(center).all() or not np.isfinite(scale).all():
        raise OperatorError("无法得到有限的数值尺度，请调整数据单位")
    return center, scale


def scaled(rows: Matrix, center: Matrix, scale: Matrix) -> Matrix:
    result = np.asarray((rows - center) / scale, dtype=np.float64)
    if (
        not np.isfinite(result).all()
        or np.max(np.abs(result)) > MAX_SCALED_VALUE
    ):
        raise OperatorError("标准化后的数值过大，请检查单位、常量列或异常输入")
    return result


def check_anomaly_pair(train: Frame, test: Frame, limit: int) -> None:
    """校验正常样本与独立测试段；Args: train, test, limit。"""
    if train.row_count < MIN_ANOMALY_TRAIN_ROWS or not test.rows:
        raise OperatorError("异常模型需要至少80行正常训练样本及非空测试段")
    if train.row_count > limit or test.row_count > limit:
        raise OperatorError(f"此异常算法每个输入最多{limit}行，请先显式抽样")
    if not 1 <= len(train.columns) <= MAX_ANOMALY_FEATURES:
        raise OperatorError("异常模型需要1到16个数值特征")
    if train.keys != test.keys or any(
        column.role != ROLE_FEATURE
        for column in (*train.columns, *test.columns)
    ):
        raise OperatorError("异常模型只接受同列序的数值特征帧，不需要目标列")
    for frame in (train, test):
        if frame.index is None or len(frame.index) != frame.row_count:
            raise OperatorError("正常训练与测试样本都需要时间索引")
        if any(right <= left for left, right in pairwise(frame.index)):
            raise OperatorError("样本时刻必须唯一且严格递增")
    if (
        train.index is not None
        and test.index is not None
        and train.index[-1] >= test.index[0]
    ):
        raise OperatorError("测试段必须晚于训练段，不能重叠")
