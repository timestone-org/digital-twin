"""装了哪几种检验。

⚠ 注册是**显式元组**，不靠 import 副作用（ADR-0029 决策四）。

⚠ **这里只有一种。** 「模型自己调一个校验工具」属于工具那一层，
「做完要自检」属于提示词纪律——两者都不是 `Verifier` 这个形状，硬塞进来
只会造出永远不会说话的检验器。
"""

from llmcore.reflection.ports import Verifier
from llmcore.reflection.verifiers.tool_failure import (
    ToolFailureVerifier,
)

VERIFIERS: tuple[Verifier, ...] = (ToolFailureVerifier(),)

__all__ = ["VERIFIERS", "ToolFailureVerifier"]
