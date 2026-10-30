"""模型对外调用的部署校验、账号配额与计算记录；见 ADR-0062。"""

import time
import uuid
from dataclasses import dataclass, field, replace
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from lib.cache import Cache
from lib.errors import AppError, RateLimited
from lib.logging import get_logger
from lib.logging.context import current_log_context
from lib.objectstore import ObjectStore
from lib.ratelimit import FixedWindowLimiter
from lib.utils.timeutils import to_utc
from platform_server.apps.modeling.command_errors import ModelingRateLimited
from platform_server.apps.modeling.crud import (
    call_log_crud,
    deployment_crud,
    model_artifact_crud,
    model_version_crud,
)
from platform_server.apps.modeling.errors import (
    DeploymentDisabled,
    DeploymentNotFound,
    DeploymentUnservable,
    PredictRequestInvalid,
)
from platform_server.apps.modeling.models import (
    ModelingCallLog,
    ModelingDeployment,
    ModelVersion,
)
from platform_server.apps.modeling.operators import (
    CHANNEL_BINARY,
    OperatorError,
)
from platform_server.apps.modeling.schemas import (
    OpenModelInfoOut,
    OpenModelPredictIn,
    OpenModelPredictOut,
    OpenModelRow,
    OpenModelWarningOut,
)
from platform_server.apps.modeling.services import artifact_io
from platform_server.apps.modeling.services.artifact_store import (
    ArtifactRejected,
)
from platform_server.apps.modeling.services.jsonshape import as_dict, as_list
from platform_server.apps.modeling.services.serving import (
    CompiledModel,
    compile_model,
)
from platform_server.apps.modeling.services.sessions import Sessions

_logger = get_logger("platform.modeling.open")

# 请求体里那一格保留键：这一行的时刻。带时间特征的模型没它算不出来
TIMESTAMP_KEY = "__ts__"
# 账号与部署的配额窗口
RATE_NAMESPACE = "open_model_account"
RATE_WINDOW_S = 60
# 成功那一次记进调用记录的状态码
HTTP_OK = 200
# 超出训练区间的告警种类
OUT_OF_RANGE = "out_of_training_range"


@dataclass(frozen=True)
class ResolvedCall:
    """一次通过了鉴权的调用。"""

    deployment: ModelingDeployment
    version: ModelVersion
    user_id: uuid.UUID
    #: 这次请求带了几行。记录里只留这个数，不留内容
    row_count: int = 0
    external_operator_id: str | None = None


@dataclass(frozen=True)
class OpenModelDeps:
    """对外面要的外部件。打成一包是因为形参上限是 5。"""

    cache: Cache
    #: ⚠ 调用记录要走**自己的**事务：请求那条在出错时会整个回滚，
    #: 而「这次调用失败了」恰恰是最该留下来的那一条
    sessions: Sessions
    store: ObjectStore | None = None
    artifacts: artifact_io.ArtifactCache = field(
        default_factory=artifact_io.ArtifactCache
    )


async def resolve_call(
    session: AsyncSession, *, code: str, user_id: uuid.UUID
) -> ResolvedCall:
    """为已认证账号解析可用部署。Args: session, code, user_id。"""
    deployment = await deployment_crud.get_by_code(session, code)
    if deployment is None:
        raise DeploymentNotFound("这个模型服务不存在")
    if not deployment.is_enabled:
        raise DeploymentDisabled("这个模型服务已停用")
    version = await model_version_crud.get(
        session, deployment.effective_version_id
    )
    if version is None:  # pragma: no cover —— 外键是 RESTRICT
        raise DeploymentUnservable("这个模型服务钉的版本已不存在")
    if not version.servable:
        raise DeploymentUnservable(
            version.unservable_reason or "这个模型版本不可上线"
        )
    return ResolvedCall(deployment=deployment, version=version, user_id=user_id)


async def guard_rate(
    deps: OpenModelDeps, resolved: ResolvedCall
) -> ResolvedCall:
    """按部署与账号计配额。Args: deps, resolved。"""
    limiter = FixedWindowLimiter(
        cache=deps.cache,
        namespace=RATE_NAMESPACE,
        limit=resolved.deployment.rate_limit_per_minute,
        window_s=RATE_WINDOW_S,
        message="调用过于频繁，请稍后再试",
    )
    try:
        await limiter.hit(f"{resolved.deployment.id}:{resolved.user_id}")
    except RateLimited as error:
        raise ModelingRateLimited(error.message, RATE_WINDOW_S) from error
    return resolved


async def predict_and_record(
    session: AsyncSession,
    *,
    deps: OpenModelDeps,
    resolved: ResolvedCall,
    payload: OpenModelPredictIn,
) -> OpenModelPredictOut:
    """算一批数，无论成败都记一条调用记录。

    ⚠ 记录走**自己的**事务：请求那条在出错时会整个回滚，而「这次调用失败了」
    恰恰是最该留下来的那一条。
    ⚠ 鉴权与限流那几种失败**不记**：它们在 `resolve_call` 里就被拒了，还没
    归到任何一个部署的账上；而记下来正好给了未授权的调用者一个撑爆这张表的
    办法（防线 ⑬）。
    Args: session, deps, resolved, payload。
    """
    started = time.monotonic()
    counted = replace(resolved, row_count=len(payload.rows))
    try:
        answer = await predict(
            session, deps=deps, resolved=counted, payload=payload
        )
    except AppError as error:
        await record_call(deps, counted, started, error.http_status, error.code)
        raise
    await record_call(deps, counted, started, HTTP_OK, None)
    return answer


async def record_call(
    deps: OpenModelDeps,
    resolved: ResolvedCall,
    started: float,
    status: int,
    error_code: int | None,
) -> None:
    """使用独立事务记录调用结果。

    Args: deps, resolved, started, status, error_code。
    """
    duration_ms = int((time.monotonic() - started) * 1000)
    try:
        async with deps.sessions.session() as session:
            call_log_crud.add(
                session,
                ModelingCallLog(
                    deployment_id=resolved.deployment.id,
                    api_key_id=None,
                    account_user_id=resolved.user_id,
                    external_operator_id=resolved.external_operator_id,
                    trace_id=current_log_context().trace_id or "",
                    row_count=resolved.row_count,
                    duration_ms=duration_ms,
                    status=status,
                    error_code=error_code,
                ),
            )
    except Exception as error:
        # ⚠ 记不上不许把这次调用拖垮：数已经算出来了，记录只是给运维看的账
        _logger.warning(
            "modeling_call_log_failed",
            "对外调用记录没写上",
            deployment_id=str(resolved.deployment.id),
            error=error,
        )


async def predict(
    session: AsyncSession,
    *,
    deps: OpenModelDeps,
    resolved: ResolvedCall,
    payload: OpenModelPredictIn,
) -> OpenModelPredictOut:
    """算一批数。

    ⚠ 整批一次算完（`predict_many`），不逐行调：通道 B 逐行调等于逐行付一次
    到 C 的往返。
    Args: session, deps, resolved, payload。
    """
    if resolved.version.task == "rule_calculation":
        raise PredictRequestInvalid(
            "规则模型返回结构化结果，请通过 :calculate 接口调用"
        )
    if len(payload.rows) > resolved.deployment.max_rows_per_call:
        raise PredictRequestInvalid(
            f"一次最多算 {resolved.deployment.max_rows_per_call} 行，"
            f"这次给了 {len(payload.rows)} 行"
        )
    compiled = await _compiled(session, deps, resolved.version)
    entry = _entry_of(resolved.version)
    rows = [
        _as_args(row, entry, index) for index, row in enumerate(payload.rows)
    ]
    try:
        predictions = compiled.predict_many(rows)
    except OperatorError as error:
        raise PredictRequestInvalid(str(error)) from error
    return OpenModelPredictOut(
        model=OpenModelInfoOut(
            code=resolved.deployment.code, version=resolved.version.version
        ),
        predictions=predictions,
        warnings=_warnings_of(payload.rows, resolved.version),
    )


async def _compiled(
    session: AsyncSession, deps: OpenModelDeps, version: ModelVersion
) -> CompiledModel:
    """把版本编译成可调用对象，通道 B 顺带把模型本体装回来。

    Args: session, deps, version。
    """
    try:
        return compile_model(
            dict(version.serving_json),
            estimator=await _estimator(session, deps, version),
        )
    except (ArtifactRejected, OperatorError) as error:
        raise DeploymentUnservable(str(error)) from error


async def _estimator(
    session: AsyncSession, deps: OpenModelDeps, version: ModelVersion
) -> object | None:
    """通道 B 的模型本体；通道 A 给 `None`。

    Args: session, deps, version。
    """
    if version.serving_channel != CHANNEL_BINARY:
        return None
    if deps.store is None:
        raise ArtifactRejected("本部署没有配对象存储，这个模型用不了")
    row = await model_artifact_crud.get_by_version(session, version.id)
    if row is None:
        raise ArtifactRejected("这个模型版本没有留下模型产物")
    return await artifact_io.fetch(
        deps.store,
        {
            "object_key": row.object_key,
            "digest": row.digest,
            "format_version": row.format_version,
            "runtime": dict(row.runtime_json),
        },
        deps.artifacts,
    )


def _entry_of(version: ModelVersion) -> list[dict[str, object]]:
    """这个版本的入口契约，逐列。

    Args: version。
    """
    return [
        as_dict(item)
        for item in as_list(dict(version.signature_json).get("inputs"))
    ]


def _as_args(
    row: OpenModelRow, entry: list[dict[str, object]], index: int
) -> tuple[list[float | None], datetime | None]:
    """把一行请求摆成「按序的实参 + 这一行的时刻」。

    ⚠ 实参**按入口契约的顺序**取，不按请求里键的顺序：JSON 对象无序，
    按请求顺序取就是把甲的值喂给乙，而结果看着完全正常（D5）。
    Args: row, entry, index。
    """
    args: list[float | None] = []
    for column in entry:
        key = str(column.get("key") or "")
        if key not in row and column.get("is_required"):
            raise PredictRequestInvalid(f"第 {index + 1} 行缺少「{key}」")
        args.append(_as_number(row.get(key), key, index))
    return args, _row_moment(row, index)


def _as_number(value: object, key: str, index: int) -> float | None:
    """一格值。空就是空，不是数就当场拒。

    ⚠ 不做「字符串转数」：'1,234' 这类值转出来是别的数，而调用方不会发现。
    Args: value, key, index。
    """
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PredictRequestInvalid(f"第 {index + 1} 行的「{key}」不是一个数")
    return float(value)


def _row_moment(row: OpenModelRow, index: int) -> datetime | None:
    """这一行的时刻。没给就是没有。

    Args: row, index。
    """
    raw = row.get(TIMESTAMP_KEY)
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise PredictRequestInvalid(
            f"第 {index + 1} 行的「{TIMESTAMP_KEY}」要一个 RFC3339 时刻"
        )
    try:
        return to_utc(datetime.fromisoformat(raw))
    except ValueError as error:
        raise PredictRequestInvalid(
            f"第 {index + 1} 行的「{TIMESTAMP_KEY}」不是一个 RFC3339 时刻"
        ) from error


def _warnings_of(
    rows: list[OpenModelRow], version: ModelVersion
) -> list[OpenModelWarningOut]:
    """逐行逐列看有没有超出训练区间。

    ⚠ 只说「超了」，**不回区间的具体数值**：那是训练数据的分布，属于内部信息
    （D8、防线 ⑩）。树模型尤其要说——它不外推，区间之外一律给边界值，
    而那个数看着完全正常。
    Args: rows, version。
    """
    found: list[OpenModelWarningOut] = []
    for index, row in enumerate(rows):
        for column in _entry_of(version):
            key = str(column.get("key") or "")
            stats = as_dict(column.get("training_stats"))
            if _is_outside(row.get(key), stats):
                found.append(
                    OpenModelWarningOut(
                        row=index,
                        column=key,
                        kind=OUT_OF_RANGE,
                        message="这一路输入超出训练区间，属于外推",
                    )
                )
    return found


def _is_outside(value: object, bounds: dict[str, object]) -> bool:
    """这个值在不在训练区间内。区间缺失时一律当作「在」。

    Args: value, bounds。
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    low = bounds.get("min")
    high = bounds.get("max")
    if not isinstance(low, (int, float)) or not isinstance(high, (int, float)):
        return False
    return value < float(low) or value > float(high)


def public_signature(version: ModelVersion) -> dict[str, object]:
    """对外那份模型签名：**剥掉训练统计**。

    ⚠ 训练区间的具体数值是训练数据的分布，属于内部信息（D8、防线 ⑩）。
    超区间只在告警里说「超了」，不说超的是什么范围。
    Args: version。
    """
    signature = dict(version.signature_json)
    signature["inputs"] = [
        {
            key: value
            for key, value in as_dict(item).items()
            if key != "training_stats"
        }
        for item in as_list(signature.get("inputs"))
    ]
    return signature
