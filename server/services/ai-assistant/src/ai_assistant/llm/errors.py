"""模型这条链路上的异常。错误码领域号 22。

⚠ `message` 面向最终用户，**不带端点地址、模型名之外的上游细节、更不带密钥**。
排查靠日志里的同一个 `trace_id`（api-contract §4.2）。
"""

from lib.errors import AppError


class ModelDisabled(AppError):
    """本部署没开模型。不是故障，是这套环境就没接。"""

    code = 52201
    http_status = 503


class ModelUnavailable(AppError):
    """模型端点暂时不可用（超时 / 连不上 / 限流 / 断路器打开着）。"""

    code = 52202
    http_status = 503
    is_retryable = True


class ModelRejected(AppError):
    """模型端点拒绝了这次请求（凭据不对 / 请求不合法）。

    ⚠ 与上面那条分开是刻意的：这一档**重试没有意义**，也不该让断路器打开——
    断路器一打开，真正的原因（密钥配错了）就被盖成「暂时不可用」，
    而那会让人去查网络。
    """

    code = 52203
    http_status = 502
