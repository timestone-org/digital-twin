"""第三方规则计算，复用部署密钥、限额与调用记录。"""

import re
import time
from collections.abc import Mapping
from dataclasses import replace

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError
from platform_server.apps.modeling.errors import (
    DeploymentUnservable,
    PredictRequestInvalid,
)
from platform_server.apps.modeling.operators import OperatorError
from platform_server.apps.modeling.operators.energy_rule_math import number_of
from platform_server.apps.modeling.schemas.calculation import (
    OpenModelCalculateIn,
    OpenModelCalculateOut,
)
from platform_server.apps.modeling.schemas.deployment import OpenModelInfoOut
from platform_server.apps.modeling.services import open_model_service
from platform_server.apps.modeling.services.jsonshape import as_dict, as_list
from platform_server.apps.modeling.services.open_model_service import (
    OpenModelDeps,
    ResolvedCall,
)
from platform_server.apps.modeling.services.serving import compile_model

DECIMAL_PATTERN = re.compile(
    r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$"
)


async def calculate_and_record(
    session: AsyncSession,
    *,
    deps: OpenModelDeps,
    resolved: ResolvedCall,
    payload: OpenModelCalculateIn,
) -> OpenModelCalculateOut:
    """校验、执行并登记调用状态。Args: session, deps, resolved, payload。"""
    del session
    started = time.monotonic()
    counted = replace(resolved, row_count=len(payload.rows))
    try:
        answer = _calculate(counted, payload)
    except AppError as error:
        await open_model_service.record_call(
            deps, counted, started, error.http_status, error.code
        )
        raise
    await open_model_service.record_call(deps, counted, started, 200, None)
    return answer


def _calculate(
    resolved: ResolvedCall, payload: OpenModelCalculateIn
) -> OpenModelCalculateOut:
    """规则输入只接受完整数值并返回结构化结果。Args: resolved, payload。"""
    if resolved.version.task != "rule_calculation":
        raise PredictRequestInvalid("这个模型不是规则计算模型")
    if len(payload.rows) > resolved.deployment.max_rows_per_call:
        raise PredictRequestInvalid(
            f"一次最多计算 {resolved.deployment.max_rows_per_call} 行"
        )
    entry = [
        as_dict(item)
        for item in as_list(resolved.version.signature_json.get("inputs"))
    ]
    keys = tuple(str(column["key"]) for column in entry)
    if not keys:
        raise DeploymentUnservable("规则模型缺少输入签名，请重新发布")
    try:
        rows = [
            _arguments(row, keys, seat) for seat, row in enumerate(payload.rows)
        ]
        compiled = compile_model(dict(resolved.version.serving_json))
        results = compiled.calculate_many([(row, None) for row in rows])
    except OperatorError as error:
        raise PredictRequestInvalid(str(error)) from error
    return OpenModelCalculateOut.model_validate(
        {
            "model": OpenModelInfoOut(
                code=resolved.deployment.code, version=resolved.version.version
            ),
            "results": results,
        }
    )


def _arguments(
    row: Mapping[str, object], keys: tuple[str, ...], seat: int
) -> list[float | str]:
    """输入按发布列序摆放，拒绝缺失与额外字段。Args: row, keys, seat。"""
    if set(row) - set(keys):
        raise PredictRequestInvalid(f"第 {seat + 1} 行包含模型签名之外的字段")
    values: list[float | str] = []
    for key in keys:
        value = row.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float, str)):
            raise PredictRequestInvalid(
                f"第 {seat + 1} 行的「{key}」必须提供数值，不能缺失或为空"
            )
        if isinstance(value, str) and not DECIMAL_PATTERN.fullmatch(value):
            raise PredictRequestInvalid(
                f"第 {seat + 1} 行的「{key}」不是有效十进制数值"
            )
        values.append(str(number_of(row, key)))
    return values
