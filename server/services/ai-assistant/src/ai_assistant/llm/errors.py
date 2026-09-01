"""模型这条链路上的异常 —— 定义在 `llmcore`，这里只再导出。

⚠ 不在这里另建一套：两处各定义一份的话，`except ModelUnavailable` 捕不到
另一处抛的那个同名类，而表现是「断路器该开的时候没开」。
"""

from llmcore.errors import (
    OUR_FAULT,
    ModelDisabled,
    ModelRejected,
    ModelUnavailable,
    classified,
    is_our_fault,
    reason_of,
)

__all__ = [
    "OUR_FAULT",
    "ModelDisabled",
    "ModelRejected",
    "ModelUnavailable",
    "classified",
    "is_our_fault",
    "reason_of",
]
