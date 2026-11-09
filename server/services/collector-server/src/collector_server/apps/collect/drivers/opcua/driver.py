"""OPC UA 会话、点位表与读写装配；协议边界见 CONTEXT.md §3。"""

import asyncio
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from typing import cast

from asyncua import Client, Node, ua
from asyncua.common.subscription import Subscription, SubscriptionHandler

from collector_server.apps.collect.drivers.base import (
    BrowseItem,
    BrowsePage,
    BrowsePageTooLarge,
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
from collector_server.apps.collect.drivers.opcua.browse import BrowsePager
from collector_server.apps.collect.drivers.opcua.connection import (
    close_session,
    open_session,
)
from collector_server.apps.collect.drivers.opcua.initial import read_initial
from collector_server.apps.collect.drivers.opcua.notifier import (
    DataChangeNotifier,
)
from collector_server.clock import Clock, utc_now_ms
from collectwire import DEFAULT_BROWSE_LIMIT, DataType
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
# 一次 Read 最多问多少个节点。⚠ 服务端普遍有 MaxNodesPerRead 上限，超了是
# 整批回 BadTooManyOperations 而不是截断——切批是唯一的解
MAX_NODES_PER_READ = 100

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
    if any(
        connection.options.get(key, "None") != "None"
        for key in (
            "security_mode",
            "security_policy",
        )
    ):
        raise mapping.UnsupportedSecurity(
            "当前采集驱动尚不支持证书安全连接，请勿将其作为加密连接使用"
        )
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
    """把引用描述翻成协议无关条目，变量的工程属性不作为子点位。

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


async def typed_items(
    client: Client, items: list[BrowseItem], *, timeout_s: float
) -> list[BrowseItem]:
    """批量补上当前页变量的值类型，读不到时留空。

    Args: client, items, timeout_s。
    """
    addresses = [item.address for item in items if item.is_variable]
    if not addresses:
        return items
    found = await data_types_of(client, addresses, timeout_s=timeout_s)
    return [
        (
            replace(item, data_type=found.get(item.address))
            if item.is_variable
            else item
        )
        for item in items
    ]


async def data_types_of(
    client: Client, addresses: Sequence[str], *, timeout_s: float
) -> dict[str, DataType]:
    """问一批变量的值类型；问不到的不进结果。

    Args: client, addresses, timeout_s。
    """
    found: dict[str, DataType] = {}
    try:
        for start in range(0, len(addresses), MAX_NODES_PER_READ):
            batch = addresses[start : start + MAX_NODES_PER_READ]
            nodes = [
                client.get_node(mapping.node_id_of(address))
                for address in batch
            ]
            async with asyncio.timeout(timeout_s):
                values = await client.read_attributes(
                    nodes, ua.AttributeIds.DataType
                )
            found.update(mapping.data_types_of(batch, values))
    except Exception as error:
        _logger.warning(
            "browse_data_types_unread",
            "这一层的值类型没读到，建点位时不预选类型",
            error_type=type(error).__name__,
        )
    return found


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
        self._browser: BrowsePager | None = None
        self._subscription: Subscription | None = None
        self._notifier: DataChangeNotifier | None = None
        self._points: dict[str, PointSpec] = {}
        self._handles: dict[str, int] = {}

    @property
    def capabilities(self) -> DriverCapabilities:
        """OPC UA 三样都支持。"""
        return CAPABILITIES

    def load_points(self, points: Sequence[PointSpec]) -> int:
        """登记 point_code → 寻址串，**整表替换**。

        Args: points。
        """
        self._points = {point.point_code: point for point in points}
        return len(self._points)

    def _remember(self, points: Sequence[PointSpec]) -> None:
        """登记增量点位，保留尚未变更的既有点位。Args: points。"""
        self._points.update({point.point_code: point for point in points})

    def classify_error(self, error: BaseException) -> ErrorCategory:
        """判成 transient / config / auth 三档。

        Args: error。
        """
        return mapping.category_of(error)

    async def connect(self) -> None:
        """建会话。"""
        client = self._factory(self._connection)
        await open_session(client, self._connection.timeouts)
        self._client = client
        self._browser = BrowsePager(
            client,
            clock=self._clock,
            timeout_s=self._connection.timeouts.browse_s,
            release_timeout_s=self._connection.timeouts.request_s,
        )

    async def disconnect(self) -> None:
        """拆会话。拆不掉也要把本地状态清干净，否则重连会认为自己还连着。"""
        browser, self._browser = self._browser, None
        client, self._client = self._client, None
        self._subscription = None
        self._notifier = None
        self._handles.clear()
        try:
            if browser is not None:
                await browser.close()
        finally:
            if client is not None:
                await close_session(client, self._connection.timeouts)

    async def healthcheck(self) -> None:
        """心跳探针：探不到就抛，由会话循环判断线。"""
        client = self._require_client()
        async with asyncio.timeout(self._connection.timeouts.request_s):
            await client.check_connection()

    async def subscribe(
        self, points: Sequence[PointSpec], on_value: ValueSink
    ) -> SubscribeResult:
        """订阅并补齐初值。Args: points, on_value（必须纯同步）。"""
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
        try:
            async with asyncio.timeout(self._connection.timeouts.request_s):
                await subscription.unsubscribe([handle for _, handle in taken])
        finally:
            # ⚠ 不论服务端怎么答都先断本地路由：句柄已经摘掉，重试只会退 0
            # 条，而删掉的点位会一直往快照与归档里写
            if self._notifier is not None:
                for code, _ in taken:
                    self._notifier.forget(code)
        return len(taken)

    async def read_many(self, point_codes: Sequence[str]) -> list[Sample]:
        """分批读取并按请求顺序逐位对齐。Args: point_codes。"""
        client = self._require_client()
        now_ms = self._clock()
        queried, nodes = self._nodes_for(point_codes)
        if not nodes:
            return [(None, now_ms, "bad") for _ in point_codes]
        values: list[ua.DataValue] = []
        for start in range(0, len(nodes), MAX_NODES_PER_READ):
            batch = nodes[start : start + MAX_NODES_PER_READ]
            async with asyncio.timeout(self._connection.timeouts.request_s):
                values.extend(await client.read_attributes(batch))
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
        """兼容旧浏览调用，大目录明确要求使用分页。Args: parent。"""
        page = await self.browse_page(parent)
        if page.continuation_token is not None:
            await self.release_browse(page.continuation_token)
            raise BrowsePageTooLarge("目录需要分页，请升级浏览客户端后重新浏览")
        return list(page.items)

    async def browse_page(
        self,
        parent: str | None,
        *,
        limit: int = DEFAULT_BROWSE_LIMIT,
        continuation_token: str | None = None,
    ) -> BrowsePage:
        """浏览一个有界页，只为本页变量读取类型。"""
        client = self._require_client()
        browser = self._browser
        if browser is None:
            raise DriverNotConnected("OPC UA 会话尚未建立")
        page = await browser.page(
            parent, limit=limit, continuation_token=continuation_token
        )
        try:
            items = await typed_items(
                client,
                browse_items(page.references),
                timeout_s=self._connection.timeouts.request_s,
            )
        except BaseException:
            if page.continuation_token is not None:
                await browser.release(page.continuation_token)
            raise
        return BrowsePage(tuple(items), page.continuation_token)

    async def release_browse(self, continuation_token: str) -> None:
        """释放未消费完的浏览游标。"""
        if self._browser is not None:
            await self._browser.release(continuation_token)

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
                # ⚠ cast 只兼容其 `val` 参数名；按位置回调由契约测试守住。
                cast("SubscriptionHandler", self._notifier),
            )
        return self._subscription

    async def _subscribe_batch(
        self,
        subscription: Subscription,
        batch: Sequence[ResolvedPoint],
        interval_ms: int,
    ) -> tuple[list[str], list[RejectedPoint]]:
        """订阅同周期的一批点位，并主动读取每个点位的初值。"""
        client = self._require_client()
        nodes = [client.get_node(item.node_id) for item in batch]
        notifier = self._notifier
        # ⚠ 首次通知可能早于订阅请求返回，必须先登记映射。
        if notifier is not None:
            for item in batch:
                notifier.stage(item.node_id.to_string(), item.point.point_code)
        try:
            async with asyncio.timeout(self._connection.timeouts.request_s):
                raw: object = await subscription.subscribe_data_change(
                    nodes,
                    queuesize=QUEUE_SIZE,
                    sampling_interval=ua.Duration(interval_ms),
                )
        except BaseException:
            if notifier is not None:
                for item in batch:
                    notifier.forget(item.point.point_code)
            raise
        accepted, rejected = merge_handles(batch, _as_sequence(raw))
        self._handles.update(accepted)
        if notifier is not None:
            for item in rejected:
                notifier.forget(item.point_code)
            notifier.confirm(list(accepted))
            await read_initial(
                list(accepted),
                read_many=self.read_many,
                notifier=notifier,
                batch_size=MAX_NODES_PER_READ,
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
