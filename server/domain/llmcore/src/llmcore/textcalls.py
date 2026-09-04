"""模型把工具调用**写成正文**时，把它捡回来。

端点该做的是解析出结构化的 `tool_calls`。可现场那几路小模型（以及某些
OpenAI 兼容网关）会退化成「照训练时的写法把调用打进正文里」：

    <tool_call>
    <function=kb.read_chunk>
    <parameter=chunk_id>
    01a069c3-…
    </parameter>
    </function>
    </tool_call>

⚠ 不捡的表现是**双重失败**：那一步没人执行（编排看 `tool_calls` 是空的，
判定「模型收了嘴」当场收工），而那段尖括号原样成了给用户的答案——还会跟着
落库、进标题、进下一轮的上下文。用户看到的是一坨 XML，且不报任何错。

⚠ 只认**闭合集合**里的两种写法，且只认**这一轮真发下去过**的工具名。放宽成
「像调用就当调用」的话，模型在正文里讨论一个工具（「我本来想调 kb.search」）
会被当成真调用执行——而那与它真的想调分辨不出来。

⚠ 这一层只做**解析**，不判断该不该执行：捡出来的调用交给编排层照常走注册表、
照常限流、照常记步骤。在这里直接跑等于开了一条绕过全部闸门的旁路。
"""

import json
import re
from dataclasses import dataclass
from typing import Any, cast

# 一次最多捡几个。⚠ 有上限：正文里一段跑飞的重复能写出几十个调用，
# 而每一个都要真的去执行
MAX_SALVAGED = 8

# 整块的边界。⚠ 非贪婪：一条消息里可能有好几块，贪婪会把它们连同中间的正文
# 吞成一块
_BLOCK = re.compile(r"<tool_call>\s*(.*?)\s*</tool_call>", re.S)
# 没闭合的那一段（流被截断、或者模型写到一半改主意了）。⚠ 也要从正文里摘掉：
# 留着的话用户看到的是半截尖括号，而它同样会落库
_UNCLOSED = re.compile(r"<tool_call>(?!.*?</tool_call>).*\Z", re.S)

# 写法一：`<function=NAME>` + 若干 `<parameter=KEY>值</parameter>`
_FUNCTION = re.compile(r"<function=([^>\s]+)\s*>\s*(.*?)\s*</function>", re.S)
_PARAMETER = re.compile(
    r"<parameter=([^>\s]+)\s*>\s*(.*?)\s*</parameter>", re.S
)


@dataclass(frozen=True)
class TextCall:
    """从正文里捡回来的一次调用。"""

    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class Salvaged:
    """一段正文捡完之后剩下什么。"""

    calls: tuple[TextCall, ...]
    # 摘掉那几块之后的正文。⚠ 一个都没捡到时它与原文逐字相同
    text: str


def salvage(text: str, known: frozenset[str]) -> Salvaged:
    """把正文里写成文字的工具调用捡出来，并从正文里摘掉。

    ⚠ `known` 是**这一轮真发下去过**的工具名。空集合等于不捡——没发工具的
    那几轮里出现 `<tool_call>` 一定是模型在复读，不是它想调什么。

    Args: text, known（认得的工具名）。
    """
    if not known or "<tool_call>" not in text:
        return Salvaged(calls=(), text=text)
    found: list[TextCall] = []
    for block in _BLOCK.finditer(text):
        one = _call_of(block.group(1), known)
        if one is not None and len(found) < MAX_SALVAGED:
            found.append(one)
    if not found:
        return Salvaged(calls=(), text=text)
    return Salvaged(calls=tuple(found), text=_without_blocks(text))


def _without_blocks(text: str) -> str:
    """把成对的与没闭合的那几块都从正文里摘掉。

    Args: text。
    """
    return _UNCLOSED.sub("", _BLOCK.sub("", text)).strip()


def _call_of(body: str, known: frozenset[str]) -> TextCall | None:
    """一块里的那次调用；两种写法都不认就给 `None`。

    Args: body（`<tool_call>` 里面那一段）, known。
    """
    made = _as_function(body) or _as_json(body)
    if made is None or made.name not in known:
        return None
    return made


def _as_function(body: str) -> TextCall | None:
    """写法一：`<function=NAME>` 配一串 `<parameter=KEY>`。

    Args: body。
    """
    matched = _FUNCTION.search(body)
    if matched is None:
        return None
    arguments = {
        key: _valued(raw) for key, raw in _PARAMETER.findall(matched.group(2))
    }
    return TextCall(name=matched.group(1).strip(), arguments=arguments)


def _as_json(body: str) -> TextCall | None:
    """写法二：块里直接是一段 `{"name": …, "arguments": {…}}`。

    ⚠ `Any` 只在这一处（外部 JSON 是边界），当场收成 `str` 与表。

    Args: body。
    """
    payload = _mapping(body)
    name = payload.get("name")
    if not isinstance(name, str) or not name:
        return None
    return TextCall(
        name=name, arguments=_arguments_of(payload.get("arguments"))
    )


def _mapping(body: str) -> dict[str, object]:
    """一段文字读成一个表；读不出或不是表就给空表。

    Args: body。
    """
    try:
        loaded: Any = json.loads(body)
    except ValueError:
        return {}
    if not isinstance(loaded, dict):
        return {}
    return {
        str(key): value for key, value in cast("dict[Any, Any]", loaded).items()
    }


def _arguments_of(given: object) -> dict[str, Any]:
    """调用的入参；不是表就给空表（缺参数由工具那一侧照常报错）。

    Args: given。
    """
    if not isinstance(given, dict):
        return {}
    return {
        str(key): value for key, value in cast("dict[Any, Any]", given).items()
    }


def _valued(raw: str) -> Any:
    """一个参数值：能当 JSON 读就按 JSON 读，否则就是这段字符串。

    ⚠ 数字与布尔要还原成本来的类型：`limit` 收到字符串 `"5"` 时，工具那一侧
    的 `isinstance(given, int)` 会判假然后悄悄退回缺省值。

    Args: raw。
    """
    body = raw.strip()
    try:
        return json.loads(body)
    except ValueError:
        return body
