"""嵌入那一路：维数对不上就抛，没配端点就是没接。"""

from dataclasses import dataclass
from typing import Any

import pytest
from pydantic import SecretStr

from llmcore.endpoints import EmbeddingEndpoint
from llmcore.openai_embedding import (
    EMBEDDING_SOURCE,
    EmbeddingShapeChanged,
    OpenAiCompatEmbeddingAdapter,
    build_openai_embedding,
)


@dataclass(frozen=True)
class _Row:
    embedding: list[float]


@dataclass(frozen=True)
class _Answer:
    data: list[_Row]


class _Embeddings:
    def __init__(self, rows: list[list[float]]) -> None:
        self._rows = rows
        self.seen: list[Any] = []

    async def create(self, *, model: str, input: list[str]) -> _Answer:
        self.seen.append((model, input))
        return _Answer(data=[_Row(embedding=one) for one in self._rows])


class _Client:
    def __init__(self, rows: list[list[float]]) -> None:
        self.embeddings = _Embeddings(rows)


def _adapter(
    rows: list[list[float]], dimensions: int = 3
) -> tuple[OpenAiCompatEmbeddingAdapter, _Client]:
    client = _Client(rows)
    made = OpenAiCompatEmbeddingAdapter(
        client=client,  # pyright: ignore[reportArgumentType]
        model="text-embedding",
        dimensions=dimensions,
    )
    return (made, client)


async def test_vectors_come_back_in_order() -> None:
    adapter, client = _adapter([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
    made = await adapter.embed(["甲", "乙"])
    assert made == [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]
    assert client.embeddings.seen == [("text-embedding", ["甲", "乙"])]


async def test_a_changed_dimension_raises_instead_of_being_stored() -> None:
    """⚠ 照单全收的话，旧条目与新条目算不出有意义的余弦，而表现只是
    「召回忽然变差了」——没有任何一处会报错。"""
    adapter, _ = _adapter([[1.0, 2.0]], dimensions=3)
    with pytest.raises(EmbeddingShapeChanged, match="2 维"):
        await adapter.embed(["甲"])


async def test_one_wrong_row_fails_the_whole_batch() -> None:
    """半批对半批不对时整批抛：混进去的那几条同样算不出有意义的余弦。"""
    adapter, _ = _adapter([[1.0, 2.0, 3.0], [1.0]], dimensions=3)
    with pytest.raises(EmbeddingShapeChanged):
        await adapter.embed(["甲", "乙"])


def test_no_endpoint_means_this_route_is_not_wired() -> None:
    """⚠ 给 `None` 而不是抛：消费方可以「只存不排」，而整个服务在没接嵌入时
    仍然要能起。"""
    assert build_openai_embedding(None) is None


def test_a_wired_endpoint_carries_its_dimensions() -> None:
    made = build_openai_embedding(
        EmbeddingEndpoint(
            base_url="http://endpoint/v1",
            api_key=SecretStr("key"),
            model="text-embedding",
            timeout_s=30.0,
            dimensions=1536,
        )
    )
    assert made is not None
    assert made.dimensions == 1536
    assert made.id == EMBEDDING_SOURCE


def test_the_source_name_is_a_wire_contract() -> None:
    """⚠ 落库的 `embedding_model` 旁边存的就是它，换名字会让存量条目看着
    像另一路算的。"""
    assert EMBEDDING_SOURCE == "openai-compat"
