"""pgvector 绑定参数使用的数值字面量。"""

from collections.abc import Sequence


def literal(vector: Sequence[float]) -> str:
    """将向量编码成驱动可绑定的文本。Args: vector。"""
    return "[" + ",".join(repr(float(value)) for value in vector) + "]"
