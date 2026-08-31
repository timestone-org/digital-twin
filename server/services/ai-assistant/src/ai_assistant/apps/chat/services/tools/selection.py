"""按名字集合取规格 —— 层 5 这一半。

层 2 只回答「这一轮准许出现哪些名字」，把名字换成规格是这一层的事。分开是因为
两半的不变量不同：那边是「只许收窄」，这边是「顺序即契约」。

⚠ **顺序是契约**：产出保持 `specs` 的原序，而不是名字集合的顺序（集合根本没有
顺序）。工具在提示词里的先后影响模型的第一反应，`test_the_original_spec_order_is_kept`
守着这一条。
"""

from collections.abc import Iterable

from ai_assistant.apps.chat.services.tools.shapes import ToolSpec


def specs_named(
    specs: Iterable[ToolSpec], names: frozenset[str]
) -> tuple[ToolSpec, ...]:
    """挑出名字在集合里的那几个规格，保持原序。

    Args: specs（全集，顺序即契约）, names。
    """
    return tuple(spec for spec in specs if spec.name in names)
