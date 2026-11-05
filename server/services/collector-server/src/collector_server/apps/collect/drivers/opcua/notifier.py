"""订阅回调：把 asyncua 的值变化通知翻成协议无关的四元组交给 sink。

⚠ 本文件是「协议知识止步」的那条缝，见 ADR-0011 与 COLLECT_DESIGN.md §4.3。
"""

from collections.abc import Sequence

from asyncua import Node
from asyncua.common.subscription import DataChangeNotif

from collector_server.apps.collect.drivers.base import Sample, ValueSink
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
        self._codes: dict[str, dict[str, None]] = {}
        self._node_ids: dict[str, str] = {}
        self._versions: dict[str, int] = {}
        self._next_version = 0
        self._provisional: dict[str, Sample | None] = {}

    def track(self, node_id: str, point_code: str) -> None:
        """登记一个 NodeId 对应的点位，保留同地址别名。"""
        self.forget(point_code)
        self._codes.setdefault(node_id, {})[point_code] = None
        self._node_ids[point_code] = node_id
        self._advance(point_code)

    def stage(self, node_id: str, point_code: str) -> None:
        """预登记待订阅点位，在订阅确认前暂存早到通知。"""
        self.track(node_id, point_code)
        self._provisional[point_code] = None

    def confirm(self, point_codes: Sequence[str]) -> None:
        """只放行成功订阅点位暂存的首值。"""
        for code in point_codes:
            sample = self._provisional.pop(code, None)
            if sample is not None:
                self._emit(code, sample)

    def forget(self, point_code: str) -> None:
        """退订后把映射摘掉，免得回调里认出一个已经不采的点位。

        Args: point_code。
        """
        node_id = self._node_ids.pop(point_code, None)
        self._versions.pop(point_code, None)
        self._provisional.pop(point_code, None)
        if node_id is None:
            return
        tracked = self._codes[node_id]
        del tracked[point_code]
        if not tracked:
            del self._codes[node_id]

    def prepare_initial(self, point_codes: Sequence[str]) -> dict[str, int]:
        """记录仍在采集点位的版本，供补读结果防竞态。"""
        return {
            code: self._versions[code]
            for code in point_codes
            if code in self._versions
        }

    def feed_initial(
        self, point_code: str, sample: Sample, *, version: int
    ) -> None:
        """补读期间收到通知或点位重新登记时，丢弃迟到的补读。"""
        if self._versions.get(point_code) == version:
            self._emit(point_code, sample)

    def _advance(self, point_code: str) -> None:
        self._next_version += 1
        self._versions[point_code] = self._next_version

    def _emit(self, point_code: str, sample: Sample) -> None:
        self._advance(point_code)
        if point_code in self._provisional:
            self._provisional[point_code] = sample
            return
        self._sink(point_code, *sample)

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
        point_codes = self._codes.get(node.nodeid.to_string())
        if not point_codes:
            return
        reading = data.monitored_item.Value
        sample: Sample = (
            value,
            mapping.timestamp_ms_of(reading, fallback_ms=self._clock()),
            mapping.quality_of(reading.StatusCode),
        )
        for point_code in point_codes:
            self._emit(point_code, sample)
