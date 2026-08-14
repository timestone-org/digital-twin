"""采集运行时的领域异常。

`reason` 是发给 platform 的**稳定字面量**：命令总线的应答里带它，配置面按它
翻成自己的错误码（COLLECT_DESIGN.md §5）。改字面量等于改对外契约。
"""


class CollectError(Exception):
    """采集侧全部异常的根。子类只覆盖 `reason`。"""

    reason: str = "collect_failed"


class UnknownProtocol(CollectError):
    """计划里的 protocol 没有对应驱动。"""

    reason: str = "unknown_protocol"


class PlanUnavailable(CollectError):
    """拿不到采集计划。

    ⚠ 降级方向是空转 + 响亮告警，**不许用过期缓存猜**（ADR-0001）：
    用错的计划采数据比不采更糟，它会写出看似正常的错误历史。
    """

    reason: str = "plan_unavailable"


class SourceOffline(CollectError):
    """数据源当前没有活着的会话，命令没法执行。"""

    reason: str = "source_offline"


class UnknownAction(CollectError):
    """命令总线上来了一个本服务不认识的动作。"""

    reason: str = "unknown_action"


class MissingPointCode(CollectError):
    """写值请求没带点位编码。"""

    reason: str = "missing_point_code"
