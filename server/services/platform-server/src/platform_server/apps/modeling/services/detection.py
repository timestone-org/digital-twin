"""第三方设备检测，复用账号鉴权、部署配额、推理与调用记录。"""

import math
import time
from dataclasses import replace

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError
from platform_server.apps.modeling.errors import (
    DeploymentUnservable,
    PredictRequestInvalid,
)
from platform_server.apps.modeling.operators.anomaly import (
    ANOMALY_THRESHOLD,
    TASK_ANOMALY,
)
from platform_server.apps.modeling.operators.anomaly_stats import MAX_VALUE
from platform_server.apps.modeling.schemas import OpenModelPredictIn
from platform_server.apps.modeling.schemas.detection import (
    AnomalyDecisionOut,
    OpenModelDetectIn,
    OpenModelDetectOut,
)
from platform_server.apps.modeling.services import open_model_service
from platform_server.apps.modeling.services.jsonshape import as_dict, as_list
from platform_server.apps.modeling.services.open_model_service import (
    HTTP_OK,
    TIMESTAMP_KEY,
    OpenModelDeps,
    ResolvedCall,
)


async def detect(
    session: AsyncSession,
    *,
    deps: OpenModelDeps,
    resolved: ResolvedCall,
    payload: OpenModelDetectIn,
) -> OpenModelDetectOut:
    """校验后推理并返回判定，整段只记一条调用记录。

    ⚠ 校验与判定都包在记录里：校验失败不记会少算 4xx，先记成功再判不出分数
    会把 503 记成成功。
    Args: session, deps, resolved, payload。
    """
    started = time.monotonic()
    counted = replace(resolved, row_count=len(payload.rows))
    try:
        answer = await _detected(session, deps, counted, payload)
    except AppError as error:
        await open_model_service.record_call(
            deps, counted, started, error.http_status, error.code
        )
        raise
    await open_model_service.record_call(deps, counted, started, HTTP_OK, None)
    return answer


async def _detected(
    session: AsyncSession,
    deps: OpenModelDeps,
    resolved: ResolvedCall,
    payload: OpenModelDetectIn,
) -> OpenModelDetectOut:
    """校验、推理、判定。Args: session, deps, resolved, payload。"""
    if resolved.version.task != TASK_ANOMALY:
        raise PredictRequestInvalid(
            "这个模型不是异常检测模型，请选择异常检测版本"
        )
    _validate_rows(payload, resolved)
    answer = await open_model_service.predict(
        session,
        deps=deps,
        resolved=resolved,
        payload=OpenModelPredictIn.model_validate(payload.model_dump()),
    )
    return OpenModelDetectOut(
        model=answer.model,
        results=[
            _decision(seat, score)
            for seat, score in enumerate(answer.predictions)
        ],
        warnings=answer.warnings,
    )


def _validate_rows(payload: OpenModelDetectIn, resolved: ResolvedCall) -> None:
    inputs = [
        as_dict(item)
        for item in as_list(resolved.version.signature_json.get("inputs"))
    ]
    keys = {str(column["key"]) for column in inputs}
    if not keys:
        raise DeploymentUnservable("异常检测模型缺少输入签名，请重新发布")
    for seat, row in enumerate(payload.rows):
        if set(row) - keys - {TIMESTAMP_KEY}:
            raise PredictRequestInvalid(
                f"第 {seat + 1} 行包含模型签名之外的字段"
            )
        for key in keys:
            value = row.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise PredictRequestInvalid(
                    f"第 {seat + 1} 行的「{key}」必须提供数值，不能缺失或为空"
                )
            if abs(value) > MAX_VALUE or not math.isfinite(value):
                raise PredictRequestInvalid(
                    f"第 {seat + 1} 行的「{key}」不是受支持的有限数值"
                )


def _decision(row: int, score: float | None) -> AnomalyDecisionOut:
    if score is None or not math.isfinite(score):
        raise DeploymentUnservable("模型未产生有效异常分数，无法判断本次输入")
    return AnomalyDecisionOut(
        row=row,
        is_anomaly=score > ANOMALY_THRESHOLD,
        score=score,
        threshold=ANOMALY_THRESHOLD,
    )
