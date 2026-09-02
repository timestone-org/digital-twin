"""错误码契约：领域号 23、码不重复、状态码真实。

⚠ 「HTTP 状态码必须真实」不是风格问题：恒 200 会让每一层缓存、每一个客户端
的重试与告警全部失效，而从外面看一切正常（api-contract §3）。
"""

import inspect

from knowledge_server.apps.chat import errors as chat_errors
from knowledge_server.apps.knowledge import errors as knowledge_errors
from knowledge_server.apps.speech import errors as speech_errors
from lib.errors import AppError

DOMAIN_PREFIX = 23
CODE_LENGTH = 5
# ⚠ 三个功能模块各有一份 errors.py，码却共用领域号 23：漏扫一份，那一份里
# 与别处撞号的码就没人拦
ERROR_MODULES = (knowledge_errors, chat_errors, speech_errors)


def _error_types() -> list[type[AppError]]:
    return [
        one
        for module in ERROR_MODULES
        for _, one in inspect.getmembers(module, inspect.isclass)
        if issubclass(one, AppError) and one is not AppError
    ]


def test_every_error_sits_in_domain_23() -> None:
    for one in _error_types():
        code = str(one.code)
        assert len(code) == CODE_LENGTH, one.__name__
        assert int(code[1:3]) == DOMAIN_PREFIX, one.__name__


def test_codes_are_unique() -> None:
    codes = [one.code for one in _error_types()]
    assert len(set(codes)) == len(codes)


def test_status_matches_the_first_digit() -> None:
    """⚠ 首位是 4 就必须真回 4xx：分段十进制的第一位就是 HTTP 首位。"""
    for one in _error_types():
        assert str(one.code)[0] == str(one.http_status)[0], one.__name__


def test_nothing_answers_with_a_bare_200() -> None:
    for one in _error_types():
        assert one.http_status >= 400, one.__name__
