"""单个数据源的一生：连 → 订阅或轮询 → 心跳 → 退避 → 拆。

⚠ 重试只在这一层：驱动与命令总线都不再重试，逐层重试会相乘成雪崩
（runtime-resilience §4.2）。
"""

import asyncio
import contextlib
import secrets
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol
from uuid import UUID

from collector_server.apps.collect.drivers.base import (
    Driver,
    DriverTimeouts,
    PointSpec,
    ValueSink,
)
from collector_server.apps.collect.plan.adapt import specs_of
from collector_server.apps.collect.runtime.poller import PollLoop, PollOptions
from collectwire import (
    READ_MODE_SUBSCRIBE,
    STATE_CONNECTING,
    STATE_OFFLINE,
    STATE_ONLINE,
    PlanSource,
)
from lib.logging import get_logger

_logger = get_logger("collect.session")

# 首次退避的基数，之后指数增长到上限
BASE_BACKOFF_S = 1.0
# 指数的封顶次方，防止 2**attempt 溢出成天文数字
MAX_DOUBLINGS = 6
# 抖动的分辨率：千分之一
JITTER_STEPS = 1000


@dataclass(frozen=True)
class SourceStatus:
    """一个数据源此刻的运行态，报给 `collect` schema 供 platform 只读。"""

    source_id: UUID
    state: str
    point_count: int
    error_category: str | None = None
    error_detail: str | None = None


class StatusReporter(Protocol):
    """运行态出口。真实现写库，测试用进程内假件。"""

    async def report(self, status: SourceStatus) -> None: ...


@dataclass(frozen=True)
class SessionOptions:
    """一条会话的时间预算。"""

    heartbeat_interval_s: float
    max_backoff_s: float
    timeouts: DriverTimeouts = field(default_factory=DriverTimeouts)


def jitter() -> float:
    """0 到 1 之间的抖动系数。

    ⚠ 用 `secrets` 而不是 `random`：这里不需要密码学强度，但仓规的 lint 把
    `random` 判为可疑来源，而为它开豁免不如直接用一个同样廉价的接口。
    """
    return secrets.randbelow(JITTER_STEPS) / JITTER_STEPS


def backoff_delay_s(attempt: int, *, max_s: float, ratio: float) -> float:
    """第 n 次失败后要等多久。

    ⚠ 必须带抖动：没有抖动的退避会让所有副本在同一刻一起重连，把刚缓过来的
    现场设备再打死一次（runtime-resilience §4.1）。

    Args: attempt, max_s, ratio（0–1 的抖动系数）。
    """
    step = BASE_BACKOFF_S * (2 ** min(attempt, MAX_DOUBLINGS))
    return min(step, max_s) * (0.5 + 0.5 * ratio)


class SourceSession:
    """一个数据源的会话。supervisor 按计划各起一条。"""

    def __init__(
        self,
        *,
        source: PlanSource,
        driver: Driver,
        sink: ValueSink,
        options: SessionOptions,
        reporter: StatusReporter,
    ) -> None:
        """按计划里的数据源初始化，构造时不做任何 IO。

        Args: source, driver, sink, options, reporter。
        """
        self._source = source
        self._driver = driver
        self._sink = sink
        self._options = options
        self._reporter = reporter
        self._stopped = asyncio.Event()
        self._subscribed: set[str] = set()
        self._poller: PollLoop | None = None
        # ⚠ 强引用：事件循环只持有任务的弱引用，丢了引用的任务可能随时消失
        self._poll_task: asyncio.Task[None] | None = None
        self._is_online = False

    @property
    def source_id(self) -> UUID:
        """本会话服务的数据源。"""
        return self._source.source_id

    @property
    def driver(self) -> Driver:
        """活着的驱动。命令总线要靠它执行浏览与读写。"""
        return self._driver

    @property
    def is_online(self) -> bool:
        """此刻是否连着。"""
        return self._is_online

    async def run(self) -> None:
        """跑到被叫停为止：断了就退避重连。"""
        self._stopped.clear()
        attempt = 0
        while not self._stopped.is_set():
            delay_s = 0.0
            try:
                await self._open()
                attempt = 0
                await self._watch()
            except Exception as error:
                attempt += 1
                delay_s = await self._on_failure(error, attempt)
            await self._close()
            if self._stopped.is_set():
                return
            await self._pause(delay_s)

    async def stop(self) -> None:
        """叫停并拆掉会话。"""
        self._stopped.set()
        await self._close()

    async def apply(self, source: PlanSource) -> None:
        """点位变了：退掉不要的、订上新增的，**不重连**。

        ⚠ 只改点位却重连，会在每次配置保存时把整台设备的采集断一次。
        连接参数变了由 supervisor 判定并整条重建。

        Args: source。
        """
        wanted = {point.point_code for point in source.points}
        removed = sorted(self._subscribed - wanted)
        self._source = source
        if removed:
            await self._driver.unsubscribe(removed)
            self._subscribed -= set(removed)
        if self._is_online:
            await self._attach()

    async def _open(self) -> None:
        """建连并挂上取数。"""
        await self._reporter.report(self._status(STATE_CONNECTING))
        await self._driver.connect()
        self._is_online = True
        await self._attach()
        await self._reporter.report(self._status(STATE_ONLINE))

    async def _attach(self) -> None:
        """按能力与配置选订阅还是轮询。

        ⚠ 驱动不支持订阅时**自动降级为轮询**，降级方向是显式的：宁可多问
        几次，也不要静默变成一个不产值的会话（COLLECT_DESIGN.md §4.1）。
        """
        specs = specs_of(self._source)
        self._driver.load_points(specs)
        if self._wants_subscribe():
            await self._subscribe(
                [
                    spec
                    for spec in specs
                    if spec.point_code not in self._subscribed
                ]
            )
            return
        await self._start_polling()

    def _wants_subscribe(self) -> bool:
        """这条会话该走订阅吗。"""
        return (
            self._driver.capabilities.is_subscribe_supported
            and self._source.read_mode == READ_MODE_SUBSCRIBE
        )

    async def _subscribe(self, specs: Sequence[PointSpec]) -> None:
        """订阅新增的点位，被拒的逐条记日志。

        Args: specs。
        """
        if not specs:
            return
        result = await self._driver.subscribe(specs, self._sink)
        self._subscribed.update(result.accepted)
        for refused in result.rejected:
            _logger.error(
                "point_rejected",
                "点位订阅被现场拒绝，检查寻址串",
                source_id=str(self.source_id),
                point_code=refused.point_code,
                detail=refused.detail,
            )

    async def _start_polling(self) -> None:
        """起轮询循环。"""
        await self._stop_polling()
        self._poller = PollLoop(
            driver=self._driver,
            sink=self._sink,
            options=PollOptions(
                point_codes=tuple(
                    point.point_code for point in self._source.points
                ),
                interval_ms=self._source.poll_interval_ms,
            ),
        )
        self._poll_task = asyncio.create_task(self._poller.run())

    async def _stop_polling(self) -> None:
        """停轮询循环并等它退出。"""
        poller, self._poller = self._poller, None
        task, self._poll_task = self._poll_task, None
        if poller is not None:
            poller.stop()
        if task is not None:
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def _watch(self) -> None:
        """心跳循环：探不到就抛，交给 `run` 去重连。"""
        while not self._stopped.is_set():
            await self._pause(self._options.heartbeat_interval_s)
            if self._stopped.is_set():
                return
            await self._driver.healthcheck()

    async def _on_failure(self, error: BaseException, attempt: int) -> float:
        """记一次失败并算出该等多久。

        ⚠ config / auth 类的错误直接等到上限：寻址串写错或凭据不对，重连一
        万次也是同一个结果，密集重连只会白白占满现场设备的会话上限。

        Args: error, attempt。
        """
        category = self._driver.classify_error(error)
        detail = type(error).__name__
        _logger.error(
            "source_session_failed",
            "数据源会话断开",
            source_id=str(self.source_id),
            error_category=category,
            error_type=detail,
            attempt=attempt,
        )
        await self._reporter.report(
            self._status(
                STATE_OFFLINE, error_category=category, error_detail=detail
            )
        )
        if category == "transient":
            return backoff_delay_s(
                attempt, max_s=self._options.max_backoff_s, ratio=jitter()
            )
        return self._options.max_backoff_s

    async def _close(self) -> None:
        """拆掉取数与连接。"""
        await self._stop_polling()
        self._subscribed.clear()
        if self._is_online:
            self._is_online = False
            await self._driver.disconnect()

    async def _pause(self, delay_s: float) -> None:
        """等一段时间，被叫停就提前醒。

        Args: delay_s。
        """
        if delay_s <= 0:
            return
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stopped.wait(), timeout=delay_s)

    def _status(
        self,
        state: str,
        *,
        error_category: str | None = None,
        error_detail: str | None = None,
    ) -> SourceStatus:
        """按当前配置造一条运行态。

        Args: state, error_category, error_detail。
        """
        return SourceStatus(
            source_id=self.source_id,
            state=state,
            point_count=len(self._source.points),
            error_category=error_category,
            error_detail=error_detail,
        )
