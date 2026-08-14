"""计划变更广播：发失败只记日志，不把已经落库的写操作变成 500。

守的是「通知是加速器不是保证」——collector 仍按周期全量重拉兜底。
"""

from lib.errors import DependencyUnavailable
from platform_server.apps.collect.services.plan_notifier import (
    EVENT_KIND,
    PlanNotifier,
)
from unit.collect_fakes import FakeChannelPublisher

CHANNEL = "collect:plan:changed"


async def test_a_change_reaches_the_channel_with_its_reason() -> None:
    publisher = FakeChannelPublisher()
    notifier = PlanNotifier(publisher=publisher, channel=CHANNEL)
    await notifier.notify(reason="point_changed")
    channel, payload = publisher.published[0]
    assert channel == CHANNEL
    assert payload["kind"] == EVENT_KIND
    assert payload["reason"] == "point_changed"


async def test_the_broadcast_envelope_carries_the_link() -> None:
    # ⚠ pub/sub 是跨进程的异步交接，contextvars 传不过去：漏了它链路就在这里齐断
    publisher = FakeChannelPublisher()
    notifier = PlanNotifier(publisher=publisher, channel=CHANNEL)
    await notifier.notify(reason="source_changed")
    traceparent = publisher.published[0][1]["traceparent"]
    assert isinstance(traceparent, str)
    assert traceparent.startswith("00-")
    assert len(traceparent.split("-")) == 4


async def test_a_broken_channel_does_not_fail_the_write() -> None:
    publisher = FakeChannelPublisher(
        failure=DependencyUnavailable("缓存服务暂时不可用")
    )
    notifier = PlanNotifier(publisher=publisher, channel=CHANNEL)
    await notifier.notify(reason="source_changed")
    assert publisher.published == []
