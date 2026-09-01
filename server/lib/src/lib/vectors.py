"""向量的编解码与余弦。纯计算，零项目名词。

两个消费方：助手的长期记忆（ADR-0030）与知识库的回退档索引（ADR-0034）。
两处都要「把一条向量压成字节存进 bytea，取回来算余弦」，而那是同一段数学。

⚠ 编码钉死成**小端 float32**（`<`）。用 `array.array` 的本机字节序省不了多少，
却把「换一台不同字节序的机器读同一个库」变成一堆读得出来但算不对的数——
而那不会报错，只表现为召回忽然全错。
"""

import struct
from collections.abc import Sequence
from math import sqrt

# 一个 float32 四字节
_WIDTH = 4
_ORDER = "<"


class VectorCorrupt(ValueError):
    """存下来的字节数不是 float32 的整数倍。"""


def encode(values: Sequence[float]) -> bytes:
    """把一条向量压成字节。

    Args: values。
    """
    return struct.pack(f"{_ORDER}{len(values)}f", *values)


def decode(raw: bytes) -> list[float]:
    """把字节还原成一条向量。

    ⚠ 长度对不上就抛，不截断也不补零：截出来的向量算得出一个余弦，
    而那个数没有任何意义——它会排在召回里看着像一条正常结果。

    Args: raw。
    """
    if len(raw) % _WIDTH != 0:
        raise VectorCorrupt(f"{len(raw)} 字节不是 {_WIDTH} 的整数倍")
    count = len(raw) // _WIDTH
    return list(struct.unpack(f"{_ORDER}{count}f", raw))


def cosine(left: Sequence[float], right: Sequence[float]) -> float:
    """两条向量的余弦相似度；维数不同或有一条是零向量时给 0。

    ⚠ 维数不同给 0 而不是抛：换过嵌入模型的库里两种维数会并存，而一条读不了的
    旧记录不该让整次检索失败——它只该排不上去。

    Args: left, right。
    """
    if len(left) != len(right) or not left:
        return 0.0
    dot = sum(one * other for one, other in zip(left, right, strict=True))
    left_norm = sqrt(sum(one * one for one in left))
    right_norm = sqrt(sum(one * one for one in right))
    if left_norm == 0.0 or right_norm == 0.0:
        return 0.0
    return dot / (left_norm * right_norm)
