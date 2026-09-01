"""建模域的异常（错误码领域号 14，见 docs/agents/api-contract.md §4.1）。

每个异常自带错误码与 HTTP 状态，处理器不做 `isinstance` 长链分派。
message 面向最终用户，不含表名、SQL、内网地址等内部信息。
"""

from lib.errors import AppError


class PipelineNotFound(AppError):
    """流水线不存在，或存在但调用者无权看见。"""

    code = 41401
    http_status = 404


class PipelineCodeTaken(AppError):
    """流水线编码已被占用。"""

    code = 41402
    http_status = 409


class GraphInvalid(AppError):
    """图不合法。逐条问题挂在 `details` 上，界面按它定位到节点或连线。"""

    code = 41403
    http_status = 400


class PipelineHasVersions(AppError):
    """这条流水线下还有模型版本，删之前要先退役它们。"""

    code = 41404
    http_status = 409


class RunNotFound(AppError):
    """运行记录不存在。"""

    code = 41405
    http_status = 404


class RunAlreadyActive(AppError):
    """这条流水线已经有一次运行在途。

    ⚠ 它对应的是数据库上那条部分唯一索引，不是应用层的抢锁：并发发起时由
    Postgres 直接拒掉第二次（docs/MODELING_DESIGN.md D17）。
    """

    code = 41406
    http_status = 409


class RunNotCancellable(AppError):
    """已经是终态的运行取消不了。"""

    code = 41407
    http_status = 409


class NodeRunNotFound(AppError):
    """这次运行里没有这个节点的记录。"""

    code = 41408
    http_status = 404


class ModelVersionNotFound(AppError):
    """模型版本不存在。"""

    code = 41409
    http_status = 404


class RunNotPublishable(AppError):
    """只有成功跑完、且产出了模型的运行才能发布成版本。"""

    code = 41410
    http_status = 409


class RunAlreadyPublished(AppError):
    """一次运行至多发布一个版本。"""

    code = 41411
    http_status = 409


class ModelVersionUnservable(AppError):
    """这个版本不可上线，绑不到公式条目上。原因在 message 里。"""

    code = 41412
    http_status = 409


class ModelVersionInUse(AppError):
    """还有绑定指着这个版本，退役之前要先解绑。"""

    code = 41413
    http_status = 409


class BindingNotFound(AppError):
    """绑定不存在。"""

    code = 41414
    http_status = 404


class BindingCodeTaken(AppError):
    """这条公式条目已经绑过一个模型版本了。"""

    code = 41415
    http_status = 409


class BindingParamsMismatch(AppError):
    """公式条目的形参与模型的特征列对不上。"""

    code = 41416
    http_status = 409
