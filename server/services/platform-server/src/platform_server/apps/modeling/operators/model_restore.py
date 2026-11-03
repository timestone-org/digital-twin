"""从冻结描述与已校验的模型本体恢复诊断预测器。"""

from platform_server.apps.modeling.operators.base import (
    CHANNEL_BINARY,
    OperatorBase,
    OperatorError,
)
from platform_server.apps.modeling.operators.payloads import ModelPayload
from platform_server.apps.modeling.operators.registry import registry


def restore_model(
    payload: ModelPayload, estimator: object | None
) -> OperatorBase:
    """恢复训练结果，不重新拟合；Args: payload, estimator。"""
    model, _ = registry.build(payload.algo, dict(payload.hyper_params))
    model.bind_runtime(tz_offset_minutes=0, split_plan=None)
    fitted = dict(payload.fitted)
    if payload.serving_channel == CHANNEL_BINARY:
        if estimator is None:
            raise OperatorError(
                "二进制模型缺少已校验的训练产物，无法计算特征重要性"
            )
        fitted.setdefault("feature_keys", list(payload.feature_keys))
    model.load_fitted(fitted)
    if payload.serving_channel == CHANNEL_BINARY and estimator is not None:
        model.attach_estimator(estimator)
    return model
