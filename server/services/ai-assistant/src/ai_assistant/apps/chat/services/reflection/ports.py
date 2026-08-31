"""层 6 反思反馈的扩展点：一步做完之后，回答「这一步成没成」。

⚠ **本期只立接缝与归位，不新增运行时环节。** 每加一次真实检验就多一次模型往返，
而已有的三样（工具失败如实回执、`dashboard.validate` 悬空引用自检、提示词里的
截图自检纪律）已经覆盖了最要紧的场景。先让第四样有地方加。

⚠ 判定**不许改写那一步的产出**。检验器只回一句结论，改不改由编排层与模型定——
就地改写的话，模型看到的结果与它自己刚做的事对不上，而它会以为是工具坏了。
"""

from dataclasses import dataclass
from typing import Literal, Protocol, runtime_checkable

from ai_assistant.apps.chat.services.turn_types import TurnStep

# 三档结论。⚠ 没有「不确定」这一档：检验器答不出来就不该 `applies`，
# 摆一个恒为「不确定」的结论，等于让模型每一步都多读一句废话
Verdict = Literal["ok", "warn", "failed"]


@dataclass(frozen=True)
class Finding:
    """一次检验的结论。"""

    verdict: Verdict
    # 一句人话，会进工具结果给模型看，所以要说清「哪里不对、下一步该干什么」
    message: str


@runtime_checkable
class Verifier(Protocol):
    """一种检验。"""

    name: str

    def applies(self, step: TurnStep) -> bool:
        """这一步归不归我管。

        ⚠ 判得窄一点：管得太宽的检验器会对每一步都说点什么，而那些话会把真正
        要紧的那一条淹掉。

        Args: step。
        """
        ...

    async def check(self, step: TurnStep) -> Finding:
        """检一次。只有 `applies` 为真时才会被调到。

        Args: step。
        """
        ...
