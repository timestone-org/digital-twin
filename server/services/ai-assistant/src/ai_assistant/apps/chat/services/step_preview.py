"""把一步的入参与产出摊成能直接画出来的预览。

⚠ 预览是**给人看的**，与喂给模型的那一份不是同一条口径：模型那一路走工具消息，
钳制在 `turn.py::_clamped`（两万字）。这里的上限小得多——每一步都要过一次事件流，
而事件流的另一头是浏览器里的一条时间线。

⚠ 值一律摊成字符串。原样下发嵌套结构的话，前端要为「任意 JSON」写一整套渲染，
而那套东西的每个分支都得有人测；摊平之后它只有一种形状：一张键值表。
"""

import json
from typing import Any

# 一个入参值最多留多少字
MAX_VALUE_CHARS = 200
# 一步最多摊几个入参
MAX_KEYS = 20
# 产出预览的上限
MAX_OUTPUT_CHARS = 1_500

_ELLIPSIS = "…"


def input_preview(given: dict[str, Any] | None) -> dict[str, str] | None:
    """入参摊成一张键值表；没有入参给 `None`。

    Args: given。
    """
    if not given:
        return None
    flat: dict[str, str] = {}
    for key, value in list(given.items())[:MAX_KEYS]:
        flat[str(key)] = _clamped(_as_text(value), MAX_VALUE_CHARS)
    if len(given) > MAX_KEYS:
        flat[_ELLIPSIS] = f"另有 {len(given) - MAX_KEYS} 项未摊开"
    return flat


def output_preview(given: dict[str, Any] | None) -> str | None:
    """产出摊成一段文字；没有产出给 `None`。

    ⚠ 认得出 `{"body": …}` 这一种形状就只取那一格：服务端工具落库时把结果包了
    一层，连壳一起显示的话，每一步的产出前面都顶着一个 `{"body": "` 。

    Args: given。
    """
    if not given:
        return None
    body = given.get("body")
    text = body if isinstance(body, str) else _as_text(given)
    return _clamped(text, MAX_OUTPUT_CHARS)


def _as_text(value: object) -> str:
    """一个值摊成文字。裸串原样，其余走 JSON。

    ⚠ 裸串不走 JSON：走了的话每个字符串值都被套上一对引号，而那是给机器看的。

    Args: value。
    """
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, default=str)


def _clamped(text: str, limit: int) -> str:
    """钳到上限内，截断要**说出来**。

    ⚠ 静默截断会让人把半份产出当成全部——尤其是产出本身就是一段 JSON 时，
    截断处看起来只是「结构复杂」而不是「没了」。

    Args: text, limit。
    """
    if len(text) <= limit:
        return text
    return f"{text[:limit]}{_ELLIPSIS}（共 {len(text)} 字，已截断）"
