"""守本驱动与 asyncua 之间那两个不在文档化公开 API 里的约定。

⚠ 上游一改，表现是「订阅建起来了但一个值都不回调」——静默失效比报错难查
一个量级，所以把它钉在这里。
"""

import inspect

from asyncua.common.subscription import Subscription

from collector_server.apps.collect.drivers.opcua.notifier import (
    DataChangeNotifier,
)

# asyncua 分发回调的那一行
POSITIONAL_CALL = "datachange_notification(*args)"


def test_asyncua_calls_the_value_callback_positionally() -> None:
    """形参名因此可以自定——本仓叫 `value`，asyncua 的协议叫 `val`。"""
    assert POSITIONAL_CALL in inspect.getsource(Subscription)


def test_asyncua_awaits_the_callback_only_when_it_is_a_coroutine() -> None:
    """所以同步回调不会给事件循环排任务，这正是 ValueSink 必须同步的原因。"""
    assert "iscoroutinefunction" in inspect.getsource(Subscription)


def test_the_callback_takes_node_value_and_notification() -> None:
    signature = inspect.signature(DataChangeNotifier.datachange_notification)
    assert list(signature.parameters) == ["self", "node", "value", "data"]
