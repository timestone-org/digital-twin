"""报告领域错误，领域号 13。"""

from lib.errors import AppError


class ReportNotFound(AppError):
    """目标不存在。"""

    code = 41301
    http_status = 404


class ReportConflict(AppError):
    """版本或唯一键冲突。"""

    code = 41302
    http_status = 409


class ReportInvalid(AppError):
    """报告输入无效。"""

    code = 41303
    http_status = 400


class ReportUnavailable(AppError):
    """生成产物尚不可用。"""

    code = 41304
    http_status = 409


class ReportPreviewTimeout(AppError):
    """试算超过请求预算。"""

    code = 51301
    http_status = 504


class ReportQueueFull(AppError):
    """报告队列已达到背压水位。"""

    code = 41305
    http_status = 429
