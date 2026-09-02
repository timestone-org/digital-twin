"""推进一个回合的纯逻辑：上下文怎么拼、哪些工具下发、回填怎么摊。"""

from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

from knowledge_server.apps.chat.services import advance_service as svc
from knowledge_server.apps.chat.services.prompt import SYSTEM_PROMPT
from knowledge_server.apps.chat.services.tools.client import ASK_TOOL
from llmcore.memory import HistoryRow, Summary
from llmcore.tools.shapes import ToolSpec, object_schema


def _row(role: str, text: str, seq: int) -> HistoryRow:
    return HistoryRow(role=role, seq=seq, content_json={"text": text})


def _spec(name: str, runs_on: str) -> ToolSpec:
    return ToolSpec(
        name=name,
        description="x",
        parameters=object_schema({}, []),
        runs_on=runs_on,  # type: ignore[arg-type]  # 理由：用例造两档
    )


def test_the_prompt_is_the_first_message_and_never_varies() -> None:
    """⚠ 常驻提示词是前缀缓存唯一能命中的那一段，一个字都不许跟着会话变。"""
    made = svc.assemble(
        payload=svc.AdvanceInput(user_text="锅炉压力"), rows=[], summary=None
    )

    assert isinstance(made[0], SystemMessage)
    assert made[0].content == SYSTEM_PROMPT


def test_the_prompt_demands_all_three_citation_parts() -> None:
    """跨库的代价：角标必须指回库 / 文档 / 位置三样（ADR-0037 决策三）。"""
    assert "哪个库 / 哪份文档 / 哪个位置" in SYSTEM_PROMPT


def test_the_prompt_forbids_free_text_questions() -> None:
    """设计 §4：反问用选择，不用自由文本。"""
    assert "不要在正文里问一句等他打字" in SYSTEM_PROMPT


def test_history_replays_after_the_summary_and_before_the_new_input() -> None:
    """⚠ 顺序就是上下文的分层：稳的在前，每轮都变的在后。"""
    made = svc.assemble(
        payload=svc.AdvanceInput(user_text="那润滑呢"),
        rows=[_row("user", "锅炉压力", 1), _row("assistant", "9.8 MPa", 2)],
        summary=Summary(through_seq=1, text="早先聊过", model="m"),
    )

    kinds = [type(one).__name__ for one in made]
    assert kinds == [
        "SystemMessage",
        "HumanMessage",
        "HumanMessage",
        "AIMessage",
        "HumanMessage",
    ]
    assert "早先聊过" in str(made[1].content)
    assert made[-1].content == "那润滑呢"


def test_an_unanswered_ask_in_history_gets_a_filler_reply() -> None:
    """⚠ 尾部没应答的调用不补回执，端点判整段历史不合法，会话就发不出下一句。"""
    rows = [
        _row("user", "哪台", 1),
        HistoryRow(
            role="assistant",
            seq=2,
            content_json={
                "text": "",
                "tool_calls": [{"id": "a1", "name": ASK_TOOL, "args": {}}],
            },
        ),
    ]

    made = svc.assemble(
        payload=svc.AdvanceInput(user_text="算了"), rows=rows, summary=None
    )

    fillers = [one for one in made if isinstance(one, ToolMessage)]
    assert [one.tool_call_id for one in fillers] == ["a1"]


def test_a_tool_result_answers_the_call_instead_of_a_filler() -> None:
    rows = [
        HistoryRow(
            role="assistant",
            seq=1,
            content_json={
                "text": "",
                "tool_calls": [{"id": "a1", "name": ASK_TOOL, "args": {}}],
            },
        ),
    ]

    made = svc.assemble(
        payload=svc.AdvanceInput(
            tool_results=[
                svc.ClientToolResult(call_id="a1", output={"picked": ["k1"]})
            ]
        ),
        rows=rows,
        summary=None,
    )

    replies = [one for one in made if isinstance(one, ToolMessage)]
    assert len(replies) == 1
    assert replies[0].tool_call_id == "a1"
    assert "k1" in str(replies[0].content)


def test_a_failed_client_tool_is_reported_as_such() -> None:
    made = svc.incoming_messages(
        svc.AdvanceInput(
            tool_results=[svc.ClientToolResult(call_id="a1", error="关掉了")]
        )
    )

    assert str(made[0].content).startswith("失败：")


def test_ask_is_offered_only_when_the_page_reports_it() -> None:
    """⚠ 页面没报 user.ask 就不下发它：下发了模型会调，而那一页渲染不出选项。"""
    specs = (_spec("kb.search", "server"), _spec(ASK_TOOL, "client"))

    without = svc._offered(specs, ())  # pyright: ignore[reportPrivateUsage]
    with_ask = svc._offered(
        specs, (ASK_TOOL,)
    )  # pyright: ignore[reportPrivateUsage]

    assert [one.name for one in without] == ["kb.search"]
    assert {one.name for one in with_ask} == {"kb.search", ASK_TOOL}


def test_a_plain_user_text_becomes_one_human_message() -> None:
    made = svc.incoming_messages(svc.AdvanceInput(user_text="锅炉"))

    assert isinstance(made[0], HumanMessage)
    assert made[0].content == "锅炉"


def test_an_ai_reply_in_history_keeps_its_text() -> None:
    made = svc.assemble(
        payload=svc.AdvanceInput(user_text="继续"),
        rows=[_row("assistant", "上限 9.8 MPa [1]", 1)],
        summary=None,
    )

    assert isinstance(made[1], AIMessage)
    assert "9.8" in str(made[1].content)
