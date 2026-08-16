"""计划变更通知：改完配置就往 Redis 广播一声，让 collector 立刻重拉。

⚠ 通知是**加速器不是保证**：pub/sub 即发即弃，订阅方断开期间发出的消息就是
丢了。collector 仍按周期全量重拉兜底，两者缺一不可（COLLECT_DESIGN §4.4）。
⚠ 必须在事务**提交之后**发：提交前发出去，collector 拉到的还是旧配置，而它
不会再拉第二次（database-standard §6）。
"""

from dataclasses import dataclass
from typing import Protocol

from collectwire import TRACEPARENT_KEY
from lib.logging import current_traceparent, get_logger

_logger = get_logger("platform.collect.plan")

EVENT_KIND = "plan_changed"


class ChannelPublisher(Protocol):
    """往一个频道发一条消息的最小面。真实现是 `lib.cache.PubSub`。"""

    async def publish(self, channel: str, payload: dict[str, object]) -> int:
        """发一条消息，返回收到它的订阅者数。

        Args: channel, payload。
        """
        ...


@dataclass(frozen=True)
class PlanNotifier:
    """计划变更的广播口。"""

    publisher: ChannelPublisher
    channel: str

    async def notify(self, *, reason: str) -> None:
        """广播一次「计划变了」。

        ⚠ 发失败只记日志不抛：配置已经落库了，为了一条加速通知把 200 变成 500
        是在拿已成功的写操作赌一件本来就有兜底的事。
        ⚠ traceparent 在这一层就盖进信封：pub/sub 是跨进程的异步交接，
        contextvars 传不过去，漏了它链路就在这里齐断（observability §4.2）。
        Args: reason（哪一类配置改了，稳定字面量）。
        """
        payload: dict[str, object] = {
            "kind": EVENT_KIND,
            "reason": reason,
            TRACEPARENT_KEY: current_traceparent(),
        }
        try:
            await self.publisher.publish(self.channel, payload)
        except Exception as error:
            _logger.warning(
                "plan_notify_failed",
                "计划变更通知未发出，collector 将按周期重拉兜底",
                reason=reason,
                error_type=type(error).__name__,
            )
            return
        _logger.info("plan_notified", "已广播计划变更", reason=reason)
