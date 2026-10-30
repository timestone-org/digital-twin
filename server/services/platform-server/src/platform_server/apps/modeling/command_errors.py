"""建模写命令的恢复、参数一致性与外部操作者错误。"""

from lib.errors import AppError, RateLimited


class CommandNotFound(AppError):
    code = 41441
    http_status = 404


class CommandPayloadConflict(AppError):
    code = 41442
    http_status = 409


class CommandPending(AppError):
    code = 41443
    http_status = 409

    def __init__(self, command_id: str) -> None:
        super().__init__(
            "命令已受理但结果尚未确认，请查询原命令，不要创建新命令"
        )
        self.command_id = command_id


class LegacyCommandConflict(AppError):
    code = 41444
    http_status = 409


class ModelingRateLimited(RateLimited):
    def __init__(self, message: str, retry_after_s: int) -> None:
        super().__init__(message)
        self.retry_after_s = retry_after_s
