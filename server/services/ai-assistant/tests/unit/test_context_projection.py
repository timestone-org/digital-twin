"""受保护的当前请求与按模型档位选择的容量。"""

from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

from ai_assistant.apps.chat.errors import ChatContextTooLarge
from ai_assistant.apps.chat.services.context_model import ContextModel
from ai_assistant.apps.chat.services.context_stream import context_model
from llmcore.output.payloads import ContextPayload
from llmcore.ports import ModelChoice


async def test_an_irreducible_request_fails_before_the_provider_call() -> None:
    model = AsyncMock()
    model.respond.return_value = AIMessage(content="错误的执行")
    current = "当前问题" * 1200
    updates: list[ContextPayload] = []
    context = ContextModel(
        model, AsyncMock(), 4096, updates.append, pinned_text=current
    )
    with pytest.raises(ChatContextTooLarge):
        await context.respond(
            choice=ModelChoice(),
            messages=[
                SystemMessage(content="规则"),
                HumanMessage(content=current),
            ],
            tools=[],
        )
    model.respond.assert_not_awaited()
    assert updates[-1].state == "ready"


@pytest.mark.parametrize(
    ("kind", "vision", "expected"),
    [("chat", 12000, 32768), ("vision", 12000, 12000), ("vision", 0, 32768)],
)
def test_context_capacity_follows_the_selected_lane(
    kind: str, vision: int, expected: int
) -> None:
    deps = AsyncMock()
    deps.context_tokens = 32768
    deps.vision_context_tokens = vision
    deps.summarizer = lambda _: AsyncMock()
    made = context_model(
        deps, ModelChoice(kind=kind), lambda _: None, "当前问题"
    )
    assert made.max_tokens == expected
