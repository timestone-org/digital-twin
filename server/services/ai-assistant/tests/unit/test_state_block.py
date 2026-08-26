"""每轮重建的状态块：在最后一条、不落库。

守的是上下文分层的另一半。快照与计划每一轮都变，它们一旦离开末尾往前挪，
前面十几 k 字符的常驻提示词与工具声明就跟着一起丢掉端点的前缀缓存——而这件事
没有任何运行期迹象。另守它不进落库那一摞：落进去的话，一个会话每重放一次就把
几十份过期快照再喂一遍，而模型分不出哪一份是此刻的。
"""

import uuid
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage

from ai_assistant.apps.chat.models import ChatMessage
from ai_assistant.apps.chat.services import state_block
from ai_assistant.apps.chat.services.advance_service import (
    AdvanceInput,
    ClientToolResult,
    assemble,
    incoming_messages,
)

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
    messages = assemble(payload=_reports(), rows=_rows(4), plan=PLAN)

    assert "<当前状态" in str(messages[-1].content)
    assert "绑好了" in str(messages[-2].content)


def test_the_block_never_lands_in_the_database() -> None:
    """落库那一摞里不许有它。

    ⚠ `_persist` 落的正是 `incoming_messages` 的产出加上本回合新增的几条，
    所以这一条断言就是「它不会被写进去」的全部依据。
    """
    payload = _speaks("改标题")
    written = "\n".join(str(one.content) for one in incoming_messages(payload))

    assert "<当前状态" not in written
    assert "n7" not in written
