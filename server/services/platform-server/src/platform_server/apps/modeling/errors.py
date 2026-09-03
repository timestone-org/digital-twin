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


class DeploymentNotFound(AppError):
    """部署不存在。

    ⚠ 对外面拿不到部署时也用它：`code` 打错与「这个部署被删了」对调用方是
    同一件事，分开报等于送一个「哪些 code 存在」的枚举接口。
    """

    code = 41417
    http_status = 404


class DeploymentCodeTaken(AppError):
    """这个对外标识已经被别的部署占了。"""

    code = 41418
    http_status = 409


class DeploymentDisabled(AppError):
    """部署已停用。⚠ 403 而不是静默返回旧值。"""

    code = 41419
    http_status = 403


class DeploymentUnservable(AppError):
    """这个部署钉的版本上不了线（产物没了、跨版本、或本来就不可服务）。"""

    code = 41420
    http_status = 410


class ApiKeyInvalid(AppError):
    """密钥无效。

    ⚠ 「不存在」「已撤销」「已过期」共用这一个：分开报等于送一个枚举接口。
    消息里也**只有这四个字**。
    """

    code = 41421
    http_status = 401


class ApiKeyNotFound(AppError):
    """管理面按 id 找不到这把密钥。"""

    code = 41422
    http_status = 404


class PredictRequestInvalid(AppError):
    """对外预测请求的形状不对：行数超限、缺列、或值不是数。"""

    code = 41423
    http_status = 400


class BindingEntryChanged(AppError):
    """新版本的入口契约与这条绑定当初对上的不一样，要用户确认过再换。

    ⚠ 不自动重映射：按名字自动映射会在「两个版本恰好都有两个入口列、名字
    不同」时把甲的值喂给乙，而结果看着完全正常
    （docs/MODELING_PLATFORM_DESIGN.md D18）。
    """

    code = 41424
    http_status = 409


class FrameExportMissing(AppError):
    """这次运行没有留下这个端口的全量结果，或者它已经过了保留期。"""

    code = 41425
    http_status = 404
