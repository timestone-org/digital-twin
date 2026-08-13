"""质量位：协议无关的三档。各协议的状态码由驱动映射过来，不透传原始码。

分档与映射职责见 docs/COLLECT_DESIGN.md §3 与 ADR-0011。
"""

from typing import Literal, get_args

Quality = Literal["good", "uncertain", "bad"]

QUALITIES: tuple[Quality, ...] = get_args(Quality)
# ⚠ 归一不到三档时判 bad：质量位判不出来却当好数据用，会污染台账
FALLBACK_QUALITY: Quality = "bad"


def normalize_quality(value: object) -> Quality:
    """把任意输入归一到三档，认不出的一律判 bad。

    Args: value。
    """
    if not isinstance(value, str):
        return FALLBACK_QUALITY
    normalized = value.strip().lower()
    for quality in QUALITIES:
        if normalized == quality:
            return quality
    return FALLBACK_QUALITY
