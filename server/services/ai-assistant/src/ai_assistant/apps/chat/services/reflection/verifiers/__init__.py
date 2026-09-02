"""装了哪几种检验。

⚠ 注册是**显式元组**，不靠 import 副作用（ADR-0029 决策四）。

⚠ **这里只有一种，而不是三种。** V4 规划 §2.6 点名的另外两样都不是
`Verifier` 这个形状，硬塞进来只会造出两个永远不会说话的检验器：

- `dashboard.validate` 是**模型自己调的一个服务端工具**，不是一步做完之后的
  旁路检查。它的位置在工具那一层，已经在了。
- 「截图自检」是**提示词纪律**（`memory/prompt.py` 的计划纪律那一段），
  它约束的是模型怎么排计划，落不到某一个 `TurnStep` 上。
"""

from llmcore.reflection.ports import Verifier
from llmcore.reflection.verifiers.tool_failure import (
    ToolFailureVerifier,
)

VERIFIERS: tuple[Verifier, ...] = (ToolFailureVerifier(),)

__all__ = ["VERIFIERS", "ToolFailureVerifier"]
