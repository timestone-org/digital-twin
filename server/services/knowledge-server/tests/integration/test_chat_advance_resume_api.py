"""推进回合的那几件账：停下等浏览器之后怎么续、回执怎么对、每一轮落库时会话上
记什么。整条事件流的验收在 `test_chat_advance_api.py`。"""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest
from integration.conftest import DbStack
from integration.test_chat_advance_api import (
    URL,
    _advance,
    _install,
    _MarkingSearch,
    _new_session,
    _seeded_chunk,
    _seeded_with_a_figure,
)
from langchain_core.messages import AIMessage
from sqlalchemy import update

from knowledge_server.apps.chat.crud import session_crud
from knowledge_server.apps.chat.models import ChatSession
from knowledge_server.apps.chat.services.citations import Ledger
from knowledge_server.apps.chat.services.tools.client import (
    ASK_TOOL,
    ClientTools,
)
from knowledge_server.apps.knowledge.schemas import HitOut, LocatorOut
from llmcore.testing import ScriptedChat, asks
from llmcore.tools.registry import registry_of
from llmcore.tools.shapes import ToolSpec

pytestmark = pytest.mark.requires_postgres


def _hit_on(document_id: uuid.UUID, chunk_id: uuid.UUID) -> HitOut:
    return HitOut(
        chunk_id=chunk_id,
        document_id=document_id,
        document_title="冷却水系统操作规程",
        text="冷凝器出口温度不得高于 65 ℃",
        heading_path="二、运行参数",
        locator=LocatorOut(
            page=2, page_end=3, label="第 2–3 页 · 二、运行参数"
        ),
        score=0.9,
        why="关键词命中",
    )


def _search_call(call_id: str) -> AIMessage:
    return AIMessage(
        content="",
        tool_calls=[{"id": call_id, "name": "kb.search", "args": {}}],
    )


async def test_a_marker_issued_before_a_pause_still_resolves_after_it(
    db_stack: DbStack,
) -> None:
    """⚠ 停下来问用户之后，续跑是另一次请求：角标账本若每次请求重开一本，
    暂停前发的 ① 在续跑的答案里就解析不出来，整块依据连同插图一起消失。"""
    document_id, chunk_id, _figure_id = await _seeded_with_a_figure(db_stack)
    _install(
        db_stack,
        ScriptedChat(
            script=[
                _search_call("t1"),
                asks(ASK_TOOL, "q1", question="哪台", options=[]),
                AIMessage(content="上限是 65 ℃①"),
            ]
        ),
        tools=lambda _scope, ledger: registry_of(
            (
                _MarkingSearch(_hit_on(document_id, chunk_id), ledger),
                ClientTools(),
            )
        ),
    )
    session_id = await _new_session(db_stack.client)
    await _advance(db_stack.client, session_id, user_text="上限多少")
    paused = await db_stack.client.get(f"{URL}/{session_id}")
    waiting = paused.json()["data"]["messages"][-1]["steps"][-1]
    # 账本只给服务端续跑用，不透给详情出参
    assert waiting["state"] == "awaiting_client"
    assert set(waiting["input_json"]) == {"calls"}

    events = await _advance(
        db_stack.client,
        session_id,
        tool_results=[{"call_id": "q1", "output": {"picked": ["k1"]}}],
    )

    live = [body for name, body in events if name == "citations"]
    assert len(live) == 1
    cited = live[0]["items"]
    assert [one["chunk_id"] for one in cited] == [str(chunk_id)]
    assert cited[0]["page_end"] == 3
    assert len(cited[0]["figures"]) == 1
    detail = await db_stack.client.get(f"{URL}/{session_id}")
    assert detail.json()["data"]["messages"][-1]["citations"] == cited


@dataclass(frozen=True)
class _Sequential:
    """每调一次检索就给下一条召回发一个角标，并记下发了哪个。"""

    hits: list[HitOut]
    ledger: Ledger
    marks: list[str]
    name = "sequential"

    def specs(self) -> tuple[ToolSpec, ...]:
        return _MarkingSearch(self.hits[0], self.ledger).specs()

    async def run(self, name: str, arguments: dict[str, Any]) -> Any:
        del name, arguments
        made = self.ledger.mark(self.hits[len(self.marks)], "现场资料", "段")
        self.marks.append(made)
        return {"mark": made}


async def test_a_search_after_a_pause_continues_the_numbering(
    db_stack: DbStack,
) -> None:
    """⚠ 续跑里再查一次，新的那条要领 ②：从 ① 重新编的话，同一个 ① 在
    这一回合里指着两段不同的话，用户点开的是另一段依据。"""
    async with db_stack.sessions() as session:
        first = await _seeded_chunk(session)
        second = await _seeded_chunk(session)
        await session.commit()
        hits = [
            _hit_on(first.document_id, first.id),
            _hit_on(second.document_id, second.id),
        ]
    marks: list[str] = []
    _install(
        db_stack,
        ScriptedChat(
            script=[
                _search_call("t1"),
                asks(ASK_TOOL, "q1", question="哪台", options=[]),
                _search_call("t2"),
                AIMessage(content="一是①，二是②"),
            ]
        ),
        tools=lambda _scope, ledger: registry_of(
            (_Sequential(hits, ledger, marks), ClientTools())
        ),
    )
    session_id = await _new_session(db_stack.client)
    await _advance(db_stack.client, session_id, user_text="上限多少")
    events = await _advance(
        db_stack.client,
        session_id,
        tool_results=[{"call_id": "q1", "output": {"picked": ["k1"]}}],
    )

    assert marks == ["①", "②"]
    cited = next(body for name, body in events if name == "citations")
    assert [one["chunk_id"] for one in cited["items"]] == [
        str(first.id),
        str(second.id),
    ]


async def test_an_unexpected_failure_still_ends_with_an_error_frame(
    db_stack: DbStack,
) -> None:
    """⚠ 只接业务异常的话，其余的异常让流直接断掉：前端读到的是「连接中断」
    而不是「这一轮没跑完」，日志里也只剩一段没有事件名的堆栈。"""
    _install(db_stack, ScriptedChat(error=RuntimeError("内部细节不许外泄")))
    session_id = await _new_session(db_stack.client)

    events = await _advance(db_stack.client, session_id, user_text="上限多少")

    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == 52325
    assert "内部细节" not in events[-1][1]["message"]


async def test_a_new_turn_moves_the_session_to_the_top(
    db_stack: DbStack,
) -> None:
    """⚠ 列表按 `updated_at` 排：续聊不顶它的话，上周开的会话今天接着聊，
    仍沉在列表下面、挂着上周的时间。版本号不跟着动——它守的是范围与标题。"""
    _install(db_stack, ScriptedChat(reply=AIMessage(content="好")))
    session_id = await _new_session(db_stack.client)
    long_ago = datetime(2020, 1, 1, tzinfo=UTC)
    async with db_stack.sessions() as session:
        await session.execute(
            update(ChatSession)
            .where(ChatSession.id == uuid.UUID(session_id))
            .values(updated_at=long_ago, title="已命名")
        )
        await session.commit()
    before = await db_stack.client.get(f"{URL}/{session_id}")

    await _advance(db_stack.client, session_id, user_text="在吗")

    after = (await db_stack.client.get(f"{URL}/{session_id}")).json()["data"]
    assert datetime.fromisoformat(after["updated_at"]) > long_ago
    assert after["row_version"] == before.json()["data"]["row_version"]


async def test_the_next_sequence_number_comes_from_the_largest_one(
    db_stack: DbStack,
) -> None:
    _install(db_stack, ScriptedChat(reply=AIMessage(content="好")))
    session_id = uuid.UUID(await _new_session(db_stack.client))
    async with db_stack.sessions() as session:
        assert await session_crud.max_seq(session, session_id) == 0
    await _advance(db_stack.client, str(session_id), user_text="在吗")
    await _advance(db_stack.client, str(session_id), user_text="还在吗")
    async with db_stack.sessions() as session:
        assert await session_crud.max_seq(session, session_id) == 4


async def _paused(stack: DbStack) -> str:
    """开一条会话并让它停在一次反问上，回会话 id。"""
    _install(
        stack,
        ScriptedChat(
            script=[
                asks(ASK_TOOL, "q1", question="哪台", options=[]),
                AIMessage(content="1 号锅炉"),
            ]
        ),
    )
    session_id = await _new_session(stack.client)
    await _advance(stack.client, session_id, user_text="上限多少")
    return session_id


async def _messages(stack: DbStack, session_id: str) -> list[dict[str, Any]]:
    detail = await stack.client.get(f"{URL}/{session_id}")
    return list(detail.json()["data"]["messages"])


async def test_a_receipt_for_an_unknown_call_is_refused_up_front(
    db_stack: DbStack,
) -> None:
    """⚠ 对不上的回执照收的话，旧标签页回传一个过期的 id 也会跑一整轮模型，
    而那条工具消息在拼上下文时被悄悄丢掉。"""
    session_id = await _paused(db_stack)
    before = await _messages(db_stack, session_id)

    response = await db_stack.client.post(
        f"{URL}/{session_id}:advance",
        json={
            "client_tools": [ASK_TOOL],
            "tool_results": [{"call_id": "nope", "output": {}}],
        },
    )

    assert response.status_code == 409
    assert response.json()["code"] == 42326
    assert len(await _messages(db_stack, session_id)) == len(before)


async def test_the_same_receipt_twice_runs_only_one_turn(
    db_stack: DbStack,
) -> None:
    """⚠ 网络重试或连点一次，同一份回执再来一遍：照收就是两轮模型计费、
    两条同 id 的工具消息与两段答案。"""
    session_id = await _paused(db_stack)
    body = {
        "client_tools": [ASK_TOOL],
        "tool_results": [{"call_id": "q1", "output": {"picked": ["k1"]}}],
    }
    first = await db_stack.client.post(f"{URL}/{session_id}:advance", json=body)
    assert first.status_code == 200

    second = await db_stack.client.post(
        f"{URL}/{session_id}:advance", json=body
    )

    assert second.status_code == 409


async def test_an_answered_pause_reads_back_as_settled(
    db_stack: DbStack,
) -> None:
    """⚠ 不结算的话，回放时那一步永远是「没跑完」，而用户明明已经选过了。"""
    session_id = await _paused(db_stack)
    await _advance(
        db_stack.client,
        session_id,
        tool_results=[{"call_id": "q1", "output": {"picked": ["k1"]}}],
    )

    states = [
        step["state"]
        for message in await _messages(db_stack, session_id)
        for step in message["steps"]
    ]
    assert "awaiting_client" not in states
    assert "succeeded" in states


async def test_a_failed_turn_leaves_its_reason_and_a_good_one_clears_it(
    db_stack: DbStack,
) -> None:
    """⚠ `last_error` 写在出参里却从没人写：回合失败时问题没落库，重开这条
    对话既看不到问题、也看不到为什么失败。"""
    _install(db_stack, ScriptedChat(error=RuntimeError("内部细节不许外泄")))
    session_id = await _new_session(db_stack.client)
    await _advance(db_stack.client, session_id, user_text="上限多少")

    failed = (await db_stack.client.get(f"{URL}/{session_id}")).json()["data"]
    assert failed["last_error"] == "这一轮没跑完，请重试"

    _install(db_stack, ScriptedChat(reply=AIMessage(content="好")))
    await _advance(db_stack.client, session_id, user_text="再试一次")

    cleared = (await db_stack.client.get(f"{URL}/{session_id}")).json()["data"]
    assert cleared["last_error"] is None
