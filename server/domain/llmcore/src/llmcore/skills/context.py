"""历史窗口外的技能恢复：只认实际成功回执，按当前页面权限重新筛选。"""

import json
from collections.abc import Sequence
from typing import cast

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    ToolMessage,
)

from llmcore.memory import HistoryRow, history
from llmcore.skills import SkillManifest

MAX_RESTORED_CHARS = 18_000


def restored_messages(
    rows: Sequence[HistoryRow],
    recent: Sequence[HistoryRow],
    skills: tuple[SkillManifest, ...],
    max_chars: int = MAX_RESTORED_CHARS,
) -> list[BaseMessage]:
    """窗口外恢复最近技能，超预算提示重载。Args: rows, recent, skills。"""
    return restored_from_messages(
        history.replay(rows), history.replay(recent), skills, max_chars
    )


def restored_from_messages(
    messages: Sequence[BaseMessage],
    visible_messages: Sequence[BaseMessage],
    skills: tuple[SkillManifest, ...],
    max_chars: int = MAX_RESTORED_CHARS,
) -> list[BaseMessage]:
    loaded = _loaded_names(messages)
    visible = set(_loaded_names(visible_messages))
    catalog = {skill.name: skill for skill in skills}
    names = [
        name for name in loaded if name not in visible and name in catalog
    ][-2:]
    parts: list[str] = []
    used = 0
    for name in names:
        skill = catalog[name]
        body = f"## {name}\n{skill.instructions()}"
        if used + len(body) > max_chars:
            body = f"继续使用 {name} 前，必须调用 skills.load 重新加载正文。"
        parts.append(body)
        used += len(body)
    if not parts:
        return []
    return [
        HumanMessage(
            content="<已加载技能恢复>\n"
            + "\n\n".join(parts)
            + "\n</已加载技能恢复>"
        )
    ]


def _loaded_names(messages: Sequence[BaseMessage]) -> list[str]:
    calls: dict[str, str] = {}
    names: list[str] = []
    for message in messages:
        if isinstance(message, AIMessage):
            for call in message.tool_calls:
                if call["name"] == "skills.load" and isinstance(
                    call["args"].get("name"), str
                ):
                    calls[str(call.get("id") or "")] = str(call["args"]["name"])
        elif isinstance(message, ToolMessage) and _succeeded(
            str(message.content)
        ):
            name = calls.get(message.tool_call_id)
            if name:
                names = [one for one in names if one != name] + [name]
    return names


def _succeeded(text: str) -> bool:
    if text.startswith("ok: true\n") and "instructions:" in text:
        return True
    try:
        value: object = json.loads(text)
    except ValueError:
        return False
    if not isinstance(value, dict):
        return False
    body = cast("dict[str, object]", value)
    return body.get("ok") is True and bool(body.get("instructions"))
