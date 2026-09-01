"""从 JSONB 读回来的东西的窄化助手。

⚠ `dict[str, Any]` 上取一个值就是 `Any`，而 `Any` 会顺着表达式一路扩散，
pyright strict 下满屏 `Unknown`。窄化收在这一处，别处只用这几个函数
（code-style-python.md：`Any` 只在边界且立刻收敛）。
"""

from typing import Any, cast


def as_dict(raw: Any) -> dict[str, Any]:
    """当成对象读；不是对象就给空字典。

    Args: raw。
    """
    return cast("dict[str, Any]", raw) if isinstance(raw, dict) else {}


def as_list(raw: Any) -> list[Any]:
    """当成数组读；不是数组就给空清单。

    Args: raw。
    """
    return cast("list[Any]", raw) if isinstance(raw, list) else []


def as_texts(raw: Any) -> list[str]:
    """当成一串字符串读。

    Args: raw。
    """
    return [str(item) for item in as_list(raw)]


def as_text(raw: Any) -> str:
    """当成一段文字读；空值给空串。

    Args: raw。
    """
    return "" if raw is None else str(raw)
