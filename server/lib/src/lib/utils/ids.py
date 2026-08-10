"""标识生成：UUIDv7（时间前缀有序）与 uuid5 内容寻址。"""

import os
import time
import uuid

_VERSION_7 = 0x7000
_VARIANT_RFC4122 = 0x8000
_MS_MASK = 0xFFFFFFFFFFFF
_RAND_A_MASK = 0x0FFF
_RAND_B_MASK = 0x3FFFFFFFFFFFFFFF


def uuid7(*, now_ms: int | None = None) -> uuid.UUID:
    """生成 UUIDv7（RFC 9562 §5.7）：48 位毫秒时间戳前缀 + 74 位随机。

    Args: now_ms（毫秒时间戳，缺省取当前时钟；测试注入用）。
    """
    timestamp = time.time_ns() // 1_000_000 if now_ms is None else now_ms
    entropy = int.from_bytes(os.urandom(10), "big")
    rand_a = (entropy >> 62) & _RAND_A_MASK
    rand_b = entropy & _RAND_B_MASK
    value = (
        ((timestamp & _MS_MASK) << 80)
        | ((_VERSION_7 | rand_a) << 64)
        | (_VARIANT_RFC4122 << 48)
        | rand_b
    )
    return uuid.UUID(int=value)


def uuid5_of(namespace: uuid.UUID, *parts: str) -> uuid.UUID:
    """内容寻址标识：同一份输入恒得同一个 id，重复导入天然幂等。

    Args: namespace, parts。
    """
    return uuid.uuid5(namespace, "\x1f".join(parts))
