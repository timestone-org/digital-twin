"""大屏与绑定域的异常（错误码领域号 10）。

每个异常自带错误码与 HTTP 状态，处理器不做 `isinstance` 长链分派。
message 面向最终用户，不含表名、SQL、内网地址等内部信息。
404 同时覆盖「不存在」与「存在但无权看见」，不用 403 泄露 id 是否存在。
"""

from lib.errors import AppError


class ProjectNotFound(AppError):
    """项目不存在，或存在但调用者无权看见。"""

    code = 41001
    http_status = 404


class DashboardNotFound(AppError):
    """大屏不存在，或存在但调用者无权看见。"""

    code = 41002
    http_status = 404


class NodeNotFound(AppError):
    """画布节点不存在。"""

    code = 41003
    http_status = 404


class BindingNotFound(AppError):
    """绑定不存在。"""

    code = 41004
    http_status = 404


class ClientKeyTaken(AppError):
    """同一张大屏里已有同名 `client_key`。"""

    code = 41005
    http_status = 409


class FieldKeyTaken(AppError):
    """这个节点的该绑定槽已经绑过了。"""

    code = 41006
    http_status = 409


class VersionConflict(AppError):
    """行版本与库里不符：有人在你之前改过这张大屏，请重新加载。"""

    code = 41007
    http_status = 409


class ProjectNotEmpty(AppError):
    """项目下还有大屏。删项目前先删大屏。"""

    code = 41008
    http_status = 409


class LayoutInvalid(AppError):
    """节点树不合法：父节点、模块类型或绑定槽写错了。"""

    code = 41010
    http_status = 400


class BindingSourceInvalid(AppError):
    """绑定来源不合法：来源种类未注册，或指向的点位不存在。"""

    code = 41011
    http_status = 400


class ModuleTypeNotFound(AppError):
    """模块类型不在清单里。"""

    code = 41012
    http_status = 404


class ModuleCatalogUnreadable(AppError):
    """模块清单文件损坏或缺失，属于部署产物问题。"""

    code = 51001
    http_status = 500
