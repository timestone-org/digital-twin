"""同名、同端点的不同模型供应商独立，已停用的旧模型不能再调用。"""

import httpx2 as httpx
import pytest
from openai import DefaultAsyncHttpxClient
from pydantic import SecretStr

from knowledge_server.apps.knowledge.services.embedding import (
    EmbeddingUnavailable,
)
from knowledge_server.apps.knowledge.services.embedding.catalog import (
    CatalogEmbedder,
    CatalogTransport,
    close_embedding,
)
from knowledge_server.llm_purposes import PURPOSE_EMBEDDING
from llmcore.catalog import Assignment, ModelCatalog, ModelSpec, ProviderSpec


def configured(active: str, *, is_old_enabled: bool) -> ModelCatalog:
    model = ModelSpec("equal", "embedding", dimensions=4)

    def provider(name: str, is_enabled: bool) -> ProviderSpec:
        return ProviderSpec(
            name,
            name,
            "openai_compat",
            "http://model.test/v1",
            SecretStr(name),
            is_enabled,
            (model,),
        )

    return ModelCatalog(
        (provider("old", is_old_enabled), provider("new", True)),
        (Assignment(PURPOSE_EMBEDDING, active, "equal"),),
    )


class Directory:
    def __init__(self) -> None:
        self.value = configured("old", is_old_enabled=True)

    def snapshot(self) -> ModelCatalog:
        return self.value

    async def refresh(self, *, is_forced: bool = False) -> ModelCatalog:
        del is_forced
        return self.value


async def test_registered_old_model_remains_queryable_until_disabled() -> None:
    directory = Directory()

    async def reply(request: httpx.Request) -> httpx.Response:
        values = (
            [1.0, 0.0, 0.0, 0.0]
            if request.headers["authorization"] == "Bearer old"
            else [0.0, 1.0, 0.0, 0.0]
        )
        return httpx.Response(
            200,
            json={
                "object": "list",
                "model": "equal",
                "data": [
                    {"object": "embedding", "index": 0, "embedding": values}
                ],
                "usage": {"prompt_tokens": 1, "total_tokens": 1},
            },
        )

    transport = CatalogTransport(
        directory,
        lambda: None,
        1.0,
        DefaultAsyncHttpxClient(transport=httpx.MockTransport(reply)),
    )
    editor = CatalogEmbedder(transport, 128)
    try:
        old = editor.space
        assert old is not None
        directory.value = configured("new", is_old_enabled=True)
        target = editor.space
        assert target is not None
        assert target.identity != old.identity
        bound = editor.for_space(old.identity)
        assert bound is not None
        outcome = await bound.embed_batch(["sample"])
        assert outcome.identity == old.identity
        assert outcome.vectors == [[1.0, 0.0, 0.0, 0.0]]
        directory.value = configured("new", is_old_enabled=False)
        assert editor.for_space(old.identity) is None
        with pytest.raises(EmbeddingUnavailable):
            await bound.embed_batch(["sample"])
    finally:
        await close_embedding(editor)
