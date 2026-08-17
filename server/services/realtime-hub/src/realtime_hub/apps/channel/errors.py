"""通道域的异常（错误码领域号 20）。

每个异常自带错误码与 HTTP 状态，处理器不做 `isinstance` 长链分派。
message 面向最终用户，不含内部信息——不写库表名、不写副本名。
"""

from lib.errors import AppError


class TopicNotDeclared(AppError):
    """主题未登记。

    ⚠ 订阅未登记的主题必须**响亮失败**，不许放行（ADR-0007 §决策 5）。
    开放命名空间的代价是主题名拼错不再是语法错误；放行的话，一个拼错名字
    的客户端会安静地永远收不到数据——最难查的那类故障。
    """

    code = 42001
    http_status = 404


class TopicAlreadyDeclared(AppError):
    """主题已被登记，且声明的权限码与本次不同。

    ⚠ 同码重复登记是幂等的、不报这个错：注销走 at-least-once，推送方重试
    是正常路径。只有「同名不同码」才是真冲突——那意味着两个推送方在抢同
    一个主题，放过去会让订阅授权按谁先登记而定。
    """

    code = 42002
    http_status = 409


class UnknownPermissionCode(AppError):
    """声明的权限码不在 auth-server 的权限码目录里。

    ⚠ 这条挡的是「编造一个不存在的码」。它挡不住「声明一个存在但过宽的
    码」——hub 没有判断宽窄的依据，那一截靠权限码目录本身的评审兜。
    """

    code = 42003
    http_status = 400


class CodeCatalogUnavailable(AppError):
    """auth-server 不可达，无法校验声明的权限码。

    ⚠ fail-closed：拒绝登记，不放行（CONTEXT.md §7）。放行的话一次 auth
    抖动就会让一个**声明未经校验**的主题永久留在库里，而登记是一次性动作、
    没有第二次校验的机会。拒绝的代价只是推送方重试一次。
    """

    code = 52001
    http_status = 503


class UserCodesUnavailable(AppError):
    """auth-server 不可达，取不到这个用户此刻持有的权限码。

    ⚠ fail-closed：拒绝握手，不许按空码放行。空码集合在授权那一步的表现是
    「每个主题都没权限」，客户端收到的是 403 而不是 503——它会当成「我确实
    没权限」而不再重连，于是 auth 恢复之后通道也不会自己回来。
    """

    code = 52002
    http_status = 503


class PayloadTooLarge(AppError):
    """单条推送的条目数超过上限。

    ⚠ 分片是**推送方**的事：hub 一旦知道「哪些载荷可以拆」，就又长出业务
    知识了（ADR-0007 §决策，节流归推送方）。
    """

    code = 42004
    http_status = 413


class SubscriptionDenied(AppError):
    """调用者的权限码不包含该主题声明的码。"""

    code = 42005
    http_status = 403
