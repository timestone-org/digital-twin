"""嵌入请求实际使用的向量空间及其结果。"""

import hashlib
import json
from dataclasses import dataclass


@dataclass(frozen=True)
class EmbeddingBatch:
    """绑定请求端点的模型名、空间标识与向量。"""

    identity: str
    model: str
    vectors: list[list[float]]


def embedding_identity(
    origin: str, model: str, dimensions: int, source: str
) -> str:
    """计算不包含凭据的空间标识。Args: origin, model, dimensions, source。"""
    signature = [origin.rstrip("/"), model, dimensions, source]
    return hashlib.sha256(json.dumps(signature).encode()).hexdigest()
