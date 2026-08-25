"""消息在库与模型之间的往返。

守的是「存结构不存提示词文本」：把整段提示词拼好再存，将来改了写法，历史会话
会用两套口径重放。另守工具消息必须带回 `tool_call_id`——丢了它，模型看到的是
「有人回了句话，但不知道回的是哪次调用」。
"""

import uuid

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from ai_assistant.apps.chat.models import ChatMessage
from ai_assistant.apps.chat.services import history


def _row(role: str, body: dict[str, object], seq: int = 1) -> ChatMessage:
    return ChatMessage(
        session_id=uuid.uuid4(), seq=seq, role=role, content_json=body
    )


def test_a_user_message_round_trips() -> None:
    role, body = history.to_content(HumanMessage(content="你好"))
    assert role == "user"
    back = history.to_message(_row(role, body))
    assert back.content == "你好"


def test_an_assistant_message_keeps_its_tool_calls() -> None:
    reply = AIMessage(
        content="",
        tool_calls=[{"name": "points.search", "args": {}, "id": "c1"}],
    )
    role, body = history.to_content(reply)
    back = history.to_message(_row(role, body))
    assert isinstance(back, AIMessage)
    assert [call["id"] for call in back.tool_calls] == ["c1"]


def test_a_tool_message_keeps_the_call_it_answers() -> None:
    role, body = history.to_content(
        ToolMessage(content="结果", tool_call_id="c1")
    )
    back = history.to_message(_row(role, body))
    assert isinstance(back, ToolMessage)
    assert back.tool_call_id == "c1"


def test_replay_orders_by_sequence_not_by_insertion() -> None:
    rows = [
        _row("user", {"text": "第二句"}, seq=2),
        _row("user", {"text": "第一句"}, seq=1),
    ]
    assert [m.content for m in history.replay(rows)] == ["第一句", "第二句"]


def test_a_row_with_nothing_in_it_still_replays() -> None:
    # 库里存着的东西不一定是本版本写的，读不出来也不能炸掉整段历史
    back = history.to_message(_row("assistant", {}))
    assert back.content == ""


def test_window_takes_the_most_recent_slice() -> None:
    rows = [_row("user", {"text": f"m{i}"}, seq=i) for i in range(1, 11)]
    kept = history.window(rows, 3)
    assert [one.seq for one in kept] == [8, 9, 10]


def test_window_never_starts_with_an_orphan_tool_message() -> None:
    """切点落在工具调用与它的回应之间时，孤儿工具消息必须掐掉。

    不掐的话，发给端点的历史以几条没有调用的工具回应开头，回来的是一条
    与真实原因毫无关系的 400，且回合越长越容易触发。
    """
    rows = [
        _row("user", {"text": "绑点"}, seq=1),
        _row("assistant", {"text": "", "tool_calls": []}, seq=2),
        _row("tool", {"tool_call_id": "c1", "text": "结果一"}, seq=3),
        _row("tool", {"tool_call_id": "c2", "text": "结果二"}, seq=4),
        _row("assistant", {"text": "好了"}, seq=5),
    ]
    kept = history.window(rows, 3)
    assert [one.seq for one in kept] == [5]


def test_window_keeps_a_complete_pair_intact() -> None:
    rows = [
        _row("assistant", {"text": "", "tool_calls": []}, seq=1),
        _row("tool", {"tool_call_id": "c1", "text": "结果"}, seq=2),
        _row("user", {"text": "继续"}, seq=3),
    ]
    kept = history.window(rows, 3)
    assert [one.seq for one in kept] == [1, 2, 3]
