"""命令总线消费端：platform 发命令、collector 执行并回值。

浏览与读写必须由**持有现场会话**的进程执行，否则就要在设备上叠加第二条
会话（ADR-0001 理由三）。
"""

import asyncio
import contextlib
from typing import Any, Protocol
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from collector_server.apps.collect.drivers.base import (
    BrowseItem,
    Driver,
    Sample,
)
from collector_server.apps.collect.errors import (
    CollectError,
    MissingPointCode,
    SourceOffline,
    UnknownAction,
)
from collector_server.apps.collect.runtime.session import SourceSession
from collector_server.apps.collect.services.subtree import (
    SubtreeResult,
    walk_subtree,
)
from collector_server.clock import Clock, utc_now_ms
from collector_server.commands import CommandTransport
from collectwire import (
    ACTION_BROWSE,
    ACTION_BROWSE_SUBTREE,
    ACTION_READ,
    ACTION_WRITE,
    REASON_DRIVER_FAILED,
    STATUS_ERROR,
    STATUS_OK,
)
from lib.logging import get_logger

_logger = get_logger("collect.bus")

# 本服务**实现**了的动作。⚠ 它是 `ACTIONS` 的子集而不等于它：线上存在但这里
# 没实现的动作（一期是 `validate`）一律回 `unknown_action`，发起方据此把结论
# 记成「未校验」——那与「通过」是两回事（ADR-0011 的代价三）
SUPPORTED_ACTIONS = (
    ACTION_BROWSE,
    ACTION_BROWSE_SUBTREE,
    ACTION_READ,
    ACTION_WRITE,
)

# Redis 抖动后等一拍再取，避免空转打满 CPU
RETRY_PAUSE_S = 1.0


class SessionLocator(Protocol):
    """按数据源找活着的会话。真实现是 supervisor。"""

    def session_of(self, source_id: UUID) -> SourceSession | None: ...


class CommandRequest(BaseModel):
    """总线上的一条请求。

    ⚠ `deadline_ms` 是**绝对墙钟**：超期的请求 leader 直接丢弃不应答——
    发起方早已超时走人，这时候再去问现场只是白白占用一次设备往返。
    """

    model_config = ConfigDict(frozen=True, extra="ignore")

    request_id: str = Field(min_length=1)
    action: str
    source_id: UUID
    deadline_ms: int
    # 浏览用；None 表示从根开始
    parent: str | None = None
    # 读用
    point_codes: tuple[str, ...] = ()
    # 写用。⚠ 幂等键在 platform 侧兜（api-contract §7），本层只负责执行一次
    point_code: str | None = None
    value: Any = None


class CommandConsumer:
    """一条取请求 → 执行 → 回应答的循环。"""

    def __init__(
        self,
        *,
        transport: CommandTransport,
        locator: SessionLocator,
        block_s: float,
        reply_ttl_s: int,
        clock: Clock = utc_now_ms,
    ) -> None:
        """按传输面与会话表初始化，构造时不起任务。

        Args: transport, locator, block_s, reply_ttl_s, clock。
        """
        self._transport = transport
        self._locator = locator
        self._block_s = block_s
        self._reply_ttl_s = reply_ttl_s
        self._clock = clock
        self._stopped = asyncio.Event()
        # ⚠ 强引用：事件循环只持有任务的弱引用，丢了引用的任务可能随时消失
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """起消费循环。"""
        self._stopped.clear()
        self._task = asyncio.create_task(self.run())

    async def stop(self) -> None:
        """停收新命令。

        ⚠ 最坏要等满一次阻塞取（`block_s`）：那是取请求那一跳的固有代价，
        把它算进关停预算里，不要为了快而在阻塞中途硬断连接。
        """
        self._stopped.set()
        task, self._task = self._task, None
        if task is not None:
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def run(self) -> None:
        """一直消费到被叫停。

        ⚠ 一拍出错不许带走整个循环：带走了这个副本就再也不响应浏览与写值，
        而它看起来完全正常。
        """
        while not self._stopped.is_set():
            try:
                await self.handle_once()
            except Exception as error:
                _logger.error(
                    "command_bus_tick_failed",
                    "取命令这一拍出错，等一拍再取",
                    error_type=type(error).__name__,
                )
                await self._pause(RETRY_PAUSE_S)

    async def handle_once(self) -> bool:
        """取一条并处理，返回这一拍有没有活干。"""
        envelope = await self._transport.take(block_s=self._block_s)
        if envelope is None:
            return False
        try:
            request = CommandRequest.model_validate(envelope)
        except ValidationError as error:
            _logger.warning(
                "command_malformed",
                "请求形状不合法，已丢弃",
                error_type=type(error).__name__,
            )
            return False
        await self._execute(request)
        return True

    async def _execute(self, request: CommandRequest) -> None:
        """执行一条请求并回应答；超期的直接丢。

        Args: request。
        """
        if request.deadline_ms <= self._clock():
            _logger.warning(
                "command_expired",
                "请求已超期，不再执行也不应答",
                action=request.action,
                request_id=request.request_id,
            )
            return
        try:
            data = await self._dispatch(request)
        except CollectError as error:
            await self._reply_error(request, error.reason, type(error).__name__)
            return
        except Exception as error:
            await self._reply_error(
                request, REASON_DRIVER_FAILED, type(error).__name__
            )
            return
        await self._transport.reply(
            request.request_id,
            {
                "request_id": request.request_id,
                "status": STATUS_OK,
                "data": data,
            },
            ttl_s=self._reply_ttl_s,
        )

    async def _dispatch(self, request: CommandRequest) -> dict[str, Any]:
        """按动作分派。

        Args: request。
        """
        driver = self._driver_of(request.source_id)
        if request.action == ACTION_BROWSE:
            items = await driver.browse(request.parent)
            return {"items": [_browse_payload(item) for item in items]}
        if request.action == ACTION_BROWSE_SUBTREE:
            return _subtree_payload(
                await walk_subtree(
                    driver.browse,
                    request.parent,
                    deadline_ms=request.deadline_ms,
                    clock=self._clock,
                )
            )
        if request.action == ACTION_READ:
            samples = await driver.read_many(request.point_codes)
            return {
                "samples": [
                    _sample_payload(code, sample)
                    for code, sample in zip(
                        request.point_codes, samples, strict=False
                    )
                ]
            }
        if request.action == ACTION_WRITE:
            await driver.write(_require_point(request), request.value)
            return {}
        raise UnknownAction(f"不认识的动作：{request.action}")

    def _driver_of(self, source_id: UUID) -> Driver:
        """取活着的驱动；没有会话或没连上都算离线。

        Args: source_id。
        """
        session = self._locator.session_of(source_id)
        if session is None or not session.is_online:
            raise SourceOffline("数据源当前没有活着的会话")
        return session.driver

    async def _reply_error(
        self, request: CommandRequest, reason: str, detail: str
    ) -> None:
        """回一条失败应答。

        ⚠ 失败也要回：不回的话发起方只能等到自己超时，而「超时」与「这个点位
        不存在」在页面上长得一模一样。

        Args: request, reason, detail。
        """
        _logger.error(
            "command_failed",
            "命令执行失败",
            action=request.action,
            source_id=str(request.source_id),
            reason=reason,
            error_type=detail,
        )
        await self._transport.reply(
            request.request_id,
            {
                "request_id": request.request_id,
                "status": STATUS_ERROR,
                "reason": reason,
                "detail": detail,
            },
            ttl_s=self._reply_ttl_s,
        )

    async def _pause(self, delay_s: float) -> None:
        """等一段时间，被叫停就提前醒。

        Args: delay_s。
        """
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stopped.wait(), timeout=delay_s)


def _require_point(request: CommandRequest) -> str:
    """取写值请求里的点位编码，没带就抛。

    Args: request。
    """
    if not request.point_code:
        raise MissingPointCode("写值请求缺 point_code")
    return request.point_code


def _browse_payload(item: BrowseItem) -> dict[str, Any]:
    """把一条浏览结果编成应答字段。

    ⚠ `data_type` 为 null 是「现场没读到」，发起方据此不预选类型——它与
    「读出来是 float」不是一回事，不许在这里兜一个缺省值。

    Args: item。
    """
    return {
        "address": item.address,
        "name": item.name,
        "has_children": item.has_children,
        "is_variable": item.is_variable,
        "data_type": item.data_type,
    }


def _subtree_payload(result: SubtreeResult) -> dict[str, Any]:
    """把一次子树遍历编成应答字段。

    ⚠ `is_truncated` 与条目同等重要：漏了它，界面只会显示「就这么多点位」，
    而实际上刹车提前踩了。
    Args: result。
    """
    return {
        "items": [
            {"parent": entry.parent, **_browse_payload(entry.item)}
            for entry in result.entries
        ],
        "is_truncated": result.is_truncated,
    }


def _sample_payload(point_code: str, sample: Sample) -> dict[str, Any]:
    """把一条读数编成应答字段。

    Args: point_code, sample。
    """
    value, ts_ms, quality = sample
    return {
        "point_code": point_code,
        "value": value,
        "ts_ms": ts_ms,
        "quality": quality,
    }
