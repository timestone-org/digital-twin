"""失败分档：哪一档该让断路器打开，是这一层最要紧的判断。

⚠ 判错的代价是**把真正的原因盖掉**：密钥配错了却让断路器打开，报出来的是
「暂时不可用」，于是人会去查网络——查很久。
"""

import httpx
import pytest
from openai import (
    APIConnectionError,
    APIStatusError,
    AuthenticationError,
    BadRequestError,
    OpenAIError,
    PermissionDeniedError,
    RateLimitError,
)

from llmcore.errors import (
    ModelRejected,
    ModelUnavailable,
    classified,
    is_our_fault,
    reason_of,
)

_REQUEST = httpx.Request("POST", "http://model-endpoint/v1/chat/completions")


def _status(code: int) -> httpx.Response:
    return httpx.Response(code, request=_REQUEST)


def _auth() -> AuthenticationError:
    return AuthenticationError("", response=_status(401), body=None)


def _forbidden() -> PermissionDeniedError:
    return PermissionDeniedError("", response=_status(403), body=None)


def _bad_request() -> BadRequestError:
    return BadRequestError("", response=_status(400), body=None)


def _rate_limited() -> RateLimitError:
    return RateLimitError("", response=_status(429), body=None)


@pytest.mark.parametrize(
    "error", [_auth(), _forbidden(), _bad_request()], ids=["401", "403", "400"]
)
def test_our_own_mistakes_never_open_the_breaker(error: OpenAIError) -> None:
    """⚠ 401 / 403 / 400 是「我们发错了」：重试与短路都没有意义。"""
    assert is_our_fault(error) is True
    assert isinstance(classified(error), ModelRejected)


@pytest.mark.parametrize(
    "error",
    [
        _rate_limited(),
        APIConnectionError(request=_REQUEST),
        APIStatusError("", response=_status(503), body=None),
        OpenAIError("说不清"),
    ],
    ids=["429", "连不上", "503", "认不出"],
)
def test_downstream_trouble_is_retryable(error: OpenAIError) -> None:
    """⚠ 限流也算「下游此刻不行」：它正是短路最该省下白等时间的那一档。"""
    assert is_our_fault(error) is False
    made = classified(error)
    assert isinstance(made, ModelUnavailable)
    assert made.is_retryable is True


def test_an_unclassified_failure_still_reads_as_unavailable() -> None:
    """⚠ 认不出的异常按「下游不行」处理，不按「我们发错了」：判反的话，
    一次真实的端点故障会被当成配置错误而永远不短路。"""
    assert isinstance(classified(OpenAIError("说不清")), ModelUnavailable)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (APIConnectionError(request=_REQUEST), "连不上模型端点"),
        (_auth(), "模型端点拒绝了凭据"),
        (_forbidden(), "模型端点拒绝了这次调用"),
        (_bad_request(), "模型端点认为请求不合法"),
        (APIStatusError("", response=_status(503), body=None), "回了 503"),
        (OpenAIError("说不清"), "模型端点未响应"),
    ],
    ids=["连不上", "401", "403", "400", "503", "认不出"],
)
def test_the_reason_is_specific_enough_to_act_on(
    error: OpenAIError, expected: str
) -> None:
    assert expected in reason_of(error)


def test_the_reason_never_leaks_the_endpoint() -> None:
    """⚠ 这句话会显示在界面上：带 URL 就等于把内网地址贴给了每一个用户。"""
    error = APIStatusError("", response=_status(500), body=None)
    assert "model-endpoint" not in reason_of(error)
    assert "http" not in reason_of(error)
