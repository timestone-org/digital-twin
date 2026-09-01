"""对话那一路：每一档各自解各自的端点，解不出就是这一档没接。"""

import pytest
from pydantic import SecretStr

from llmcore.endpoints import ChatEndpoint
from llmcore.openai_compat import OpenAiCompatAdapter
from llmcore.ports import ModelChoice, ModelKind
from llmcore.reasoning import ReasoningChatOpenAI


def _endpoint(model: str) -> ChatEndpoint:
    return ChatEndpoint(
        base_url="http://endpoint/v1",
        api_key=SecretStr("key"),
        model=model,
        timeout_s=30.0,
        extra_body={"enable_thinking": True},
    )


def _adapter(kinds: dict[str, str]) -> OpenAiCompatAdapter:
    def resolve(kind: ModelKind) -> ChatEndpoint | None:
        name = kinds.get(kind)
        return None if name is None else _endpoint(name)

    return OpenAiCompatAdapter(
        resolve=resolve, label="按量计费端点", models=("chat-model",)
    )


def test_a_kind_without_an_endpoint_is_not_supported() -> None:
    """⚠ `supports` 要如实回答：答错的代价不是报错而是静默错付——一路不接图
    的模型收到图片块，多半只回一句「我没看到图」，而调用照样成功照样计费。"""
    adapter = _adapter({"chat": "chat-model"})
    assert adapter.supports("chat") is True
    assert adapter.supports("vision") is False


async def test_each_kind_builds_from_its_own_endpoint() -> None:
    adapter = _adapter({"chat": "chat-model", "vision": "vision-model"})
    chat = await adapter.build(ModelChoice(kind="chat"))
    vision = await adapter.build(ModelChoice(kind="vision"))
    assert isinstance(chat, ReasoningChatOpenAI)
    assert chat.model_name == "chat-model"
    assert vision.model_name == "vision-model"


async def test_the_dialect_body_is_passed_through() -> None:
    """⚠ 思考开关一类的键在 OpenAI 兼容口径里没有标准字段，各家用自己的——
    代码里不认厂商名，于是它只能是一格透传的取值。"""
    built = await _adapter({"chat": "chat-model"}).build(ModelChoice())
    assert built.extra_body == {"enable_thinking": True}


async def test_this_layer_never_retries() -> None:
    """⚠ 一条链路只有一层负责重试，而那一层是调用方的编排层。留着 SDK 自带的
    重试会让一次超时变成三次，把上游的预算悄悄用光。"""
    built = await _adapter({"chat": "chat-model"}).build(ModelChoice())
    assert built.max_retries == 0


async def test_stream_usage_is_asked_for_explicitly() -> None:
    """⚠ 库只在用默认 OpenAI 端点时才自己开它，而这里的端点一律来自配置——
    不给的话流式回包里连 usage 都没有，而「量不到」表现为一切正常。"""
    built = await _adapter({"chat": "chat-model"}).build(ModelChoice())
    assert built.stream_usage is True


def test_the_profile_reports_vision_by_probing_the_resolver() -> None:
    with_vision = _adapter({"chat": "c", "vision": "v"}).profile()
    without = _adapter({"chat": "c"}).profile()
    assert with_vision.has_vision is True
    assert without.has_vision is False
    assert without.models == ("chat-model",)
    assert without.efforts == ()


async def test_building_an_unsupported_kind_is_a_programming_error() -> None:
    """注册表在 `supports` 为假时不会走到这里；真走到了就是编排出了错。"""
    with pytest.raises(ValueError, match="解得出的端点"):
        await _adapter({"chat": "c"}).build(ModelChoice(kind="vision"))
