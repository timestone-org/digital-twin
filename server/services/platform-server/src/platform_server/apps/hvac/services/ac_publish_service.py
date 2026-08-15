"""下发一次预测：取实时读数 → 推荐 → 写点位 → 记心跳。

`:publish` 端点与每分钟的发布循环走的是**同一个** `publish_once`——「点一下
试试」与「自动跑」必须是同一段代码，否则页面上试通了、循环里还是不通。

降级口径见 docs/AC_PUBLISH_DESIGN.md §4.3：算不出数时数字点位写 `-1`、
字符串点位写以「无预测：」开头的人话原因。⚠ 绝不用 0 表示「算不出来」——
0 是合法预测值（一开机就已达标，现网占 48.7%）。
"""

import uuid
from collections.abc import Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import AppError
from lib.logging import get_logger
from lib.utils.timeutils import utcnow
from platform_server.apps.hvac.crud import ac_model_publication_crud
from platform_server.apps.hvac.errors import (
    PublicationBindingInvalid,
)
from platform_server.apps.hvac.models import AcModelPublication
from platform_server.apps.hvac.publications import (
    NO_PREDICTION,
    NO_PREDICTION_PREFIX,
    PUBLISH_STATUS_DEGRADED,
    PUBLISH_STATUS_FAILED,
    PUBLISH_STATUS_OK,
)
from platform_server.apps.hvac.schemas import (
    LiveReadingsOut,
    PredictReadingsIn,
    RecommendIn,
)
from platform_server.apps.hvac.services import ac_publication_service
from platform_server.apps.hvac.services.ac_live_readings import read_live
from platform_server.apps.hvac.services.ac_model_predictor import (
    RecommendResult,
    recommend,
)
from platform_server.apps.hvac.services.ac_publication_service import (
    PublicationView,
)
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.opcua import (
    NodeWrite,
    NodeWriter,
    OpcuaCallFailed,
    WriteResult,
)

_logger = get_logger("platform.hvac.ac_publish")


class Sessions(Protocol):
    """开一个短事务的最小面。

    ⚠ 只认这一个方法而不认 `Database`：下发要开三个互不相干的短事务
    （读配置、算、记心跳），把它收成一个面，用例才能把那条回滚事务包进来，
    而不必让被测代码知道自己跑在用例里。
    """

    def session(self) -> AbstractAsyncContextManager[AsyncSession]: ...


# `last_error` 会显示在页面上，太长的原因把整行撑爆
_MAX_ERROR = 500


@dataclass(frozen=True)
class PlanItem:
    """一次下发里的一个点位。"""

    # None = 区域推荐点位；否则是这个组合的时间点位
    set_key: str | None
    node_id: uuid.UUID
    identifier: str
    value: str | float


@dataclass(frozen=True)
class PublishedItem:
    """一个点位的去向。"""

    set_key: str | None
    identifier: str
    value: str | float | None
    is_written: bool
    error: str | None


@dataclass(frozen=True)
class PublishOutcome:
    """一次下发的结果。"""

    model_id: uuid.UUID
    status: str
    published_at: datetime
    items: tuple[PublishedItem, ...]
    error: str | None

    @property
    def written_count(self) -> int:
        """写进去了几个点位。"""
        return sum(1 for item in self.items if item.is_written)


async def publish_once(
    database: Sessions,
    reader: AcSourceReader,
    nodes: NodeWriter,
    *,
    model_id: uuid.UUID,
) -> PublishOutcome:
    """下发一次。绑定没绑齐就拒绝——没绑齐不该悄悄跳过。

    ⚠ 每一段各开一个短事务，不是一个横跨外库与 opcua-server 的长事务：
    事务内禁止做外部 IO（database-standard）。

    Args: database, reader, nodes, model_id。
    """
    async with database.session() as session:
        view = await ac_publication_service.get_view(session, model_id)
    _require_fully_bound(view)
    plan = await _plan(database, reader, view=view)
    return await _write(database, nodes, view=view, plan=plan)


def _require_fully_bound(view: PublicationView) -> None:
    """没绑齐就不发布，且要说出差在哪。

    ⚠ 后端静默跳过是最糟的处置：页面上开关是开的、点位是空的，而没有任何
    地方说过「它其实没在发」。

    Args: view。
    """
    if view.is_fully_bound:
        return
    if view.publication.recommendation_node_id is None:
        raise PublicationBindingInvalid("区域推荐点位还没绑，无法下发")
    if not view.serving_keys:
        raise PublicationBindingInvalid("这个模型没有服务组合，没有可下发的数")
    missing = "、".join(view.unbound_set_keys)
    raise PublicationBindingInvalid(f"这些组合还没绑点位：{missing}")


async def _plan(
    database: Sessions, reader: AcSourceReader, *, view: PublicationView
) -> tuple[PlanItem, ...]:
    """算出这一拍要写的每个点位的值。

    ⚠ 取数与推理都在事务之外：前者打的是厂商的外库，后者是纯计算但要读工件。

    Args: database, reader, view。
    """
    try:
        async with database.session() as session:
            live = await read_live(session, reader, room_id=view.room_id)
            result = await recommend(
                session, view.publication.model_id, _conditions(live)
            )
    # 领域异常（外库不可达、模型没训好、工件不可用、组合全被跳过）一律降级：
    # ⚠ 这些是「这一拍答不出来」，不是「配置错了」——照写点位，写哨兵值
    except AppError as error:
        return _degraded(view, reason=str(error))
    return _normal(view, result)


def _conditions(live: LiveReadingsOut) -> RecommendIn:
    """房间实时读数 → 推荐入参。

    ⚠ 缺测的字段**整个省略**而不是填 None 或 0：省略在特征层记 NaN，
    填 0 会把「传感器坏了」伪装成「零度」。五项全缺的那台整台不进字典——
    空对象与「没有这台」对模型是两回事。

    Args: live。
    """
    readings: dict[str, PredictReadingsIn] = {}
    for unit in live.units:
        values = unit.readings.model_dump(exclude_none=True)
        if values:
            readings[unit.serial] = PredictReadingsIn.model_validate(values)
    return RecommendIn(readings=readings, at=live.as_of, idle_minutes=None)


def _normal(
    view: PublicationView, result: RecommendResult
) -> tuple[PlanItem, ...]:
    """正常的一拍：区域点位写第一名，各组合点位写各自的 p50。

    ⚠ 推荐里没答出来的组合（含工件不认识的机组）写哨兵值而不是跳过：
    跳过会让那个点位停在上一拍的数，而上位机分辨不出它是旧的。

    Args: view, result。
    """
    by_key = {entry.set_key: entry for entry in result.entries}
    top = next(
        (entry for entry in result.entries if entry.is_recommended), None
    )
    region = (
        top.set_key if top is not None else _no_prediction("没有可比的组合")
    )
    items = [_region_item(view, region)]
    items.extend(
        PlanItem(
            set_key=binding.set_key,
            node_id=binding.node_id,
            identifier=binding.identifier,
            value=(
                by_key[binding.set_key].p50
                if binding.set_key in by_key
                else NO_PREDICTION
            ),
        )
        for binding in view.bindings
        if binding.set_key in set(view.serving_keys)
    )
    return tuple(items)


def _degraded(view: PublicationView, *, reason: str) -> tuple[PlanItem, ...]:
    """算不出数的一拍：区域点位写原因，全部组合点位写哨兵值。

    Args: view, reason。
    """
    items = [_region_item(view, _no_prediction(reason))]
    items.extend(
        PlanItem(
            set_key=binding.set_key,
            node_id=binding.node_id,
            identifier=binding.identifier,
            value=NO_PREDICTION,
        )
        for binding in view.bindings
        if binding.set_key in set(view.serving_keys)
    )
    return tuple(items)


def _region_item(view: PublicationView, value: str) -> PlanItem:
    """区域推荐点位那一项。

    Args: view, value。
    """
    row = view.publication
    # `_require_fully_bound` 已经挡在前面；这里再判一次只为让类型收敛，
    # 而它同时是一道真闸——将来有人绕过那道校验直接拼计划时会在这里响亮失败
    if row.recommendation_node_id is None:
        raise PublicationBindingInvalid("区域推荐点位还没绑，无法下发")
    return PlanItem(
        set_key=None,
        node_id=row.recommendation_node_id,
        identifier=row.recommendation_identifier or "",
        value=value,
    )


def _no_prediction(reason: str) -> str:
    """降级时写进字符串点位的那句话。

    Args: reason。
    """
    return f"{NO_PREDICTION_PREFIX}{reason}"


async def _write(
    database: Sessions,
    nodes: NodeWriter,
    *,
    view: PublicationView,
    plan: Sequence[PlanItem],
) -> PublishOutcome:
    """把这一拍写出去并记心跳。

    Args: database, nodes, view, plan。
    """
    published_at = utcnow()
    row = view.publication
    try:
        written = await nodes.write(
            instance_id=row.opcua_instance_id,
            items=[
                NodeWrite(id=item.node_id, value=item.value) for item in plan
            ],
            idempotency_key=_tick_key(row.model_id, published_at),
        )
    # opcua-server 不可达：一个字节都没写进去，点位停在旧值。⚠ 这是唯一
    # 一处无法「把降级写进去」的情形，只能落在心跳上由页面报出来
    except OpcuaCallFailed as error:
        outcome = _all_failed(row.model_id, published_at, plan, str(error))
        await _remember(database, outcome)
        return outcome
    outcome = _outcome(row.model_id, published_at, plan, written)
    await _remember(database, outcome)
    return outcome


def _tick_key(model_id: uuid.UUID, published_at: datetime) -> str:
    """这一拍的幂等键。

    ⚠ 按「模型 + 秒」而不是随机数：租约交接的瞬间可能有两个副本各发一拍，
    同一秒的第二次因此是重放而不是第二次写。

    Args: model_id, published_at。
    """
    return f"ac-publish:{model_id}:{int(published_at.timestamp())}"


def _outcome(
    model_id: uuid.UUID,
    published_at: datetime,
    plan: Sequence[PlanItem],
    written: Sequence[WriteResult],
) -> PublishOutcome:
    """逐项回执 + 计划 → 这一拍的结论。

    ⚠ **写失败优先于降级**：写不进去比写进去一个哨兵值严重得多——后者上位机
    读得到并会走自己的兜底，前者读到的还是旧值。

    Args: model_id, published_at, plan, written。
    """
    by_id = {result.id: result for result in written}
    items = tuple(_item(entry, by_id.get(entry.node_id)) for entry in plan)
    failures = [item for item in items if not item.is_written]
    if failures:
        return PublishOutcome(
            model_id=model_id,
            status=PUBLISH_STATUS_FAILED,
            published_at=published_at,
            items=items,
            error=_failure_reason(failures),
        )
    status = (
        PUBLISH_STATUS_DEGRADED
        if any(item.value == NO_PREDICTION for item in items)
        else PUBLISH_STATUS_OK
    )
    return PublishOutcome(
        model_id=model_id,
        status=status,
        published_at=published_at,
        items=items,
        error=None,
    )


def _item(entry: PlanItem, result: WriteResult | None) -> PublishedItem:
    """一项的计划 + 回执 → 对外形态。

    Args: entry, result。
    """
    if result is None:
        return PublishedItem(
            set_key=entry.set_key,
            identifier=entry.identifier,
            value=None,
            is_written=False,
            error="下发回执里没有这个点位",
        )
    return PublishedItem(
        set_key=entry.set_key,
        identifier=result.identifier or entry.identifier,
        value=entry.value if result.is_written else None,
        is_written=result.is_written,
        error=result.error,
    )


def _failure_reason(failures: Sequence[PublishedItem]) -> str:
    """把失败项收成一句人话，落在 `last_error` 与接口上。

    Args: failures。
    """
    named = "、".join(
        f"{item.identifier}（{item.error or '未说明原因'}）"
        for item in failures
    )
    return f"{len(failures)} 个点位没写进去：{named}"[:_MAX_ERROR]


def _all_failed(
    model_id: uuid.UUID,
    published_at: datetime,
    plan: Sequence[PlanItem],
    reason: str,
) -> PublishOutcome:
    """整条打不通：每一项都没写进去。

    Args: model_id, published_at, plan, reason。
    """
    return PublishOutcome(
        model_id=model_id,
        status=PUBLISH_STATUS_FAILED,
        published_at=published_at,
        items=tuple(
            PublishedItem(
                set_key=entry.set_key,
                identifier=entry.identifier,
                value=None,
                is_written=False,
                error=reason,
            )
            for entry in plan
        ),
        error=reason[:_MAX_ERROR],
    )


async def _remember(database: Sessions, outcome: PublishOutcome) -> None:
    """把这一拍的去向记回发布配置——这是这个功能唯一的心跳。

    ⚠ 记不下来也不许把这一拍算失败：值已经写进现场了，改写心跳失败只是让
    页面上的时间旧了一拍。但它必须**记一条日志**，否则「心跳永远不更新」在
    日志里与「一次都没发过」长得一模一样。

    Args: database, outcome。
    """
    try:
        async with database.session() as session:
            row = await ac_model_publication_crud.find(
                session, outcome.model_id
            )
            if row is None:
                return
            _apply(row, outcome)
            await session.commit()
    except Exception as error:  # pragma: no cover - 依赖库同时不可用
        _logger.error(
            "ac_publish_heartbeat_unrecorded",
            "下发结果未能写回，页面上的心跳会停在上一拍",
            model_id=str(outcome.model_id),
            error_type=type(error).__name__,
        )


def _apply(row: AcModelPublication, outcome: PublishOutcome) -> None:
    """把结论写到发布配置行上。

    Args: row, outcome。
    """
    row.last_published_at = outcome.published_at
    row.last_status = outcome.status
    row.last_error = outcome.error
