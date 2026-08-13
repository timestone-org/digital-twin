"""地址空间的值变化监听：内部订阅一条，覆盖两条写入路径。

管理面的写值与上位机经 opc.tcp 的反向写值，最终都落到同一棵地址空间上。
在服务器**自己**身上开一条内部订阅，两条路径就都被同一个回调看见——不必在
每处写入点各挂一次钩子，也就不会漏掉将来新增的写入路径。

⚠ 用的是 asyncua 文档化的公开 API（`create_subscription` 与
`subscribe_data_change`），不是会话追踪那种子类注入的私有扩展点，
所以不受 `==1.1.8` 那条钉死的约束。
"""

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from asyncua import ua

from lib.logging import get_logger

_logger = get_logger("opcua.valuewatch")

# 内部订阅的发布周期。⚠ 真正的节流在 ValuePublisher 的合并窗口里，这里只要
# 足够密、别把变化压掉：设得比合并窗口大，一个窗口内就可能一次变化都收不到。
WATCH_PERIOD_MS = 100

# 值变化回调：(实例 id, 节点标识, 新值)
type OnValueChange = Callable[[uuid.UUID, str, object], Awaitable[None]]


class ValueWatcher:
    """一台实例的值变化监听。"""

    def __init__(
        self, *, instance_id: uuid.UUID, on_change: OnValueChange
    ) -> None:
        self._instance_id = instance_id
        self._on_change = on_change
        # asyncua 的 NodeId → 我们的节点标识。回调只给 Node，得自己映回去
        self._identifiers: dict[str, str] = {}
        self._subscription: Any = None

    async def watch(self, server: Any, nodes: dict[str, Any]) -> None:
        """订阅这批节点的值变化。

        ⚠ 失败只记日志不抛：监听不上意味着「没有实时推送」，而实例本身照常
        对上位机服务。把它做成硬失败会让一条**可选**链路决定实例能不能起。

        Args: server, nodes。
        """
        if not nodes:
            return
        self._identifiers = {
            node.nodeid.to_string(): identifier
            for identifier, node in nodes.items()
        }
        try:
            # ⚠ server 在这一层是 Any：asyncua 的 create_subscription 与
            # subscribe_data_change 形参无标注，收敛就收在这个边界上
            self._subscription = await server.create_subscription(
                WATCH_PERIOD_MS, self
            )
            await self._subscription.subscribe_data_change(list(nodes.values()))
        except Exception as error:
            _logger.error(
                "value_watch_failed",
                "值变化监听未建立，该实例不会有实时推送",
                instance_id=str(self._instance_id),
                error_type=type(error).__name__,
            )
            self._subscription = None

    async def add(self, identifier: str, node: Any) -> None:
        """把运行中新加的节点补进订阅。

        ⚠ 不补的话，热加的节点**永远不会推值**：订阅集是在实例启动那一刻定
        下来的。而热加是文档化的能力（CONTEXT.md §6 的热生效档），表现会是
        「新加的点在页面上永远不动」，且没有任何报错。

        Args: identifier, node。
        """
        if self._subscription is None:
            return
        self._identifiers[str(node.nodeid.to_string())] = identifier
        try:
            await self._subscription.subscribe_data_change([node])
        except Exception as error:
            _logger.error(
                "value_watch_add_failed",
                "新节点未能加入值监听，它不会推值",
                identifier=identifier,
                error_type=type(error).__name__,
            )

    async def stop(self) -> None:
        """撤订阅。已经没有就什么都不做。"""
        subscription = self._subscription
        self._subscription = None
        if subscription is None:
            return
        try:
            await subscription.delete()
        except Exception as error:
            # 实例正在停，订阅随服务器一起消失；这里失败无所谓
            _logger.warning(
                "value_watch_stop_failed",
                "撤销值监听失败，随实例停止一并释放",
                error_type=type(error).__name__,
            )

    def datachange_notification(
        self, node: Any, value: object, _data: object
    ) -> None:
        """asyncua 的回调。

        ⚠ 它是**同步**的：不能在这里 await。把活儿交给 ValuePublisher 的
        `record`，而 record 需要 await——所以这里派一个任务出去。
        ⚠ 任务句柄存进集合再在完成时移除：asyncio 只持弱引用，不存的话它可能
        在运行中被 GC 掉，表现是「有些值变化没推出去」且没有任何报错。

        Args: node, value, _data。
        """
        identifier = self._identifiers.get(str(node.nodeid.to_string()))
        if identifier is None:
            return
        _spawn(self._on_change(self._instance_id, identifier, _unwrap(value)))


def _unwrap(value: object) -> object:
    """把 asyncua 的包装值剥成裸值。

    Args: value。
    """
    if isinstance(value, ua.DataValue):
        return _unwrap(value.Value)
    if isinstance(value, ua.Variant):
        return value.Value
    return value


_running: set[Any] = set()


def _spawn(coroutine: Awaitable[None]) -> None:
    """把协程派成任务并持住引用直到完成。

    Args: coroutine。
    """
    task = asyncio.ensure_future(coroutine)
    _running.add(task)
    task.add_done_callback(_running.discard)
