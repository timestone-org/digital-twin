"""嵌入层：缺席要如实说出来，而不是悄悄回空。"""

import pytest
from pydantic import SecretStr

from knowledge_server.apps.knowledge.services.embedding import (
    Embedder,
    EmbeddingUnavailable,
    NullEmbedder,
    build_embedder,
)
from llmcore.endpoints import EmbeddingEndpoint

# 这套部署那一档的嵌入窗口
WINDOW = 512


def test_nothing_wired_gives_a_null_embedder() -> None:
    """⚠ 给 `Null*` 而不是 `None`：调用方于是不必写「这一路在不在」的分支，
    而那种判断散布到每个调用点之后，漏判一处的表现是「有时候没建索引」。"""
    made = build_embedder(None, WINDOW)
    assert isinstance(made, NullEmbedder)
    assert made.can_embed is False
    assert made.dimensions == 0


async def test_the_null_embedder_raises_instead_of_returning_nothing() -> None:
    """⚠ 回空表的话，调用方会把「没接嵌入」当成「算出来是空的」，
    然后把文档标成 ready 而库里一条向量都没有。"""
    with pytest.raises(EmbeddingUnavailable):
        await NullEmbedder().embed(["甲"])


def test_a_wired_endpoint_can_embed() -> None:
    made = build_embedder(
        EmbeddingEndpoint(
            base_url="http://endpoint/v1",
            api_key=SecretStr("key"),
            model="text-embedding",
            timeout_s=30.0,
            dimensions=1536,
        ),
        WINDOW,
    )
    assert made.can_embed is True
    assert made.dimensions == 1536
    assert made.max_input_tokens == WINDOW
    assert made.id == "openai-compat"


def test_both_paths_satisfy_the_protocol() -> None:
    """⚠ 不钉这一条的话，注册表本身就成了新的静默失效点。"""
    assert isinstance(NullEmbedder(), Embedder)
    assert isinstance(build_embedder(None, WINDOW), Embedder)
