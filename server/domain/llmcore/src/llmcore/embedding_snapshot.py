"""一次嵌入的向量与实际模型身份；身份不读取请求完成后的动态目录。"""

import hashlib
import json
from dataclasses import dataclass


@dataclass(frozen=True)
class EmbeddingBatch:
    identity: str
    vectors: list[list[float]]


def embedding_identity(
    origin: str, model: str, dimensions: int, source: str
) -> str:
    """按端点、模型和维数标识向量空间，不包含密钥。"""
    signature = [origin.rstrip("/"), model, dimensions, source]
    return hashlib.sha256(json.dumps(signature).encode()).hexdigest()
