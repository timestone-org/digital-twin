"""OPC UA 驱动：一期唯一的驱动实现。

会话生命周期、点位表与结果装配在这里，协议特有的决断在 `mapping.py`。
⚠ asyncua 只允许出现在本目录下，见 CONTEXT.md §3（契约测试守着这条）。
"""

import asyncio
import hashlib
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import cast

from asyncua import Client, Node, ua
from asyncua.common.subscription import Subscription, SubscriptionHandler

from collector_server.apps.collect.drivers.base import (
    BrowseItem,
    DriverCapabilities,
    DriverConnection,
    DriverNotConnected,
    ErrorCategory,
    PointNotLoaded,
    PointSpec,
    RejectedPoint,
    Sample,
    SubscribeResult,
    ValueSink,
)
from collector_server.apps.collect.drivers.opcua import mapping
from collector_server.apps.collect.drivers.opcua.notifier import (
    DataChangeNotifier,
)
from collector_server.clock import Clock, utc_now_ms
from lib.logging import get_logger

_logger = get_logger("collect.driver.opcua")

CAPABILITIES = DriverCapabilities(
    is_subscribe_supported=True,
    is_browse_supported=True,
    is_write_supported=True,
)

# 发布周期下限：比它更小只会让 PLC 多发包，值本身不会来得更快
MIN_PUBLISH_INTERVAL_MS = 100
# 单个监视项的服务端队列长度。1 = 只留最新值——快照是采样，不是事件流
QUEUE_SIZE = 1
# 指纹里口令那一段的长度。留指纹不留口令：指纹进得了日志，口令进不了
DIGEST_LENGTH = 16

ClientFactory = Callable[[DriverConnection], Client]


@dataclass(frozen=True)
class ResolvedPoint:
    """寻址串解析成功的点位。"""

    point: PointSpec
    node_id: ua.NodeId


def build_client(connection: DriverConnection) -> Client:
    """按连接参数造一个 asyncua 客户端。

    Args: connection。
    """
    client = Client(
        url=connection.endpoint, timeout=connection.timeouts.request_s
    )
    if connection.username is not None:
        client.set_user(connection.username)
    if connection.password is not None:
        client.set_password(connection.password)
    return client


def resolve_points(
    points: Sequence[PointSpec],
) -> tuple[list[ResolvedPoint], list[RejectedPoint]]:
    """把点位的寻址串解析成 NodeId；解析不了的进 rejected。

    ⚠ 一个错字不许停掉整台设备：解析失败只拒它自己，其余照订。

    Args: points。
    """
    resolved: list[ResolvedPoint] = []
    rejected: list[RejectedPoint] = []
    for point in points:
        try:
            node_id = mapping.node_id_of(point.address)
        except ua.UaError as error:
            rejected.append(RejectedPoint(point.point_code, str(error)))
        else:
            resolved.append(ResolvedPoint(point=point, node_id=node_id))
    return resolved, rejected


def group_by_interval(
    resolved: Sequence[ResolvedPoint],
) -> list[tuple[int, list[ResolvedPoint]]]:
    """按采样周期分组——一次 `subscribe_data_change` 只能带一个周期。

    Args: resolved。
    """
    groups: dict[int, list[ResolvedPoint]] = {}
    for item in resolved:
        groups.setdefault(item.point.sampling_interval_ms, []).append(item)
    return sorted(groups.items())


def publish_interval_ms(resolved: Sequence[ResolvedPoint]) -> int:
    """订阅的发布周期：取最快的那个采样周期，且不低于下限。

    Args: resolved。
    """
    fastest = min(item.point.sampling_interval_ms for item in resolved)
    return max(fastest, MIN_PUBLISH_INTERVAL_MS)


def merge_handles(
    batch: Sequence[ResolvedPoint], handles: Sequence[object]
) -> tuple[dict[str, int], list[RejectedPoint]]:
    """把 asyncua 的回包摊成「点位 → 句柄」与被拒清单。

    ⚠ 回包里混着 int 与 StatusCode：现场不认识的 NodeId 回的是状态码而不是
    异常，当成句柄存下来就会在退订时报一个与原因无关的错。

    Args: batch, handles。
    """
    accepted: dict[str, int] = {}
    rejected: list[RejectedPoint] = []
    for index, item in enumerate(batch):
        handle = handles[index] if index < len(handles) else None
        code = item.point.point_code
        if isinstance(handle, int):
            accepted[code] = handle
        else:
            rejected.append(RejectedPoint(code, _reason_of(handle)))
    return accepted, rejected


def _reason_of(handle: object) -> str:
    """把一个非句柄的回包元素说成一句话。

    Args: handle。
    """
    if isinstance(handle, ua.StatusCode):
        return handle.name
    return "no_handle"


def align_samples(
    point_codes: Sequence[str],
    queried: Sequence[str],
    values: Sequence[ua.DataValue],
    *,
    now_ms: int,
) -> list[Sample]:
    """把回包按**请求顺序**摊平；没读到的给 `(None, now, "bad")`。

    ⚠ 绝不缩短列表：调用方按位置对点位，缩短会把值配到别的点位上而不报错。

    Args: point_codes（请求顺序）, queried（真正问了的）, values, now_ms。
    """
    got: dict[str, Sample] = {}
    for code, value in zip(queried, values, strict=False):
        got[code] = (
            # 外层 DataValue.Value 是 Variant，里面那层才是 Python 值
            value.Value.Value if value.Value is not None else None,
            mapping.timestamp_ms_of(value, fallback_ms=now_ms),
            mapping.quality_of(value.StatusCode),
        )
    return [got.get(code, (None, now_ms, "bad")) for code in point_codes]


def browse_items(
    descriptions: Sequence[ua.ReferenceDescription],
) -> list[BrowseItem]:
    """把一次浏览的引用描述翻成协议无关的条目。

    ⚠ 变量节点按叶子处理：它的子节点是 EngineeringUnits 这类属性，不是点位，
    摆进树里只会让人以为还能往下选。

    Args: descriptions。
    """
    items: list[BrowseItem] = []
    for description in descriptions:
        address = description.NodeId.to_string()
        is_variable = description.NodeClass == ua.NodeClass.Variable
        items.append(
            BrowseItem(
                address=address,
                name=description.BrowseName.Name or address,
                has_children=not is_variable,
                is_variable=is_variable,
            )
        )
    return items


class OpcuaDriver:
    """一个数据源的 OPC UA 会话。组合根按数据源各造一份。"""

    def __init__(
        self,
        *,
        connection: DriverConnection,
        client_factory: ClientFactory = build_client,
        clock: Clock = utc_now_ms,
    ) -> None:
        """按连接参数初始化，此时还没有任何 IO。

        Args: connection, client_factory（测试注入假客户端）, clock。
        """
        self._connection = connection
        self._factory = client_factory
        self._clock = clock
        self._client: Client | None = None
        self._subscription: Subscription | None = None
        self._notifier: DataChangeNotifier | None = None
        self._points: dict[str, PointSpec] = {}
        self._handles: dict[str, int] = {}

    @property
    def capabilities(self) -> DriverCapabilities:
        """OPC UA 三样都支持。"""
        return CAPABILITIES

    def load_points(self, points: Sequence[PointSpec]) -> None:
        """登记 point_code → 寻址串，**整表替换**。

        Args: points。
        """
        self._points = {point.point_code: point for point in points}

    def _remember(self, points: Sequence[PointSpec]) -> None:
        """把这批点位**并入**点位表。

        ⚠ 订阅增量时不能整表替换：那会把没被本次订阅带上的点位从表里抹掉，
        随后对它们的读写就会以「点位未登记」失败，而计划里明明还有它们。

        Args: points。
        """
        self._points.update({point.point_code: point for point in points})

    def fingerprint(self) -> tuple[str, ...]:
        """连接参数指纹。任一项变了都必须重连，否则还连着旧端点。"""
        options = tuple(
            f"{name}={value}"
            for name, value in sorted(self._connection.options.items())
        )
        return (
            self._connection.endpoint,
            self._connection.username or "",
            _digest_of(self._connection.password),
            *options,
        )

    def classify_error(self, error: BaseException) -> ErrorCategory:
        """判成 transient / config / auth 三档。

        Args: error。
        """
        return mapping.category_of(error)

    async def connect(self) -> None:
        """建会话。

        ⚠ 外面这层 `asyncio.timeout` 不能省：asyncua 的 `timeout` 只管单次
        请求，TCP 建连卡住时它不会醒——而工控网上「连着不响应」是常态。
        """
        client = self._factory(self._connection)
        async with asyncio.timeout(self._connection.timeouts.connect_s):
            await client.connect()
        self._client = client

    async def disconnect(self) -> None:
        """拆会话。拆不掉也要把本地状态清干净，否则重连会认为自己还连着。"""
        client, self._client = self._client, None
        self._subscription = None
        self._notifier = None
        self._handles.clear()
        if client is None:
            return
        try:
            async with asyncio.timeout(self._connection.timeouts.request_s):
                await client.disconnect()
        except Exception as error:
            _logger.warning(
                "driver_disconnect_failed", "断开会话时出错", error=error
            )

    async def healthcheck(self) -> None:
        """心跳探针：探不到就抛，由会话循环判断线。"""
        client = self._require_client()
        async with asyncio.timeout(self._connection.timeouts.request_s):
            await client.check_connection()

    async def subscribe(
        self, points: Sequence[PointSpec], on_value: ValueSink
    ) -> SubscribeResult:
        """订阅一组点位。部分失败只拒失败的那些。

        Args: points, on_value（必须纯同步）。
        """
        self._remember(points)
        resolved, rejected = resolve_points(points)
        if not resolved:
            return SubscribeResult(accepted=(), rejected=tuple(rejected))
        subscription = await self._ensure_subscription(resolved, on_value)
        accepted: list[str] = []
        for interval_ms, batch in group_by_interval(resolved):
            taken, refused = await self._subscribe_batch(
                subscription, batch, interval_ms
            )
            accepted.extend(taken)
            rejected.extend(refused)
        return SubscribeResult(
            accepted=tuple(accepted), rejected=tuple(rejected)
        )

    async def unsubscribe(self, point_codes: Sequence[str]) -> int:
        """退订，返回真正退掉的条数。

        Args: point_codes。
        """
        subscription = self._subscription
        taken = [
            (code, handle)
            for code in point_codes
            if (handle := self._handles.pop(code, None)) is not None
        ]
        if subscription is None or not taken:
            return 0
        async with asyncio.timeout(self._connection.timeouts.request_s):
            await subscription.unsubscribe([handle for _, handle in taken])
        for code, _ in taken:
            if self._notifier is not None:
                self._notifier.forget(code)
        return len(taken)

    async def read_many(self, point_codes: Sequence[str]) -> list[Sample]:
        """一次性读取，返回值与入参逐位对齐。

        Args: point_codes。
        """
        client = self._require_client()
        now_ms = self._clock()
        queried, nodes = self._nodes_for(point_codes)
        if not nodes:
            return [(None, now_ms, "bad") for _ in point_codes]
        async with asyncio.timeout(self._connection.timeouts.request_s):
            values = await client.read_attributes(nodes)
        return align_samples(point_codes, queried, values, now_ms=now_ms)

    async def write(self, point_code: str, value: object) -> None:
        """下发写值。

        ⚠ 值的类型由现场节点决定：asyncua 按 Python 类型推断 Variant，类型
        不符会被服务端拒（BadTypeMismatch）。这是**期望行为**——静默截断
        成另一个数比报错难查一个量级。

        Args: point_code, value。
        """
        client = self._require_client()
        node_id = mapping.node_id_of(self._point_of(point_code).address)
        async with asyncio.timeout(self._connection.timeouts.request_s):
            await client.get_node(node_id).write_value(value)

    async def browse(self, parent: str | None) -> list[BrowseItem]:
        """浏览地址空间。`parent` 为 None 时从 Objects 文件夹起。

        Args: parent。
        """
        client = self._require_client()
        node = (
            client.nodes.objects
            if parent is None
            else client.get_node(mapping.node_id_of(parent))
        )
        async with asyncio.timeout(self._connection.timeouts.browse_s):
            descriptions = await node.get_children_descriptions()
        return browse_items(descriptions)

    async def _ensure_subscription(
        self, resolved: Sequence[ResolvedPoint], on_value: ValueSink
    ) -> Subscription:
        """建订阅与回调对象，已有就复用。

        Args: resolved, on_value。
        """
        if self._subscription is not None and self._notifier is not None:
            return self._subscription
        client = self._require_client()
        self._notifier = DataChangeNotifier(sink=on_value, clock=self._clock)
        async with asyncio.timeout(self._connection.timeouts.request_s):
            self._subscription = await client.create_subscription(
                publish_interval_ms(resolved),
                # cast 的理由 —— asyncua 的回调协议把形参钉成 `val`，而本仓的
                # 命名闸禁缩写。它按**位置**调回调（源码里是
                # `datachange_notification(*args)`），名字不参与，因此这里只是
                # 名字上不兼容。上游若改成按关键字调，
                # tests/contract/test_asyncua_callback.py 会当场变红。
                cast("SubscriptionHandler", self._notifier),
            )
        return self._subscription

    async def _subscribe_batch(
        self,
        subscription: Subscription,
        batch: Sequence[ResolvedPoint],
        interval_ms: int,
    ) -> tuple[list[str], list[RejectedPoint]]:
        """订阅同一采样周期的一批点位。

        Args: subscription, batch, interval_ms。
        """
        client = self._require_client()
        nodes = [client.get_node(item.node_id) for item in batch]
        async with asyncio.timeout(self._connection.timeouts.request_s):
            raw: object = await subscription.subscribe_data_change(
                nodes,
                queuesize=QUEUE_SIZE,
                sampling_interval=ua.Duration(interval_ms),
            )
        accepted, rejected = merge_handles(batch, _as_sequence(raw))
        self._handles.update(accepted)
        for item in batch:
            if item.point.point_code in accepted and self._notifier is not None:
                self._notifier.track(
                    item.node_id.to_string(), item.point.point_code
                )
        return list(accepted), rejected

    def _nodes_for(
        self, point_codes: Sequence[str]
    ) -> tuple[list[str], list[Node]]:
        """把点位编码翻成节点；翻不了的直接不问现场。

        Args: point_codes。
        """
        client = self._require_client()
        queried: list[str] = []
        nodes: list[Node] = []
        for code in point_codes:
            point = self._points.get(code)
            if point is None:
                continue
            try:
                node_id = mapping.node_id_of(point.address)
            except ua.UaError:
                continue
            queried.append(code)
            nodes.append(client.get_node(node_id))
        return queried, nodes

    def _point_of(self, point_code: str) -> PointSpec:
        """取已登记的点位，没登记就抛。

        Args: point_code。
        """
        point = self._points.get(point_code)
        if point is None:
            raise PointNotLoaded(f"点位未登记：{point_code}")
        return point

    def _require_client(self) -> Client:
        """取当前会话，没连上就抛。"""
        if self._client is None:
            raise DriverNotConnected("OPC UA 会话尚未建立")
        return self._client


def _as_sequence(raw: object) -> Sequence[object]:
    """单个句柄与句柄表统一成表。

    ⚠ asyncua 按入参形状回值：给一个节点回一个句柄，给一批回一张表。不统一
    形状，批量订阅一个点位时就会把整数当成表去遍历。

    Args: raw。
    """
    if isinstance(raw, list):
        # 未知元素类型止步于此：调用方只按 int / StatusCode 判
        return cast("list[object]", raw)
    return [raw]


def _digest_of(secret: str | None) -> str:
    """口令的短摘要。留指纹不留口令——指纹进得了日志，口令进不了。

    Args: secret。
    """
    if secret is None:
        return ""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:DIGEST_LENGTH]
