"""值监听的失败处置：监听不上只降级，不许把实例拖死。

⚠ 这一层守的是「可选链路不决定实例生死」：订阅建不上、热加失败、撤订阅
失败，实例都必须照常服务，代价只是少实时推送。正路径由 integration 那组
用真实例守着，这里专门打假件注入失败。
"""

import asyncio
import uuid

from asyncua import ua

from opcua_server.apps.instance.runtime.valuewatch import (
    ValueWatcher,
    _unwrap,
)

INSTANCE = uuid.UUID("3fa85f64-5717-4562-b3fc-2c963f66afa6")


async def _noop(
    _instance_id: uuid.UUID, _identifier: str, _value: object
) -> None:
    return None


def _watcher() -> ValueWatcher:
    return ValueWatcher(instance_id=INSTANCE, on_change=_noop)


class _NodeId:
    def __init__(self, text: str) -> None:
        self._text = text

    def to_string(self) -> str:
        return self._text


class _Node:
    def __init__(self, text: str) -> None:
        self.nodeid = _NodeId(text)


class _Subscription:
    """可注入失败点的假订阅。"""

    def __init__(
        self,
        *,
        refuse_from_call: int | None = None,
        should_refuse_delete: bool = False,
    ) -> None:
        self.calls = 0
        self.subscribed: list[object] = []
        self.is_deleted = False
        self._refuse_from_call = refuse_from_call
        self._should_refuse_delete = should_refuse_delete

    async def subscribe_data_change(self, nodes: list[object]) -> None:
        self.calls += 1
        refuse_from = self._refuse_from_call
        if refuse_from is not None and self.calls >= refuse_from:
            raise RuntimeError("subscribe refused")
        self.subscribed.extend(nodes)

    async def delete(self) -> None:
        if self._should_refuse_delete:
            raise RuntimeError("delete refused")
        self.is_deleted = True


class _Server:
    """create_subscription 可失败的假服务器。"""

    def __init__(self, subscription: _Subscription | None) -> None:
        self._subscription = subscription
        self.attempts = 0

    async def create_subscription(
        self, _period_ms: int, _handler: object
    ) -> _Subscription:
        self.attempts += 1
        if self._subscription is None:
            raise RuntimeError("no subscription for you")
        return self._subscription


async def test_a_refused_subscription_degrades_instead_of_raising() -> None:
    # ⚠ 监听不上意味着「没有实时推送」，实例本身必须照常起
    server = _Server(None)
    watcher = _watcher()
    await watcher.watch(server, {"t": _Node("ns=2;s=t")})
    # 降级后热加与停止都要安静跳过——没有订阅可补、可撤，也不再重试
    await watcher.add("p", _Node("ns=2;s=p"))
    await watcher.stop()
    assert server.attempts == 1


async def test_a_failed_hot_add_is_logged_not_raised() -> None:
    # ⚠ 一个节点没挂上监听，不能把已经在推的其他节点一起拖下水
    subscription = _Subscription(refuse_from_call=2)
    watcher = _watcher()
    await watcher.watch(_Server(subscription), {"t": _Node("ns=2;s=t")})
    await watcher.add("p", _Node("ns=2;s=p"))
    await watcher.stop()
    assert subscription.is_deleted is True


async def test_a_failed_unsubscribe_on_stop_is_tolerated() -> None:
    # ⚠ 实例正在停，订阅随服务器一起消失；这里失败不该冒泡打断关停
    subscription = _Subscription(should_refuse_delete=True)
    watcher = _watcher()
    await watcher.watch(_Server(subscription), {"t": _Node("ns=2;s=t")})
    await watcher.stop()
    assert subscription.is_deleted is False


async def test_a_change_on_an_unknown_node_is_ignored() -> None:
    # ⚠ 停机窗口里节点表已清空，这时的回调只能安静丢弃，不能派任务
    seen: list[str] = []

    async def on_change(
        _instance_id: uuid.UUID, identifier: str, _value: object
    ) -> None:
        seen.append(identifier)

    watcher = ValueWatcher(instance_id=INSTANCE, on_change=on_change)
    watcher.datachange_notification(_Node("ns=2;s=ghost"), 1.0, None)
    await asyncio.sleep(0)
    assert seen == []


def test_unwrap_peels_datavalue_and_variant() -> None:
    # asyncua 的通知值包着 DataValue(Variant(...))，推给页面前要剥成裸值
    wrapped = ua.DataValue(Value=ua.Variant(5.5))
    assert _unwrap(wrapped) == 5.5
