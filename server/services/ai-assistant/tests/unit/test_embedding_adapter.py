"""嵌入那一路的配置回落与形状核对（ADR-0030 决策五）。

守的是两件在运行期不会亮红灯的事：回落链写漏一格会让「改了配置没生效」，
而端点换了模型悄悄改了维数只表现为「召回忽然变差了」。
"""

from dataclasses import dataclass

import pytest
from pydantic import SecretStr

from ai_assistant.llm.adapters import AdapterDeps, build_openai_embedding
from ai_assistant.settings import Settings
from llmcore.openai_embedding import (
    EmbeddingShapeChanged,
    OpenAiCompatEmbeddingAdapter,
)

PLACEHOLDER = "placeholder"
KEY = SecretStr("chat-key")


def _settings(**overrides: object) -> Settings:
    """一份只连占位值的配置，模型与嵌入那几项由调用方指定。

    Args: overrides。
    """
    base: dict[str, object] = {
        "postgres_host": PLACEHOLDER,
        "postgres_user": PLACEHOLDER,
        "postgres_password": SecretStr(PLACEHOLDER),
        "postgres_db": PLACEHOLDER,
        "redis_host": PLACEHOLDER,
        "edge_signing_secret": SecretStr("0" * 32),
        "edge_service_key": SecretStr("0" * 32),
        "model_enabled": True,
        "model_api_key": KEY,
        **overrides,
    }
    return Settings(
        **base
    )  # pyright: ignore[reportArgumentType]  # 理由：用例造件按名传参


@dataclass
class FakeData:
    embedding: list[float]


@dataclass
class FakeAnswer:
    data: list[FakeData]


@dataclass
class FakeEmbeddings:
    answer: FakeAnswer

    async def create(self, *, model: str, input: list[str]) -> FakeAnswer:
        assert model
        assert input
        return self.answer


@dataclass
class FakeClient:
    embeddings: FakeEmbeddings


def test_no_model_name_means_this_route_is_not_wired() -> None:
    """嵌入模型名没有兜底：拿对话模型名去打 embeddings 端点必然失败。"""
    assert build_openai_embedding(AdapterDeps(settings=_settings())) is None


def test_the_endpoint_falls_back_to_the_chat_one() -> None:
    """回落链要逐格写全，写漏一格的表现是「改了配置没生效」。"""
    endpoint = _settings(embedding_model="embed-1").embedding_endpoint()
    assert endpoint is not None
    assert endpoint.api_key is KEY
    assert endpoint.model == "embed-1"


def test_its_own_endpoint_keeps_its_own_timeout() -> None:
    """嵌入的延迟与对话不同，共用一格意味着总有一档被将就。"""
    endpoint = _settings(
        embedding_model="embed-1", embedding_timeout_s=7.0
    ).embedding_endpoint()
    assert endpoint is not None
    assert endpoint.timeout_s == 7.0


def test_another_vendors_endpoint_must_bring_its_own_key() -> None:
    """不拦的话每次 remember 都撞 401，而降级会把它吞成「暂时检索不到」。"""
    with pytest.raises(ValueError, match="ASSISTANT_EMBEDDING_API_KEY"):
        _settings(
            embedding_model="embed-1",
            embedding_base_url="https://another.example/v1",
        )


def test_the_same_endpoint_needs_no_second_key() -> None:
    """两档同一家是最常见的形态，不该给它添一格必填。"""
    settings = _settings(
        embedding_model="embed-1",
        embedding_base_url=_settings().model_base_url,
    )
    assert settings.embedding_endpoint() is not None


async def test_a_changed_dimension_is_refused_instead_of_stored() -> None:
    """换了模型而维数变了，旧条目与新条目算不出有意义的余弦——而没有一处会报错。"""
    adapter = OpenAiCompatEmbeddingAdapter(
        client=FakeClient(
            embeddings=FakeEmbeddings(
                answer=FakeAnswer(data=[FakeData(embedding=[1.0, 2.0])])
            )
        ),  # pyright: ignore[reportArgumentType]  # 理由：假件只实现用到的那一格
        model="embed-1",
        dimensions=3,
    )
    with pytest.raises(EmbeddingShapeChanged, match="2 维"):
        await adapter.embed(["一句话"])


async def test_a_matching_dimension_passes_through() -> None:
    """维数对得上就原样交出去，顺序与入参一一对应。"""
    adapter = OpenAiCompatEmbeddingAdapter(
        client=FakeClient(
            embeddings=FakeEmbeddings(
                answer=FakeAnswer(data=[FakeData(embedding=[1.0, 2.0, 3.0])])
            )
        ),  # pyright: ignore[reportArgumentType]  # 理由：假件只实现用到的那一格
        model="embed-1",
        dimensions=3,
    )
    assert await adapter.embed(["一句话"]) == [[1.0, 2.0, 3.0]]
