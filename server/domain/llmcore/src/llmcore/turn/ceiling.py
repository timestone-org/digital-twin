"""回合步数上限：图的递归上限错误在这里换成领域错误。"""

from collections.abc import Generator
from contextlib import contextmanager

from langgraph.errors import GraphRecursionError

from llmcore.errors import TurnStepLimitReached

# 撞到步数上限时给人看的那句话
STEP_LIMIT_MESSAGE = "这一轮的步骤太多，已停下，请把问题拆小一点再试"


@contextmanager
def step_ceiling() -> Generator[None]:
    """把 langgraph 的递归上限错误换成 `TurnStepLimitReached`。

    ⚠ 两个服务的 `:advance` 只把 AppError 落成 error 帧，裸的
    `GraphRecursionError` 会让流无声断掉。
    """
    try:
        yield
    except GraphRecursionError as error:
        raise TurnStepLimitReached(STEP_LIMIT_MESSAGE) from error
