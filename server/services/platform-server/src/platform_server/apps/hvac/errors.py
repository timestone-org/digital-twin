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


class SourceObjectInvalid(AppError):
    """数据源对象名不合法，或在外部库中不存在。"""

    code = 41611
    http_status = 422


class MetricUnknown(AppError):
    """指标不在目录内，或该指标不支持配置达标范围。"""

    code = 41614
    http_status = 422
