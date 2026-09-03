"""模型这条链路上的异常，以及**哪一档该让断路器打开**。

⚠ 分档不是分类学练习，是这一层最要紧的判断：
- 超时、连不上、限流、5xx = 「下游此刻不行」→ 该短路，能省下白等的时间。
- 401 / 403 / 400 = 「我们自己配错了或发错了」→ **绝不短路**：断路器一开，
  真正的原因就被盖成「暂时不可用」，而那会让人去查网络。

⚠ `message` 面向最终用户，**不带端点地址、不带模型名之外的上游细节、更不带
密钥**。排查靠日志里的同一个 `trace_id`（api-contract §4.2）。

⚠ 错误码领域号沿用 22（模型接入）。它认的是**出了什么事**而不是**谁出的事**，
所以两个消费方共用同一段——各服务自己的业务错误各用各的领域号。
"""

from openai import (
    APIConnectionError,
    APIStatusError,
    AuthenticationError,
    BadRequestError,
    OpenAIError,
    PermissionDeniedError,
)

from lib.errors import AppError

# 这几档说明「是我们发错了」，重试与短路都没有意义
OUR_FAULT = (AuthenticationError, PermissionDeniedError, BadRequestError)


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


def is_our_fault(error: OpenAIError) -> bool:
    """这一档是「我们发错了」还是「下游此刻不行」。

    ⚠ 判据只看异常类型，不看 message 文本：文案会改、会翻译，而按文本分支的
    代码在上游改一个词之后就静默走错分支（api-contract §4.2 同一条口径）。

    Args: error。
    """
    return isinstance(error, OUR_FAULT)


def reason_of(error: OpenAIError) -> str:
    """给人看的失败原因。

    ⚠ 只带异常类型与状态码，**不带 URL、密钥与响应体原文**：这句话会显示在
    界面上（api-contract §4.2）。

    Args: error。
    """
    if isinstance(error, APIConnectionError):
        return "连不上模型端点"
    if isinstance(error, AuthenticationError):
        return "模型端点拒绝了凭据"
    if isinstance(error, PermissionDeniedError):
        return "模型端点拒绝了这次调用"
    if isinstance(error, BadRequestError):
        return "模型端点认为请求不合法"
    if isinstance(error, APIStatusError):
        return f"模型端点回了 {error.status_code}"
    return "模型端点未响应"


# HTTP 状态码里属于「我们发错了」的那几档。⚠ 与 `OUR_FAULT` 是同一条判据的
# 另一副面孔：不走 openai 客户端的那些线形手上只有一个状态码，而两副面孔必须
# 给出同一个答案——漂开的表现是同一个 401 在一条链路上短路、在另一条上不短路
OUR_FAULT_STATUS: tuple[int, ...] = (400, 401, 403, 404, 422)

# 状态码到给人看的那句话。⚠ 只说状态码的语义，不带 URL、密钥与响应体原文
_STATUS_REASONS: dict[int, str] = {
    400: "模型端点认为请求不合法",
    401: "模型端点拒绝了凭据",
    403: "模型端点拒绝了这次调用",
    404: "模型端点上没有这个模型",
    422: "模型端点认为请求不合法",
    429: "模型端点在限流",
}


def is_our_fault_status(status: int) -> bool:
    """这个状态码是「我们发错了」还是「下游此刻不行」。

    Args: status。
    """
    return status in OUR_FAULT_STATUS


def reason_of_status(status: int) -> str:
    """给人看的失败原因。

    Args: status。
    """
    return _STATUS_REASONS.get(status, f"模型端点回了 {status}")


def classified_status(status: int) -> AppError:
    """把一个 HTTP 状态码收敛成本层的两档之一。

    ⚠ 与 `classified` 同一条口径：只有「下游此刻不行」那一档该让断路器计数。

    Args: status。
    """
    if is_our_fault_status(status):
        return ModelRejected(reason_of_status(status))
    return ModelUnavailable(reason_of_status(status))


def classified(error: OpenAIError) -> AppError:
    """把上游异常收敛成本层的两档之一。

    ⚠ 两档的差别不止于文案：`ModelUnavailable` 是可重试且**该让断路器计一次
    失败**的，`ModelRejected` 两样都不是。调用方据它决定要不要短路——
    所以这个函数不替调用方记失败，只回该抛哪一个。

    Args: error。
    """
    if is_our_fault(error):
        return ModelRejected(reason_of(error))
    return ModelUnavailable(reason_of(error))
