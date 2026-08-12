"""空调与空间域的异常（错误码领域号 16）。

每个异常自带错误码与 HTTP 状态，处理器不做 `isinstance` 长链分派。
message 面向最终用户，不含表名、SQL、内网地址等内部信息。
认证与授权不在本域自开码，直接用 `lib.errors` 的 40100 / 40106。
"""

from lib.errors import AppError


class WorkshopNotFound(AppError):
    """车间不存在，或存在但调用者无权看见。"""

    code = 41601
    http_status = 404


class RoomNotFound(AppError):
    """房间不存在。"""

    code = 41602
    http_status = 404


class AcUnitNotFound(AppError):
    """空调不存在。"""

    code = 41603
    http_status = 404


class WorkshopNameTaken(AppError):
    """车间名已被占用。车间名全场唯一。"""

    code = 41604
    http_status = 409


class RoomNameTaken(AppError):
    """同一车间内已有同名房间。"""

    code = 41605
    http_status = 409


class AcUnitSerialTaken(AppError):
    """空调序号已被占用。序号是全场唯一的设备编号。"""

    code = 41606
    http_status = 409


class WorkshopNotEmpty(AppError):
    """车间下还有房间。删车间前先清空它。"""

    code = 41607
    http_status = 409


class RoomNotEmpty(AppError):
    """房间里还有空调。删房间前先把空调改派到别的房间。"""

    code = 41608
    http_status = 409


class DatasetNotFound(AppError):
    """数据集不存在。目录见 apps/hvac/datasets.py。"""

    code = 41609
    http_status = 404


class BindingNotFound(AppError):
    """这台空调还没有绑定该数据集，无从取数。"""

    code = 41610
    http_status = 404


class SourceObjectInvalid(AppError):
    """数据源对象名不合法，或在外部库中不存在。"""

    code = 41611
    http_status = 422


class SourceObjectShapeMismatch(AppError):
    """数据源对象的列形状与数据集不符。"""

    code = 41612
    http_status = 422


class TimeRangeInvalid(AppError):
    """查询区间不合法：缺时区、倒置，或超出跨度上限。"""

    code = 41613
    http_status = 422


class MetricUnknown(AppError):
    """指标不在目录内，或该指标不支持配置达标范围。"""

    code = 41614
    http_status = 422


class CursorInvalid(AppError):
    """游标不可解析。它是不透明串，只能从上一页响应里原样带回。"""

    code = 41615
    http_status = 422


class StartupRebuildInProgress(AppError):
    """这个房间已经有一次抽取在跑。重复触发只会白算一遍。"""

    code = 41616
    http_status = 409


class SourceUnavailable(AppError):
    """外部数据源不可用。⚠ 不返回陈旧数据兜底——查不到就明确说查不到。"""

    code = 51601
    http_status = 503
    is_retryable = True
