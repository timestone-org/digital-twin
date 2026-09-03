"""对外推理面：认密钥、限流、算一批数。

⚠ 这是本模块**唯一匿名可达**的入口（真正的匿名性由边缘那条免认证 location
保证）。四条纪律，一条都不许松（docs/MODELING_PLATFORM_DESIGN.md D15）：
- 密钥校验失败一律 401 +「密钥无效」四个字，**不区分**「不存在」「已撤销」
  「已过期」——区分等于送一个枚举接口；
- 密钥不进日志、不进 URL、不进错误信息；
- 入参不进日志（那是业务数据），排查靠 `trace_id` + 行数 + 耗时；
- 停用即 403、版本不可服务即 410，绝不静默用旧值。
"""

import time
import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from lib.cache import Cache
from lib.errors import AppError
from lib.logging import get_logger
from lib.objectstore import ObjectStore
from lib.ratelimit import FixedWindowLimiter
from lib.utils.timeutils import to_utc
from platform_server.apps.modeling.crud import (
    api_key_crud,
    call_log_crud,
    deployment_crud,
    model_artifact_crud,
    model_version_crud,
)
from platform_server.apps.modeling.errors import (
    ApiKeyInvalid,
    DeploymentDisabled,
    DeploymentNotFound,
    DeploymentUnservable,
    PredictRequestInvalid,
)
from platform_server.apps.modeling.models import (
    ModelingApiKey,
    ModelingCallLog,
    ModelingDeployment,
    ModelingModelVersion,
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
from platform_server.apps.modeling.services import api_key, artifact_io
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
# 限流的窗口与命名空间。⚠ 服务侧这一层按**密钥**限，边缘那层按来源 IP 限；
# 只有边缘那层的话，一把密钥换台机器就绕过去了（防线 ⑬）
RATE_NAMESPACE = "open_model"
RATE_WINDOW_S = 60
# 密钥无效时对外只说这四个字
INVALID_KEY_MESSAGE = "密钥无效"
# 成功那一次记进调用记录的状态码
HTTP_OK = 200
# 超出训练区间的告警种类
OUT_OF_RANGE = "out_of_training_range"


@dataclass(frozen=True)
class ResolvedCall:
    """一次通过了鉴权的调用。"""

    deployment: ModelingDeployment
    version: ModelingModelVersion
    api_key_id: uuid.UUID
    #: 这把钥匙在当前这一分钟里的第几次调用。1 表示这一分钟的头一次
    hits_in_window: int = 1
    #: 这次请求带了几行。记录里只留这个数，不留内容
    row_count: int = 0


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
    session: AsyncSession, *, code: str, presented_key: str
) -> ResolvedCall:
    """认一次调用：部署在不在、密钥对不对、版本能不能用。

    ⚠ 顺序是**先认密钥、再看部署状态**：反过来的话，不带密钥的人也能靠状态码
    区分出「这个 code 存在但停用了」与「这个 code 不存在」。
    Args: session, code, presented_key。
    """
    deployment = await deployment_crud.get_by_code(session, code)
    if deployment is None:
        raise DeploymentNotFound("这个模型服务不存在")
    key = await _verified_key(session, deployment.id, presented_key)
    if not deployment.is_enabled:
        raise DeploymentDisabled("这个模型服务已停用")
    version = await model_version_crud.get(session, deployment.model_version_id)
    if version is None:  # pragma: no cover —— 外键是 RESTRICT
        raise DeploymentUnservable("这个模型服务钉的版本已不存在")
    if not version.servable:
        raise DeploymentUnservable(
            version.unservable_reason or "这个模型版本不可上线"
        )
    return ResolvedCall(
        deployment=deployment, version=version, api_key_id=key.id
    )


async def _verified_key(
    session: AsyncSession, deployment_id: uuid.UUID, presented: str
) -> ModelingApiKey:
    """按摘要点查那一把，逐条核对状态。

    ⚠ 四种失败**同一个异常、同一句话**：不存在、不属于这个部署、已撤销、
    已过期。分开报等于送一个枚举接口（防线 ⑪）。
    Args: session, deployment_id, presented。
    """
    if not api_key.looks_like_a_key(presented):
        raise ApiKeyInvalid(INVALID_KEY_MESSAGE)
    row = await api_key_crud.get_by_digest(
        session, api_key.digest_of(presented)
    )
    if row is None or row.deployment_id != deployment_id:
        raise ApiKeyInvalid(INVALID_KEY_MESSAGE)
    # ⚠ 这一句是纵深防御：摘要唯一，按摘要查得到就一定对得上。它防的是
    # 「有人把那次点查换成了别的比较」这类改动
    if not api_key.matches(
        presented, row.key_hash
    ):  # pragma: no cover —— 摘要唯一，查得到必对得上
        raise ApiKeyInvalid(INVALID_KEY_MESSAGE)
    if row.revoked_at is not None:
        raise ApiKeyInvalid(INVALID_KEY_MESSAGE)
    if row.expires_at is not None and row.expires_at <= _now_of(row):
        raise ApiKeyInvalid(INVALID_KEY_MESSAGE)
    return row


def _now_of(row: ModelingApiKey) -> datetime:
    """与 `expires_at` 同一时区的「现在」。

    Args: row。
    """
    return datetime.now(row.expires_at.tzinfo if row.expires_at else None)


async def guard_rate(
    deps: OpenModelDeps, resolved: ResolvedCall
) -> ResolvedCall:
    """服务侧那一层配额，按**密钥**计。超了抛 `RateLimited`。

    ⚠ 按密钥而不是按部署：一个部署可以发给几家对接方，一家把量打满不该把
    别家一起挡住。
    Args: deps, resolved。
    """
    limiter = FixedWindowLimiter(
        cache=deps.cache,
        namespace=RATE_NAMESPACE,
        limit=resolved.deployment.rate_limit_per_minute,
        window_s=RATE_WINDOW_S,
        message="调用过于频繁，请稍后再试",
    )
    hits = await limiter.hit(str(resolved.api_key_id))
    return replace(resolved, hits_in_window=hits)


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
    归到任何一个部署的账上；而记下来正好给了拿错密钥猛打的人一个撑爆这张表的
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
        await _record(deps, counted, started, error.http_status, error.code)
        raise
    await _record(deps, counted, started, HTTP_OK, None)
    return answer


async def _record(
    deps: OpenModelDeps,
    resolved: ResolvedCall,
    started: float,
    status: int,
    error_code: int | None,
) -> None:
    """记一条调用记录，顺带在每分钟的头一次更新「最后用过」。

    ⚠ `last_used_at` 每分钟最多写一次：每次调用都写会把那一行变成热点，
    而它的用途只是「这把钥匙还在不在用」，精确到分钟绰绰有余。
    Args: deps, resolved, started, status, error_code。
    """
    duration_ms = int((time.monotonic() - started) * 1000)
    try:
        async with deps.sessions.session() as session:
            call_log_crud.add(
                session,
                ModelingCallLog(
                    deployment_id=resolved.deployment.id,
                    api_key_id=resolved.api_key_id,
                    row_count=resolved.row_count,
                    duration_ms=duration_ms,
                    status=status,
                    error_code=error_code,
                ),
            )
            if resolved.hits_in_window == 1:
                key = await api_key_crud.get(session, resolved.api_key_id)
                if key is not None:
                    key.last_used_at = datetime.now(UTC)
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
    session: AsyncSession, deps: OpenModelDeps, version: ModelingModelVersion
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
    session: AsyncSession, deps: OpenModelDeps, version: ModelingModelVersion
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


def _entry_of(version: ModelingModelVersion) -> list[dict[str, object]]:
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
    rows: list[OpenModelRow], version: ModelingModelVersion
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


def public_signature(version: ModelingModelVersion) -> dict[str, object]:
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
