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
    classified_status,
    detail_of,
    is_our_fault,
    is_our_fault_status,
    reason_of,
    reason_of_status,
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


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
def test_the_status_bucket_agrees_with_the_exception_bucket(
    status: int,
) -> None:
    """⚠ 按状态码分档与按异常类型分档必须给同一个答案：漂开的表现是同一个
    401 在一条链路上短路、在另一条上不短路。"""
    assert is_our_fault_status(status) is True
    assert isinstance(classified_status(status), ModelRejected)


@pytest.mark.parametrize("status", [429, 500, 502, 503])
def test_downstream_status_codes_are_the_retryable_bucket(status: int) -> None:
    assert is_our_fault_status(status) is False
    assert classified_status(status).is_retryable is True


def test_an_unnamed_status_still_says_which_one_it_was() -> None:
    assert "418" in reason_of_status(418)


def test_the_reason_never_leaks_the_endpoint() -> None:
    """⚠ 这句话会显示在界面上：带 URL 就等于把内网地址贴给了每一个用户。"""
    error = APIStatusError("", response=_status(500), body=None)
    assert "model-endpoint" not in reason_of(error)
    assert "http" not in reason_of(error)


def test_the_machine_readable_detail_is_kept_for_the_log() -> None:
    """⚠ 「模型端点认为请求不合法」对排查毫无帮助：真实原因只在上游的错误体
    里。实测踩过一次——一台 `n_ctx=6656` 的本地端点，检索回执一进上下文就
    400，而日志里看不出跟长度有任何关系。"""
    error = BadRequestError(
        "",
        response=_status(400),
        body={
            "error": {
                "code": 400,
                "message": "request (9010 tokens) exceeds the available "
                "context size (6656 tokens), try increasing it",
                "type": "exceed_context_size_error",
                "n_prompt_tokens": 9010,
                "n_ctx": 6656,
            }
        },
    )

    made = detail_of(error)

    assert made["type"] == "exceed_context_size_error"
    assert made["n_prompt_tokens"] == "9010"
    assert made["n_ctx"] == "6656"


def test_the_free_text_message_never_reaches_the_log() -> None:
    """⚠ `message` 是自由文本，有的端点会把请求内容原样回显进去——而请求内容
    不许进日志（observability §3）。"""
    error = BadRequestError(
        "",
        response=_status(400),
        body={"error": {"type": "x", "message": "你的点位密码是 hunter2"}},
    )

    assert "message" not in detail_of(error)


def test_a_body_less_rejection_yields_nothing_rather_than_blowing_up() -> None:
    """端点回一句纯文本 400 是常事；取不到细节不该把这条链路再炸一次。"""
    assert detail_of(_bad_request()) == {}
