"""驱动接口：一种协议一个实现，协议知识只允许存在于实现内部。

签名与四条硬约束见 docs/COLLECT_DESIGN.md §4.1，缝的位置见 ADR-0011。
本文件零协议名词——出现 asyncua / Modbus 字样即为设计错误。
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Literal, Protocol

from collector_server.apps.collect.errors import CollectError
from collectwire import DataType
from timeseries import Quality

# 回调签名：point_code、value、ts_ms、quality。
# ⚠ 必须是**纯同步、零 await** 的回调：它跑在协议库的回调里，两万个点位的
# 回调里只要有一个 await，事件循环当场被压垮。要落 Redis 的活交给 sink 的
# 定期 flush，不在这里做。
ValueSink = Callable[[str, object, int, Quality], None]

# 一次读数：value、ts_ms、quality 三元组
Sample = tuple[object, int, Quality]

# 会话循环据它决定「重连还是停下」：transient 退避重连，config/auth 重连也没用
ErrorCategory = Literal["transient", "config", "auth"]


class DriverError(CollectError):
    """驱动层异常的根。"""

    reason: str = "driver_failed"


class BrowseNotSupported(DriverError):
    """本协议没有地址空间可浏览。

    ⚠ 绝不用空列表表达「不支持」：空列表与「这台设备确实没有点位」分不开，
    会让配置界面静默摆出一棵空树（ADR-0011）。
    """

    reason: str = "browse_unsupported"


class WriteNotSupported(DriverError):
    """本协议或本连接不允许下发写值。"""

    reason: str = "write_unsupported"


class PointNotLoaded(DriverError):
    """point_code 没有登记过，驱动不知道它的协议寻址串。"""

    reason: str = "point_not_loaded"


class DriverNotConnected(DriverError):
    """会话还没建立或已经断开。"""

    reason: str = "driver_not_connected"


@dataclass(frozen=True)
class DriverCapabilities:
    """一种协议**能做什么**。运行时据它选订阅还是轮询。"""

    is_subscribe_supported: bool
    is_browse_supported: bool
    is_write_supported: bool


@dataclass(frozen=True)
class DriverTimeouts:
    """跨进程调用的预算，取自 runtime-resilience.md §3.1。"""

    connect_s: float = 5.0
    request_s: float = 3.0
    browse_s: float = 10.0


@dataclass(frozen=True)
class DriverConnection:
    """建一次会话要的全部输入。凭据在这里，**不进日志、不进快照**。"""

    endpoint: str
    # 协议特有的连接参数，对管道侧不透明
    options: Mapping[str, str] = field(default_factory=dict[str, str])
    username: str | None = None
    password: str | None = None
    timeouts: DriverTimeouts = field(default_factory=DriverTimeouts)


@dataclass(frozen=True)
class PointSpec:
    """一个点位交给驱动的那部分。

    ⚠ `address` 是**对管道侧不透明**的协议寻址串，只有驱动解析它；
    `point_code` 才是点位的身份，且不含协议（COLLECT_DESIGN.md §2）。
    """

    point_code: str
    address: str
    sampling_interval_ms: int


@dataclass(frozen=True)
class BrowseItem:
    """地址空间里的一项。`address` 可直接填进点位配置。"""

    address: str
    name: str
    has_children: bool
    # 只有变量节点能当点位；对象节点只用来往下走
    is_variable: bool
    # 现场说这个变量是什么类型。⚠ `None` 是「没读到」，不是「不是数」：
    # 建点位时按它预选类型，读不到就让人自己选，别替他猜一个
    data_type: DataType | None = None


@dataclass(frozen=True)
class RejectedPoint:
    """现场拒了的点位与拒绝原因。"""

    point_code: str
    detail: str


@dataclass(frozen=True)
class SubscribeResult:
    """一次订阅的结果。

    ⚠ 部分失败是常态：寻址串写错的那几个点位被拒，其余照样要订上。整批回滚
    会让一个错字停掉整台设备的采集。
    """

    accepted: tuple[str, ...]
    rejected: tuple[RejectedPoint, ...]


class Driver(Protocol):
    """一种协议的实现。协议知识只允许存在于本接口的实现里。"""

    @property
    def capabilities(self) -> DriverCapabilities: ...

    def load_points(self, points: Sequence[PointSpec]) -> None:
        """登记 point_code → 协议寻址串。

        ⚠ `read_many` / `write` 只认已登记的 point_code：轮询模式不订阅，
        会话必须先调这一句，否则读写会以 PointNotLoaded 失败。

        Args: points。
        """
        ...

    async def connect(self) -> None: ...

    async def disconnect(self) -> None: ...

    async def healthcheck(self) -> None:
        """心跳探针，抛异常即判断线。"""
        ...

    async def subscribe(
        self, points: Sequence[PointSpec], on_value: ValueSink
    ) -> SubscribeResult:
        """订阅一组点位，值变化时回调。内部把 points **并入**点位表。

        Args: points, on_value（必须纯同步）。
        """
        ...

    async def unsubscribe(self, point_codes: Sequence[str]) -> int:
        """退订，返回真正退掉的条数。

        Args: point_codes。
        """
        ...

    async def read_many(self, point_codes: Sequence[str]) -> list[Sample]:
        """一次性读取。

        ⚠ 返回值与入参**逐位对齐**，读不到的点位给 `(None, ts_ms, "bad")`
        而不是缩短列表——缩短会让调用方把值配到别的点位上，且不报错。

        Args: point_codes。
        """
        ...

    async def write(self, point_code: str, value: object) -> None:
        """下发写值。

        ⚠ 写超时按不可重试处理：超时不代表没写成功，盲目重试可能向现场
        下发两次（runtime-resilience §2）。

        Args: point_code, value。
        """
        ...

    async def browse(self, parent: str | None) -> list[BrowseItem]:
        """浏览地址空间；不支持即抛 BrowseNotSupported，不返回空列表。

        Args: parent（协议寻址串，None 表示根）。
        """
        ...

    def fingerprint(self) -> tuple[str, ...]:
        """连接参数的指纹，变了就必须重连。"""
        ...

    def classify_error(self, error: BaseException) -> ErrorCategory:
        """把协议异常判成三档之一。

        Args: error。
        """
        ...
