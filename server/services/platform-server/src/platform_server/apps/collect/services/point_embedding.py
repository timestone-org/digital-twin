"""采集点位嵌入档与有界批次；复用 llmcore，见 ADR-0055。"""

import asyncio
import hashlib
import math
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from lib.crypto import SecretCipher
from llmcore.catalog import ModelCatalog
from llmcore.endpoints import EmbeddingEndpoint
from llmcore.openai_embedding import build_openai_embedding
from platform_server.apps.llm_providers.services import build_catalog

EMBEDDING_PURPOSE = "knowledge.embedding"
EMBEDDING_TIMEOUT_S = 8.0
CHUNK_CHARS = 256


class PointSessions(Protocol):
    """索引与查询的短事务工厂。"""

    def session(self) -> AbstractAsyncContextManager[AsyncSession]: ...


@dataclass(frozen=True)
class PointEmbeddingProfile:
    """同一嵌入空间的端点和非敏感身份。"""

    endpoint: EmbeddingEndpoint
    signature: str


async def load_profile(
    database: PointSessions, cipher: SecretCipher | None
) -> PointEmbeddingProfile | None:
    """读取已分配的嵌入档。Args: database, cipher。"""
    async with database.session() as session:
        wire = await build_catalog(session, cipher=cipher)
    catalog = ModelCatalog.from_wire(wire.model_dump())
    endpoint = catalog.embedding_endpoint(
        EMBEDDING_PURPOSE, timeout_s=EMBEDDING_TIMEOUT_S
    )
    resolved = catalog.resolve(EMBEDDING_PURPOSE)
    if endpoint is None or resolved is None:
        return None
    identity = ":".join(
        (
            resolved.provider.id,
            endpoint.base_url,
            endpoint.model,
            str(endpoint.dimensions),
        )
    )
    return PointEmbeddingProfile(
        endpoint, hashlib.sha256(identity.encode()).hexdigest()
    )


def normalized(vector: list[float]) -> list[float]:
    """校验并归一化向量。Args: vector。"""
    if not vector or not all(math.isfinite(value) for value in vector):
        raise ValueError("嵌入向量含非法数值")
    norm = math.sqrt(sum(value * value for value in vector))
    if not math.isfinite(norm) or norm == 0:
        raise ValueError("嵌入向量不可归一化")
    return [value / norm for value in vector]


async def embed_texts(
    profile: PointEmbeddingProfile, texts: list[str]
) -> list[list[float]]:
    """在事务外嵌入一批并释放连接。Args: profile, texts。"""
    adapter = build_openai_embedding(profile.endpoint)
    if adapter is None:
        raise ValueError("没有可用的嵌入档")
    chunks = [
        [
            text[start : start + CHUNK_CHARS]
            for start in range(0, len(text), CHUNK_CHARS)
        ]
        or [""]
        for text in texts
    ]
    flat = [part for parts in chunks for part in parts]
    try:
        async with asyncio.timeout(EMBEDDING_TIMEOUT_S):
            vectors = await adapter.embed(flat)
        if len(vectors) != len(flat):
            raise ValueError("嵌入结果数量不匹配")
        result: list[list[float]] = []
        offset = 0
        for parts in chunks:
            batch = [
                normalized(vector)
                for vector in vectors[offset : offset + len(parts)]
            ]
            result.append(
                normalized(
                    [
                        sum(values) / len(batch)
                        for values in zip(*batch, strict=True)
                    ]
                )
            )
            offset += len(parts)
        return result
    finally:
        await adapter.client.close()
