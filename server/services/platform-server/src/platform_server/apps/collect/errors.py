"""点位与采集域的异常（错误码领域号 11）。

每个异常自带错误码与 HTTP 状态，处理器不做 `isinstance` 长链分派。
message 面向最终用户，不含表名、SQL、内网地址等内部信息。
"""

from lib.errors import AppError


class SourceNotFound(AppError):
    """数据源不存在，或存在但调用者无权看见。"""

    code = 41101
    http_status = 404


class PointNotFound(AppError):
    """点位不存在。"""

    code = 41102
    http_status = 404


class SourceCodeTaken(AppError):
    """数据源编码已被占用。"""

    code = 41103
    http_status = 409


class PointCodeTaken(AppError):
    """同一个数据源下已有同名点位编码。"""

    code = 41104
    http_status = 409


class PointInUse(AppError):
    """点位还被大屏绑着。

    ⚠ 这条正是配置面必须留在 platform 的理由（ADR-0001 理由一）：绑定表在
    platform 的库里，把配置面搬进 collector 就要为每次删除反向 RPC 回来问。
    """

    code = 41105
    http_status = 409


class SourceNotEmpty(AppError):
    """数据源下还有点位。删数据源前先删点位。"""

    code = 41106
    http_status = 409


class SourceOffline(AppError):
    """采集侧当前没有这个数据源的活会话，命令没法执行。"""

    code = 41107
    http_status = 409


class SourceInvalid(AppError):
    """数据源配置不合法：协议、读取模式或连接参数写错了。"""

    code = 41110
    http_status = 400


class PointInvalid(AppError):
    """点位配置不合法：寻址串或采样参数写错了。"""

    code = 41111
    http_status = 400


class BrowseUnsupported(AppError):
    """本协议没有地址空间可浏览。

    ⚠ 不用空列表表达「不支持」：空列表与「这台设备确实没有点位」分不开，
    会让配置界面静默摆出一棵空树（ADR-0011）。
    """

    code = 41112
    http_status = 400


class WriteUnsupported(AppError):
    """本协议或本连接不允许下发写值。"""

    code = 41113
    http_status = 400


class IdempotencyKeyRequired(AppError):
    """下发写值必须带幂等键。

    ⚠ 没有它，一次网络抖动引发的客户端重试就会向物理设备写两次
    （api-contract §7）。
    """

    code = 41114
    http_status = 400


class HistoryQueryInvalid(AppError):
    """历史查询的参数不合法。"""

    code = 41115
    http_status = 400


class CollectorUnreachable(AppError):
    """命令总线上没有等到应答。

    ⚠ 用在**写值**上时调用方不许重试：超时不代表没写成功，盲目重试可能向
    现场下发两次（runtime-resilience §2）。`is_retryable` 因此保持假。
    """

    code = 51101
    http_status = 503


class CommandFailed(AppError):
    """采集侧执行命令失败。"""

    code = 51102
    http_status = 502


class HistoryUnavailable(AppError):
    """归档库暂时读不了。"""

    code = 51103
    http_status = 503
    is_retryable = True
