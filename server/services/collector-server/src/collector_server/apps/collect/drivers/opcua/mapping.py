"""OPC UA 的协议特有决断：取哪个时间戳、状态码归哪一档、异常算哪一类。

⚠ 决断只允许发生在这里。管道侧只看得到干净的四元组，「信息是在哪一步丢的」
必须在驱动里查得到（ADR-0011 代价一）。
"""

from datetime import UTC, datetime

from asyncua import ua
from asyncua.ua.uaerrors import (
    BadAttributeIdInvalid,
    BadCertificateUntrusted,
    BadIdentityTokenInvalid,
    BadIdentityTokenRejected,
    BadNodeIdInvalid,
    BadNodeIdUnknown,
    BadNotReadable,
    BadNotWritable,
    BadSecurityChecksFailed,
    BadTypeMismatch,
    BadUserAccessDenied,
    BadUserSignatureInvalid,
    BadWriteNotSupported,
    UaStringParsingError,
)

from collector_server.apps.collect.drivers.base import ErrorCategory
from timeseries import Quality

# 换凭据或改安全策略才能好，重连一万次也是同一个结果
_AUTH_ERRORS = (
    BadUserAccessDenied,
    BadUserSignatureInvalid,
    BadIdentityTokenInvalid,
    BadIdentityTokenRejected,
    BadCertificateUntrusted,
    BadSecurityChecksFailed,
)
# 寻址串或数据类型配错了，要人去改配置，不是等它自己好
_CONFIG_ERRORS = (
    BadNodeIdUnknown,
    BadNodeIdInvalid,
    BadAttributeIdInvalid,
    BadTypeMismatch,
    BadNotReadable,
    BadNotWritable,
    BadWriteNotSupported,
    UaStringParsingError,
)


def quality_of(status: ua.StatusCode | None) -> Quality:
    """把 32 位 StatusCode 归到协议无关的三档。

    ⚠ 只取严重度那两位，**不透传原始码**：它是 OPC UA 特有的掩码，
    Modbus 根本没有对应物，存进归档表等于让读侧去认识协议（ADR-0011）。
    缺状态码时判 bad——判不出质量却当好数据用，会污染台账。

    Args: status。
    """
    if status is None:
        return "bad"
    if status.is_good():
        return "good"
    if status.is_uncertain():
        return "uncertain"
    return "bad"


def timestamp_ms_of(value: ua.DataValue, *, fallback_ms: int) -> int:
    """取一次读数的时刻，UTC 毫秒。

    ⚠ SourceTimestamp 优先：它是设备打在这个物理量上的时刻；ServerTimestamp
    只说明 PLC 的 OPC UA 服务端**什么时候处理了它**，链路一慢两者能差出几秒，
    按后者归档会把趋势整体右移。两个都没有才落回本地时钟。

    Args: value, fallback_ms（本地时钟，末位兜底）。
    """
    moment = value.SourceTimestamp or value.ServerTimestamp
    if moment is None:
        return fallback_ms
    return _epoch_ms(moment)


def _epoch_ms(moment: datetime) -> int:
    """datetime 转 UTC 毫秒。

    ⚠ asyncua 可能给不带时区的 datetime，一律按 UTC 解释：当本地时区解释会
    让整条曲线偏移一个时区，而数值本身完全正常，没人会察觉。

    Args: moment。
    """
    aware = moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)
    return int(aware.timestamp() * 1000)


def category_of(error: BaseException) -> ErrorCategory:
    """把 asyncua 的异常判成三档。

    ⚠ 默认判 transient：认不出的异常按「等一等再试」处理，比按「别试了」
    处理安全——后者会让一次未知抖动变成永久停采。

    Args: error。
    """
    if isinstance(error, _AUTH_ERRORS):
        return "auth"
    if isinstance(error, _CONFIG_ERRORS):
        return "config"
    return "transient"


def node_id_of(address: str) -> ua.NodeId:
    """把点位的协议寻址串解析成 NodeId，如 `ns=2;s=Temp1`。

    Args: address。
    """
    # pyright: ignore 的理由 —— asyncua 的 from_string 形参标成 Unknown
    return ua.NodeId.from_string(  # pyright: ignore[reportUnknownMemberType]
        address
    )
