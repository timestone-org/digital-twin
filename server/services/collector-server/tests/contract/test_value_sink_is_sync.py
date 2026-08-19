"""守 `ValueSink` 的形状：它必须是**纯同步、零 await** 的回调。

⚠ 两万个点位的回调里只要有一个 await，事件循环当场被压垮
（COLLECT_DESIGN.md §4.1）。这条只能靠契约测试兜——写成协程不会报错。
"""

import ast
import inspect
from pathlib import Path
from uuid import uuid4

from collector_server.apps.collect.archive.buffer import ArchiveBuffer
from collector_server.apps.collect.drivers.opcua.notifier import (
    DataChangeNotifier,
)
from collector_server.apps.collect.runtime.sink import (
    SnapshotSink,
    ValueBuffer,
    fan_out,
)

SINKS = (
    ValueBuffer.record,
    ArchiveBuffer.record,
    DataChangeNotifier.datachange_notification,
)


def test_every_sink_entry_point_is_a_plain_function() -> None:
    assert not any(inspect.iscoroutinefunction(sink) for sink in SINKS)


def test_no_sink_entry_point_awaits_anything() -> None:
    awaited: list[str] = []
    for sink in SINKS:
        tree = ast.parse(inspect.getsource(sink).lstrip())
        awaited.extend(
            sink.__qualname__
            for node in ast.walk(tree)
            if isinstance(node, ast.Await)
        )
    assert awaited == []


def test_the_sink_handed_to_a_driver_is_the_plain_recorder() -> None:
    class Store:
        """什么都不做的快照面。"""

        async def write_many(self, *_args: object, **_kwargs: object) -> None:
            return None

        async def drop(self, *_args: object) -> None:
            return None

        async def ping(self) -> bool:
            return True

        async def close(self) -> None:
            return None

    sink = SnapshotSink(store=Store(), interval_ms=300, ttl_s=60).sink_for(
        uuid4()
    )
    assert not inspect.iscoroutinefunction(sink)


def test_the_two_branches_are_fed_from_one_plain_callback() -> None:
    seen: list[str] = []
    combined = fan_out(
        lambda code, _value, _ts_ms, _quality: seen.append(f"snapshot:{code}"),
        lambda code, _value, _ts_ms, _quality: seen.append(f"archive:{code}"),
    )
    combined("outlet_temp", 21.5, 1, "good")
    assert seen == ["snapshot:outlet_temp", "archive:outlet_temp"]


def test_the_combined_sink_is_still_a_plain_function() -> None:
    combined = fan_out(
        lambda _code, _value, _ts_ms, _quality: None,
        lambda _code, _value, _ts_ms, _quality: None,
    )
    assert not inspect.iscoroutinefunction(combined)


def test_the_contract_is_written_down_where_it_is_declared() -> None:
    base = (
        Path(__file__).resolve().parents[2]
        / "src/collector_server/apps/collect/drivers/base.py"
    )
    assert "零 await" in base.read_text(encoding="utf-8")
