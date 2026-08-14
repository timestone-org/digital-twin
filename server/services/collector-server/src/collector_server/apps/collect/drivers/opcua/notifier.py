"""订阅回调：把 asyncua 的值变化通知翻成协议无关的四元组交给 sink。

⚠ 本文件是「协议知识止步」的那条缝，见 ADR-0011 与 COLLECT_DESIGN.md §4.3。
"""

from asyncua import Node
from asyncua.common.subscription import DataChangeNotif

from collector_server.apps.collect.drivers.base import ValueSink
from collector_server.apps.collect.drivers.opcua import mapping
from collector_server.clock import Clock


class DataChangeNotifier:
    """asyncua 订阅的回调对象。一个会话一个。"""

    def __init__(self, *, sink: ValueSink, clock: Clock) -> None:
        """按 sink 与时钟初始化，点位映射由 `track` 逐个登记。

        Args: sink, clock。
        """
        self._sink = sink
        self._clock = clock
        self._codes: dict[str, str] = {}

    def track(self, node_id: str, point_code: str) -> None:
        """登记一个 NodeId 字符串对应哪个点位。

        Args: node_id, point_code。
        """
        self._codes[node_id] = point_code

    def forget(self, point_code: str) -> None:
        """退订后把映射摘掉，免得回调里认出一个已经不采的点位。

        Args: point_code。
        """
        for node_id, tracked in list(self._codes.items()):
            if tracked == point_code:
                del self._codes[node_id]

    def datachange_notification(
        self, node: Node, value: object, data: DataChangeNotif
    ) -> None:
        """asyncua 每收到一次值变化就调它。

        ⚠ 形参靠**位置**对上 asyncua（它按 `(node, value, event)` 顺序调），
        名字可以自定。
        ⚠ 这个方法**必须是同步的、零 await**。asyncua 也接受协程形态的回调，
        但那样两万个点位的每一次变化都会往事件循环里排一个任务，采集当场被
        压垮——参考实现在这里踩过（COLLECT_DESIGN.md §4.1）。

        Args: node, value, data。
        """
        point_code = self._codes.get(node.nodeid.to_string())
        if point_code is None:
            return
        reading = data.monitored_item.Value
        self._sink(
            point_code,
            value,
            mapping.timestamp_ms_of(reading, fallback_ms=self._clock()),
            mapping.quality_of(reading.StatusCode),
        )
