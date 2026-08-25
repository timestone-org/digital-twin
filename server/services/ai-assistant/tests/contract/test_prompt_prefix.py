"""上下文的前缀必须一轮一轮地稳住。

端点的前缀缓存要的是**逐字相同的前缀**：常驻提示词与工具声明排在最前面，
它们一变，后面十几 k 字符连同整段历史一起作废，而从外面完全看不出来——
只有账单和延迟会慢慢变难看。这一层守的就是「谁又往前面塞了一格每轮会变的东西」。
"""

import json
import uuid
from typing import Any

from langchain_core.messages import BaseMessage

from ai_assistant.apps.chat.models import ChatMessage
from ai_assistant.apps.chat.services import history
from ai_assistant.apps.chat.services.advance_service import (
    AdvanceInput,
    assemble,
)
from ai_assistant.apps.chat.services.prompt import build_system_prompt
from ai_assistant.apps.chat.services.tool_select import specs_for
from ai_assistant.apps.chat.services.tool_specs import openai_schema
from ai_assistant.settings import HISTORY_DROP_STEP, MAX_HISTORY_MESSAGES

SURFACE = "dashboard-editor"

# 易变段落的小标题。⚠ 名单在这里手写是刻意的：从渲染函数里 import 的话，
# 有人把标题改掉的同时这道闸就自动跟着放行了
VOLATILE_HEADINGS = ("## 这一页此刻的样子", "## 当前计划")


def _row(role: str, body: dict[str, Any], seq: int) -> ChatMessage:
    return ChatMessage(
        session_id=uuid.uuid4(), seq=seq, role=role, content_json=body
    )


def _talk(count: int) -> list[ChatMessage]:
    """一段一问一答的历史。

    Args: count（几条）。
    """
    return [
        _row(
            "user" if index % 2 else "assistant",
            {"text": f"第 {index} 句"},
            seq=index,
        )
        for index in range(1, count + 1)
    ]


def _snapshot(label: str) -> dict[str, Any]:
    return {
        "node_count": 3,
        "selected_id": f"n-{label}",
        "selected": {"id": f"n-{label}", "label": label},
    }


def _plan(current: str) -> dict[str, Any]:
    return {
        "title": "绑完整屏",
        "state": "active",
        "items": [{"title": current, "status": "in_progress", "note": ""}],
    }


def _wire(messages: list[BaseMessage]) -> str:
    """把消息列表摊成端点看得见的那一串。

    ⚠ 顺序按 Qwen 一系的对话模板：系统消息在最前，工具声明紧随其后，
    再是其余消息。前缀命中与否就按这一串从左往右比。

    Args: messages。
    """
    head, rest = messages[0], messages[1:]
    tools = [openai_schema(spec) for spec in specs_for(SURFACE, None)]
    parts = [
        str(head.content),
        json.dumps(tools, ensure_ascii=False),
        *(
            json.dumps(one.model_dump(), ensure_ascii=False, default=str)
            for one in rest
        ),
    ]
    return "\n".join(parts)


def _turn(
    rows: list[ChatMessage], text: str, label: str, current: str
) -> list[BaseMessage]:
    return assemble(
        payload=AdvanceInput(
            surface_kind=SURFACE,
            surface_label="大屏编辑器",
            user_text=text,
            surface_context=_snapshot(label),
        ),
        rows=rows,
        plan=_plan(current),
    )


def test_the_stable_head_survives_a_new_turn() -> None:
    """相邻两轮之间，断点只许出现在最后那一段。

    快照变了、计划变了、历史多了两条——常驻提示词、25 个工具声明与那段历史
    本身都不该跟着变。变了的话，每一次客户端工具往返都是一次全量 miss，
    而一个回合最多往返 24 次。
    """
    first = _talk(6)
    earlier = _turn(first, "把这个卡片标题改掉", "卡片甲", "读画布")
    later = _turn(
        [*first, _row("user", {"text": "把这个卡片标题改掉"}, seq=7)],
        "再绑一个槽",
        "卡片乙",
        "绑温度槽",
    )

    stable = _wire([earlier[0], *history.replay(first)])
    assert _wire(later).startswith(stable)


def test_the_resident_prompt_carries_nothing_volatile() -> None:
    body = build_system_prompt(SURFACE, surface_label="大屏编辑器")
    for heading in VOLATILE_HEADINGS:
        assert heading not in body


def test_the_resident_prompt_is_the_same_for_every_session() -> None:
    """同一页上，两个毫无关系的会话拿到的常驻提示词逐字相同。

    这一段是跨会话共享的那块缓存前缀。掺进任何一格会话自己的东西，新会话的
    第一轮就永远是全 miss——而那正是每天开新对话时最贵的那一轮。
    """
    one = _turn(_talk(2), "改标题", "卡片甲", "读画布")
    other = _turn(_talk(9), "绑点位", "卡片乙", "绑温度槽")
    assert str(one[0].content) == str(other[0].content)


def test_the_history_window_only_slides_on_a_step() -> None:
    """窗口起点每 `HISTORY_DROP_STEP` 条才动一次，不是每条都动。

    每条都动的话，会话一过高水位，消息区的前缀就再也对不上了——而这一处
    与提示词那一处是各自独立成立的，修了一个另一个照样把缓存打光。
    """
    over = MAX_HISTORY_MESSAGES + 1
    seen = {
        history.window(_talk(count), MAX_HISTORY_MESSAGES)[0].seq
        for count in range(over, over + HISTORY_DROP_STEP)
    }
    assert len(seen) == 1

    moved = history.window(
        _talk(over + HISTORY_DROP_STEP), MAX_HISTORY_MESSAGES
    )[0].seq
    assert moved > next(iter(seen))
