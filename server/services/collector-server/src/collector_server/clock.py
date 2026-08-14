"""可注入的时钟：全服务「现在是几毫秒」只有这一个来源。

⚠ 被测路径里不许直接 `datetime.now()`——测试要给固定值
（docs/agents/testing-standard-python.md §6.1）。
"""

from collections.abc import Callable

from lib.utils.timeutils import utcnow

# 返回当前 UTC 毫秒
Clock = Callable[[], int]


def utc_now_ms() -> int:
    """当前时刻的 UTC 毫秒。"""
    return int(utcnow().timestamp() * 1000)
