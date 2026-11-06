"""OPC UA 驱动测试共用的客户端与订阅假件。"""

import asyncio
from collections.abc import Callable
from types import SimpleNamespace

from asyncua import ua

from collector_server.apps.collect.drivers.base import (
    DriverConnection,
    DriverTimeouts,
    PointSpec,
)
from collector_server.apps.collect.drivers.opcua import driver as opcua_driver
from collector_server.apps.collect.drivers.opcua.driver import OpcuaDriver
from collector_server.clock import Clock

NOW_MS = 1_767_323_045_000
MAX_NODES = opcua_driver.MAX_NODES_PER_READ


def make_readings(codes: list[str]) -> dict[str, ua.DataValue]:
    """每个点位一个互不相同的读数，配错位当场看得出来。

    Args: codes。
    """
    return {
        f"ns=2;s={code}": ua.DataValue(
            Value=ua.Variant(float(index)),
            StatusCode_=ua.StatusCode(0),
        )
        for index, code in enumerate(codes)
    }


class FakeNode:
    """asyncua `Node` 的最小替身。"""

    def __init__(self, node_id: ua.NodeId) -> None:
        self.nodeid = node_id
        self.written: list[object] = []
        self.children: list[ua.ReferenceDescription] = []

    async def write_value(self, value: object) -> None:
        self.written.append(value)

    async def get_children_descriptions(self) -> list[ua.ReferenceDescription]:
        return self.children


class FakeSubscription:
    """asyncua `Subscription` 的最小替身。"""

    def __init__(self) -> None:
        self.handles: list[int] = []
        self.batches: list[tuple[int, float]] = []
        self.dropped: list[int] = []
        self.next_handle = 1
        self.notifications: dict[str, ua.DataValue] = {}
        self.rejected: dict[str, ua.StatusCode] = {}
        self.error: BaseException | None = None

    async def subscribe_data_change(
        self,
        nodes: list[FakeNode],
        *,
        queuesize: int,
        # 形参名由 asyncua 定死，类型也照它的 `ua.Duration` 写
        sampling_interval: ua.Duration,
    ) -> list[int | ua.StatusCode]:
        self.batches.append((len(nodes), float(sampling_interval)))
        assert queuesize == opcua_driver.QUEUE_SIZE
        if self.error is not None:
            raise self.error
        taken = list(range(self.next_handle, self.next_handle + len(nodes)))
        self.next_handle += len(nodes)
        self.handles.extend(taken)
        for node in nodes:
            reading = self.notifications.get(node.nodeid.to_string())
            if reading is not None:
                self.notify(node, reading)
        return [
            self.rejected.get(node.nodeid.to_string(), handle)
            for node, handle in zip(nodes, taken, strict=True)
        ]

    def notify(self, node: FakeNode, reading: ua.DataValue) -> None:
        self.handler.datachange_notification(
            node,
            reading.Value.Value if reading.Value is not None else None,
            SimpleNamespace(monitored_item=SimpleNamespace(Value=reading)),
        )

    async def unsubscribe(self, handle: list[int]) -> None:
        self.dropped.extend(handle)


class FakeShortcuts:
    def __init__(self, objects: FakeNode) -> None:
        self.objects = objects


class FakeClient:
    """asyncua `Client` 的最小替身：只有驱动真正用到的那几件。"""

    def __init__(self, connection: DriverConnection) -> None:
        self.connection = connection
        self.uaclient = self
        self.continuations: dict[
            bytes, tuple[list[ua.ReferenceDescription], int]
        ] = {}
        self.released: list[bytes] = []
        self.next_continuation = 0
        self.browse_requests = 0
        self.is_page_limit_ignored = False
        self.is_connected = False
        self.is_checked = False
        self.is_connect_hung = False
        self.is_socket_closed = False
        self.nodes = FakeShortcuts(FakeNode(ua.NodeId(85)))
        self.subscription = FakeSubscription()
        # 寻址串 → 现场回的读数；表里没有的回一条坏读数
        self.values: dict[str, ua.DataValue] = {}
        self.built: dict[str, FakeNode] = {}
        # 寻址串 → 现场说它是哪个内建类型；表里没有的回一条坏读数
        self.types: dict[str, int] = {}
        self.type_error: Exception | None = None
        self.asked: list[tuple[int, list[str]]] = []
        # 现场的 MaxNodesPerRead；超了整批回 BadTooManyOperations
        self.max_nodes_per_read: int | None = None
        self.read_errors: dict[str, BaseException] = {}
        self.on_read: Callable[[], None] | None = None

    async def browse(
        self, parameters: ua.BrowseParameters
    ) -> list[ua.BrowseResult]:
        self.browse_requests += 1
        assert parameters.View.Timestamp == ua.get_win_epoch()
        node_id = parameters.NodesToBrowse[0].NodeId
        node = (
            self.nodes.objects
            if node_id.Identifier == 85
            else self.get_node(node_id)
        )
        if self.is_page_limit_ignored:
            return [ua.BrowseResult(References=node.children)]
        return self._page(
            node.children, parameters.RequestedMaxReferencesPerNode
        )

    def _page(
        self, references: list[ua.ReferenceDescription], limit: int
    ) -> list[ua.BrowseResult]:
        token = None
        if len(references) > limit:
            token = str(self.next_continuation).encode()
            self.next_continuation += 1
            self.continuations[token] = (references[limit:], limit)
        return [
            ua.BrowseResult(
                References=references[:limit], ContinuationPoint_=token
            )
        ]

    async def browse_next(
        self, parameters: ua.BrowseNextParameters
    ) -> list[ua.BrowseResult]:
        if parameters.ReleaseContinuationPoints:
            for point in parameters.ContinuationPoints:
                self.continuations.pop(point, None)
                self.released.append(point)
            return []
        token = parameters.ContinuationPoints[0]
        references, limit = self.continuations.pop(token, ([], 200))
        return self._page(references, limit)

    async def connect(self) -> None:
        if self.is_connect_hung:
            await asyncio.Event().wait()
        self.is_connected = True

    async def disconnect(self) -> None:
        self.is_connected = False

    def disconnect_socket(self) -> None:
        self.is_socket_closed = True

    async def check_connection(self) -> None:
        self.is_checked = True

    def get_node(self, node_id: ua.NodeId) -> FakeNode:
        return self.built.setdefault(node_id.to_string(), FakeNode(node_id))

    async def read_attributes(
        self,
        nodes: list[FakeNode],
        attribute: ua.AttributeIds = ua.AttributeIds.Value,
    ) -> list[ua.DataValue]:
        addresses = [node.nodeid.to_string() for node in nodes]
        self.asked.append((int(attribute), addresses))
        if addresses and addresses[0] in self.read_errors:
            raise self.read_errors[addresses[0]]
        if (
            self.max_nodes_per_read is not None
            and len(nodes) > self.max_nodes_per_read
        ):
            raise ua.UaStatusCodeError(ua.StatusCodes.BadTooManyOperations)
        if attribute != ua.AttributeIds.DataType:
            if self.on_read is not None:
                self.on_read()
            return [self._value_of(address) for address in addresses]
        if self.type_error is not None:
            raise self.type_error
        return [self._type_of(address) for address in addresses]

    def _value_of(self, address: str) -> ua.DataValue:
        found = self.values.get(address)
        if found is None:
            return ua.DataValue(StatusCode_=ua.StatusCode(0x80000000))
        return found

    def _type_of(self, address: str) -> ua.DataValue:
        found = self.types.get(address)
        if found is None:
            return ua.DataValue(StatusCode_=ua.StatusCode(0x80000000))
        return ua.DataValue(
            Value=ua.Variant(ua.NodeId(found), ua.VariantType.NodeId),
            StatusCode_=ua.StatusCode(0),
        )

    async def create_subscription(
        self, period: ua.Duration, handler: object
    ) -> FakeSubscription:
        self.subscription.period = period
        self.subscription.handler = handler
        return self.subscription


def make_spec(code: str, interval_ms: int = 1000) -> PointSpec:
    return PointSpec(
        point_code=code,
        address=f"ns=2;s={code}",
        sampling_interval_ms=interval_ms,
    )


def make_driver(
    *,
    clock: Clock = lambda: NOW_MS,
    request_s: float = 3.0,
    connect_s: float = 5.0,
    is_connect_hung: bool = False,
) -> tuple[OpcuaDriver, list[FakeClient]]:
    built: list[FakeClient] = []

    def factory(connection: DriverConnection) -> FakeClient:
        client = FakeClient(connection)
        client.is_connect_hung = is_connect_hung
        built.append(client)
        return client

    made = OpcuaDriver(
        connection=DriverConnection(
            endpoint="opc.tcp://127.0.0.1:4840/x",
            timeouts=DriverTimeouts(request_s=request_s, connect_s=connect_s),
        ),
        client_factory=factory,
        clock=clock,
    )
    return made, built


def make_child(name: str, *, is_variable: bool) -> ua.ReferenceDescription:
    """浏览回包里的一项。"""
    return ua.ReferenceDescription(
        NodeId=ua.ExpandedNodeId(Identifier=name, NamespaceIndex=2),
        BrowseName=ua.QualifiedName(name, 2),
        NodeClass_=(
            ua.NodeClass.Variable if is_variable else ua.NodeClass.Object
        ),
    )
