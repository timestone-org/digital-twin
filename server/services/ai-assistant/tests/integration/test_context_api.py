"""真实事务与 HTTP 验收：自动压缩只改变模型视图，历史与摘要按协议持久化。"""

import uuid
from dataclasses import replace

import pytest
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage

from ai_assistant.apps.chat.deps import get_advance_deps
from ai_assistant.apps.chat.models import ChatMessage, ChatSession
from ai_assistant.llm import GuardedModel
from integration.advance_support import (
    SESSIONS_URL,
    advance,
    install,
    new_session,
)
from integration.conftest import DbStack
from lib.resilience import CircuitBreaker
from llmcore.memory import summarize
from llmcore.output.payloads import ContextPayload
from llmcore.ports import ModelChoice
from llmcore.testing import ScriptedChat

pytestmark = pytest.mark.requires_postgres
CAPACITY = 16_384
SUMMARY = "用户要求保留 T001 温度点位，已读取的结论仍适用，继续完成当前要求。"


def _install_context(
    stack: DbStack, chat: ScriptedChat, folder: ScriptedChat
) -> None:
    install(stack, chat)
    original = stack.app.dependency_overrides[get_advance_deps]()

    async def source(choice: ModelChoice) -> BaseChatModel:
        return folder if choice.kind == "summary" else chat

    guarded = GuardedModel(
        source=source, breaker=CircuitBreaker(name="context-api-test")
    )
    stack.app.dependency_overrides[get_advance_deps] = lambda: replace(
        original,
        model=guarded,
        context_tokens=CAPACITY,
        summarizer=lambda profile: summarize.ModelSummarizer(
            model=guarded, profile=profile
        ),
    )


async def _seed_history(
    stack: DbStack, session_id: str, *, is_long_request: bool
) -> list[str]:
    texts = [
        "用户要求：保留 T001 温度点位。",
        "助手已核验 T001。",
        "继续执行既定要求。",
        "已完成读取，等待下一步。",
    ]
    at = 0 if is_long_request else 1
    texts[at] += "早前必须保留的事实与结论。" * (
        700 if is_long_request else 2400
    )
    async with stack.sessions() as session:
        for seq, text in enumerate(texts, start=1):
            session.add(
                ChatMessage(
                    session_id=uuid.UUID(session_id),
                    seq=seq,
                    role="user" if seq % 2 else "assistant",
                    content_json={"text": text},
                )
            )
        await session.commit()
    return texts


async def _stored_summary(stack: DbStack, session_id: str) -> dict[str, object]:
    async with stack.sessions() as session:
        stored = await session.get(ChatSession, uuid.UUID(session_id))
        assert stored is not None
        summary = stored.summary_json
        assert summary is not None
        return summary


async def test_budget_summary_is_persisted_and_http_history_remains_complete(
    db_stack: DbStack,
) -> None:
    chat = ScriptedChat(
        reply=AIMessage(
            content="已按既定要求完成。",
            usage_metadata={
                "input_tokens": 1500,
                "output_tokens": 20,
                "total_tokens": 1520,
            },
        )
    )
    folder = ScriptedChat(reply=AIMessage(content=SUMMARY))
    _install_context(db_stack, chat, folder)
    session_id = await new_session(db_stack.client)
    original = await _seed_history(db_stack, session_id, is_long_request=False)

    streamed = await advance(
        db_stack.client, session_id, user_text="继续完成当前要求。"
    )

    assert streamed[-1] == ("turn.done", {"reply": "已按既定要求完成。"})
    usage = [
        ContextPayload.model_validate(body)
        for name, body in streamed
        if name == "context"
    ]
    assert usage
    assert all(update.max_tokens == CAPACITY for update in usage)
    assert usage[-1].used_tokens == 1520
    assert usage[-1].is_estimated is False
    assert folder.calls >= 1
    assert chat.calls == 1
    stored = await _stored_summary(db_stack, session_id)
    assert stored["text"] == SUMMARY
    assert stored["through_seq"] > 1

    detail = await db_stack.client.get(f"{SESSIONS_URL}/{session_id}")
    assert detail.status_code == 200
    messages = detail.json()["data"]["messages"]
    assert [row["content_json"]["text"] for row in messages[:4]] == original
    assert [row["content_json"]["text"] for row in messages[-2:]] == [
        "继续完成当前要求。",
        "已按既定要求完成。",
    ]


async def test_runtime_compression_streams_state_without_erasing_user_history(
    db_stack: DbStack,
) -> None:
    chat = ScriptedChat(reply=AIMessage(content="已继续执行。"))
    folder = ScriptedChat(reply=AIMessage(content=SUMMARY))
    _install_context(db_stack, chat, folder)
    session_id = await new_session(db_stack.client)
    original = await _seed_history(db_stack, session_id, is_long_request=True)

    streamed = await advance(
        db_stack.client, session_id, user_text="当前要求：不要修改用户数据。"
    )

    usage = [
        ContextPayload.model_validate(body)
        for name, body in streamed
        if name == "context"
    ]
    assert "compressing" in [update.state for update in usage]
    assert "compressed" in [update.state for update in usage]
    assert usage[-1].compression_count >= 1
    assert streamed[-1][0] == "turn.done"
    assert chat.calls == 1
    assert any(
        message.content == "当前要求：不要修改用户数据。"
        for message in chat.seen[-1]
    )
    assert any(SUMMARY in str(message.content) for message in chat.seen[-1])
    assert not any(message.content == original[0] for message in chat.seen[-1])
    detail = await db_stack.client.get(f"{SESSIONS_URL}/{session_id}")
    messages = detail.json()["data"]["messages"]
    assert [row["content_json"]["text"] for row in messages[:4]] == original
    assert len(messages) == 6
    assert (await _stored_summary(db_stack, session_id))["text"] == SUMMARY
