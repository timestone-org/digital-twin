"""命令总线的线形：键名、动作与结论字面量、信封字段。

platform 发命令、collector 执行并回值（docs/COLLECT_DESIGN.md §5.3）。
两侧都只认这一份——键名或动作名漂了不会有类型错误，只会让每一次命令都白等
到超时，而现象离原因极远。
"""

# 一问一答的两个键：请求进一条公共列表，应答按 request_id 各进各的
REQUEST_KEY = "collect:cmd:req"
REPLY_PREFIX = "collect:cmd:reply"

# 信封里承载链路的键名，与 api-contract §10 的消息契约同名
TRACEPARENT_KEY = "traceparent"

# ⚠ 阻塞取/等的连接不能用 1s 的 socket 超时：BLPOP/BRPOP 阻塞满一拍就会被驱动层
# 判成读超时抛出来，于是「现场还没答复」被报成「Redis 坏了」。socket 超时必须比
# 阻塞时长再宽一点
BLOCK_SOCKET_MARGIN_S = 5.0
# BLPOP/BRPOP 回包里 `(键名, 内容)` 这一对的长度
REPLY_PAIR_LENGTH = 2

ACTION_BROWSE = "browse"
# 一次收齐整棵子树，勾上层节点用。⚠ 与 browse 是两个动作而不是一个带开关的
# 参数：两者的设备负载差着两个数量级、预算也不是一档
ACTION_BROWSE_SUBTREE = "browse_subtree"
ACTION_READ = "read"
ACTION_WRITE = "write"
ACTION_VALIDATE = "validate"

# 线上存在的全部动作。⚠ 不等于某个采集版本**实现**了的动作：实现集是它的子集，
# 由 collector 自己声明，未实现的一律回 `REASON_UNKNOWN_ACTION`
ACTIONS = (
    ACTION_BROWSE,
    ACTION_BROWSE_SUBTREE,
    ACTION_READ,
    ACTION_WRITE,
    ACTION_VALIDATE,
)

STATUS_OK = "ok"
STATUS_ERROR = "error"

# 采集侧回的稳定 `reason`，配置面按它翻成自己的错误码
REASON_SOURCE_OFFLINE = "source_offline"
REASON_BROWSE_UNSUPPORTED = "browse_unsupported"
REASON_WRITE_UNSUPPORTED = "write_unsupported"
REASON_UNKNOWN_ACTION = "unknown_action"
REASON_MISSING_POINT_CODE = "missing_point_code"
REASON_UNKNOWN_PROTOCOL = "unknown_protocol"
REASON_PLAN_UNAVAILABLE = "plan_unavailable"
REASON_COLLECT_FAILED = "collect_failed"
# 驱动抛了一个非领域异常：形状未知，只能如实说「执行失败」
REASON_DRIVER_FAILED = "driver_failed"

# 发起方自造的两条：应答里根本没有 status 字段 / 采集侧一句话都没回。
# ⚠ 它们不会出现在采集侧的应答里，只用于把「没有结论」表达成一个 reason
REASON_MALFORMED_REPLY = "malformed_reply"
REASON_COLLECTOR_UNREACHABLE = "collector_unreachable"


def reply_key(request_id: str) -> str:
    """一次请求的应答键。

    Args: request_id。
    """
    return f"{REPLY_PREFIX}:{request_id}"
