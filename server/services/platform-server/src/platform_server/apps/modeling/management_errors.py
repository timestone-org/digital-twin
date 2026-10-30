"""模型管理的归档、并发保护与切换错误。"""

from lib.errors import AppError


class ModelingArchived(AppError):
    code = 41431
    http_status = 409


class ModelingResourceInUse(AppError):
    code = 41432
    http_status = 409


class DeploymentRevisionConflict(AppError):
    code = 41433
    http_status = 409


class DeploymentVersionMismatch(AppError):
    code = 41434
    http_status = 409


class DeploymentSignatureChanged(AppError):
    code = 41435
    http_status = 409


class DeploymentSwitchNotFound(AppError):
    code = 41436
    http_status = 404
