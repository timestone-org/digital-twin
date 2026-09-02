"""层 6 的注册表：一步做完之后过一遍检验。

⚠ **本期这条路还没有人调。** 回合循环（`planning/turn.py`）不经过这里——
每加一次真实检验就多一次模型往返，而现有那套「失败必回执」已经在回合内做完了。
这里立的是接缝：第四种检验要加时有地方放，且加它不用改编排层。

⚠ 立而不用是**刻意的**，不是漏了。真接进回合循环时要先回答一个问题：检验结论
以什么身份进上下文——多一条工具消息，还是并进那一步的产出。两种口径对模型的
影响不同，而那是另一期的决定。
"""

from llmcore.reflection.ports import Finding, Verifier
from llmcore.reflection.verifiers import VERIFIERS
from llmcore.turn.types import TurnStep


async def check_step(
    step: TurnStep, verifiers: tuple[Verifier, ...] = VERIFIERS
) -> tuple[Finding, ...]:
    """这一步过一遍检验，按注册序给出全部结论。

    ⚠ 只问 `applies` 为真的那几个：判得宽的检验器会对每一步都说点什么，
    而那些话会把真正要紧的那一条淹掉。

    Args: step, verifiers（默认是注册表里那几个；测试注自己的进来）。
    """
    return tuple(
        [await one.check(step) for one in verifiers if one.applies(step)]
    )
