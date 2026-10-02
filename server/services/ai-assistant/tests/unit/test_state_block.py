"""每轮重建的状态块：在最后一条、不落库。

守的是上下文分层的另一半。快照与计划每一轮都变，它们一旦离开末尾往前挪，
前面十几 k 字符的常驻提示词与工具声明就跟着一起丢掉端点的前缀缓存——而这件事
没有任何运行期迹象。另守它不进落库那一摞：落进去的话，一个会话每重放一次就把
几十份过期快照再喂一遍，而模型分不出哪一份是此刻的。
"""

import json
import uuid
from typing import Any

import pytest
from langchain_core.messages import (
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from ai_assistant.apps.chat.models import ChatMessage
from ai_assistant.apps.chat.services.advance_service import (
    AdvanceInput,
    ClientToolResult,
    assemble,
    incoming_messages,
)
from ai_assistant.apps.chat.services.memory import state_block
from ai_assistant.settings import MAX_TOOL_RESULT_CHARS
from lib.errors import ValidationFailed
from llmcore.memory import HistoryRow

SURFACE = "dashboard-editor"

PLAN: dict[str, Any] = {
    "title": "绑完整屏",
    "state": "active",
    "items": [{"title": "绑温度槽", "status": "in_progress", "note": ""}],
}

SHOT: dict[str, Any] = {"node_count": 1, "selected_id": "n7"}


def _rows(count: int) -> list[ChatMessage]:
    return [
        ChatMessage(
            session_id=uuid.uuid4(),
            seq=index,
            role="user",
            content_json={"text": f"第 {index} 句"},
        )
        for index in range(1, count + 1)
    ]


def _speaks(text: str) -> AdvanceInput:
    return AdvanceInput(
        surface_kind=SURFACE, user_text=text, surface_context=SHOT
    )


def _reports() -> AdvanceInput:
    return AdvanceInput(
        surface_kind=SURFACE,
        tool_results=[ClientToolResult(call_id="c1", output="绑好了")],
        surface_context=SHOT,
    )


def test_the_block_carries_the_snapshot_and_the_plan() -> None:
    body = state_block.render(SHOT, PLAN)
    assert "n7" in body
    assert "你正在做第 1 项：**绑温度槽**" in body


def test_the_block_says_it_is_not_the_user_talking() -> None:
    # 不说的话，模型会把这一大段 JSON 当成用户刚敲进去的东西
    assert "不是用户说的话" in state_block.render(SHOT, PLAN)


def test_nothing_to_report_takes_no_space() -> None:
    assert state_block.render(None, None) == ""
    assert state_block.messages_of(None, None) == []


def test_a_finished_plan_leaves_only_the_snapshot() -> None:
    done = {**PLAN, "state": "done"}
    assert "当前计划" not in state_block.render(SHOT, done)


def test_the_block_is_the_last_message_when_the_user_speaks() -> None:
    messages = assemble(payload=_speaks("改标题"), rows=_rows(4), plan=PLAN)

    assert isinstance(messages[0], SystemMessage)
    assert isinstance(messages[-1], HumanMessage)
    assert "<当前状态" in str(messages[-1].content)


def test_the_block_is_the_last_message_when_tools_report_back() -> None:
    """工具回填那一路也在最后。

    ⚠ 中间插不得：那一批工具消息与它们的调用必须相邻，拆开之后端点直接判
    请求不合法，报出来的 400 与真实原因毫无关系。
    """
    messages = assemble(payload=_reports(), rows=_orphan_rows(), plan=PLAN)

    assert "<当前状态" in str(messages[-1].content)
    assert any("绑好了" in str(message.content) for message in messages)


def test_structured_client_results_are_bounded_json() -> None:
    result = ClientToolResult(
        call_id="c1",
        output={"name": "冷站设备", "active": True},
    )
    text = result.as_text()
    assert json.loads(text) == {"name": "冷站设备", "active": True}

    oversized = ClientToolResult(call_id="c2", output={"text": "长" * 30_000})
    clipped = oversized.as_text()
    envelope = json.loads(clipped)
    assert len(clipped) < MAX_TOOL_RESULT_CHARS + 100
    assert envelope["is_truncated"] is True
    assert envelope["total_chars"] > MAX_TOOL_RESULT_CHARS


def test_the_block_never_lands_in_the_database() -> None:
    """落库那一摞里不许有它。

    ⚠ `_persist` 落的正是 `incoming_messages` 的产出加上本回合新增的几条，
    所以这一条断言就是「它不会被写进去」的全部依据。
    """
    payload = _speaks("改标题")
    written = "\n".join(str(one.content) for one in incoming_messages(payload))

    assert "<当前状态" not in written
    assert "n7" not in written


def _orphan_rows() -> list[ChatMessage]:
    """一段以「三个调用只回来一个」结尾的历史。

    上一轮被掐掉、页面被关掉、回执整批被判 400，留下的都是这个形状。
    """
    session = uuid.uuid4()
    bodies: list[tuple[str, dict[str, Any]]] = [
        ("user", {"text": "把这几个框对齐"}),
        (
            "assistant",
            {
                "text": "",
                "tool_calls": [
                    {"name": "dashboard.set_geometry", "args": {}, "id": one}
                    for one in ("c1", "c2", "c3")
                ],
            },
        ),
        ("tool", {"tool_call_id": "c2", "text": "好了"}),
    ]
    return [
        ChatMessage(session_id=session, seq=index, role=role, content_json=body)
        for index, (role, body) in enumerate(bodies, start=1)
    ]


def test_calls_left_without_an_answer_get_one_before_the_next_turn() -> None:
    """无回执项只在模型视图中补未知占位，不能伪造失败或触发重试。"""
    said = assemble(payload=_speaks("继续"), rows=_orphan_rows(), plan=None)

    filled = [
        one
        for one in said
        if isinstance(one, ToolMessage) and "执行状态未知" in str(one.content)
    ]
    assert [one.tool_call_id for one in filled] == ["c1", "c3"]
    # 补的那两条要排在这一次的发话**前面**：夹在后面等于调用与回应被隔开
    positions = [said.index(one) for one in filled]
    saying = next(
        index
        for index, one in enumerate(said)
        if isinstance(one, HumanMessage) and one.content == "继续"
    )
    assert max(positions) < saying


def test_the_answers_carried_by_this_very_request_are_not_orphans() -> None:
    # 这一轮带回来的回执要先认，不然同一个调用会收到两条回应
    payload = AdvanceInput(
        surface_kind=SURFACE,
        tool_results=[
            ClientToolResult(call_id="c1", output="好"),
            ClientToolResult(call_id="c3", output="好"),
        ],
        surface_context=SHOT,
    )

    said = assemble(payload=payload, rows=_orphan_rows(), plan=None)

    assert all(
        "执行状态未知" not in str(one.content)
        for one in said
        if isinstance(one, ToolMessage)
    )


def test_late_receipts_follow_the_original_call_in_model_history() -> None:
    rows = [
        HistoryRow(role="user", seq=1, content_json={"text": "旧要求"}),
        HistoryRow(
            role="assistant",
            seq=2,
            content_json={
                "text": "",
                "tool_calls": [
                    {"id": "old-call", "name": "dashboard.save", "args": {}}
                ],
            },
        ),
        HistoryRow(role="user", seq=3, content_json={"text": "新要求"}),
        HistoryRow(role="assistant", seq=4, content_json={"text": "新回复"}),
        HistoryRow(
            role="tool",
            seq=5,
            content_json={"tool_call_id": "old-call", "text": "实际保存结果"},
        ),
    ]
    messages = assemble(
        payload=AdvanceInput(surface_kind="dashboard-editor", user_text="继续"),
        rows=rows,
        plan=None,
    )
    assert [(message.type, message.content) for message in messages[1:]] == [
        ("human", "旧要求"),
        ("ai", ""),
        ("tool", "实际保存结果"),
        ("human", "新要求"),
        ("ai", "新回复"),
        ("human", "继续"),
    ]
    assert isinstance(messages[3], ToolMessage)
    assert messages[3].tool_call_id == "old-call"


def test_window_excludes_receipts_whose_call_is_no_longer_in_view(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "ai_assistant.apps.chat.services.advance_service.MAX_HISTORY_MESSAGES",
        2,
    )
    rows = [
        HistoryRow(
            role="assistant",
            seq=1,
            content_json={
                "text": "",
                "tool_calls": [
                    {"id": "old", "name": "dashboard.save", "args": {}}
                ],
            },
        ),
        HistoryRow(role="user", seq=2, content_json={"text": "新要求"}),
        HistoryRow(role="assistant", seq=3, content_json={"text": "新回复"}),
        HistoryRow(
            role="tool",
            seq=4,
            content_json={"tool_call_id": "old", "text": "实际结果"},
        ),
    ]
    messages = assemble(
        payload=AdvanceInput(surface_kind="dashboard-editor", user_text="继续"),
        rows=rows,
        plan=None,
    )
    assert not any(isinstance(message, ToolMessage) for message in messages)
    assert messages[-1].content == "继续"


@pytest.mark.parametrize("ids", [("",), ("a", "a")])
def test_ambiguous_call_ownership_cannot_replay_a_receipt(
    ids: tuple[str, ...],
) -> None:
    rows = [
        HistoryRow(
            role="assistant",
            seq=index,
            content_json={
                "text": "",
                "tool_calls": [
                    {"id": call_id, "name": "dashboard.save", "args": {}}
                ],
            },
        )
        for index, call_id in enumerate(ids, start=1)
    ]
    with pytest.raises(ValidationFailed, match="无法安全重放"):
        assemble(
            payload=AdvanceInput(
                surface_kind="dashboard-editor", user_text="继续"
            ),
            rows=rows,
            plan=None,
        )


def test_multiple_batches_attach_incoming_results_to_their_own_call() -> None:
    rows = [
        HistoryRow(
            role="assistant",
            seq=1,
            content_json={
                "text": "第一批",
                "tool_calls": [
                    {"id": one, "name": "dashboard.save", "args": {}}
                    for one in ("a", "b")
                ],
            },
        ),
        HistoryRow(role="user", seq=2, content_json={"text": "下一批"}),
        HistoryRow(
            role="assistant",
            seq=3,
            content_json={
                "text": "第二批",
                "tool_calls": [
                    {"id": "c", "name": "dashboard.save", "args": {}}
                ],
            },
        ),
        HistoryRow(
            role="tool",
            seq=4,
            content_json={"tool_call_id": "c", "text": "第三项"},
        ),
        HistoryRow(
            role="tool",
            seq=5,
            content_json={"tool_call_id": "a", "text": "第一项"},
        ),
    ]
    payload = AdvanceInput(
        surface_kind="dashboard-editor",
        tool_results=[ClientToolResult(call_id="b", output="第二项")],
    )
    messages = assemble(payload=payload, rows=rows, plan=None)
    assert [(message.type, message.content) for message in messages[1:]] == [
        ("ai", "第一批"),
        ("tool", "第一项"),
        ("tool", "第二项"),
        ("human", "下一批"),
        ("ai", "第二批"),
        ("tool", "第三项"),
    ]
