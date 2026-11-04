"""定时训练的并发配置与周期校验错误。"""

from lib.errors import AppError


class ScheduleRevisionConflict(AppError):
    code = 41441
    http_status = 409


class ScheduleInvalid(AppError):
    code = 41442
    http_status = 400
