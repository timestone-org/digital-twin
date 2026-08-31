"""装了哪几路解码器，以及按文件名挑其中一路。

⚠ 注册是**显式元组**，不靠 import 副作用（ADR-0029 决策四）：隐式注册让
「装了哪些解码器」取决于 import 顺序，而顺序在测试里与生产里可以不同。

⚠ **界面的 accept 名单由这里算出来下发**，前端不再写死一份。两份漂开的表现是
「选得中的文件传上去被拒」——而两边单看都对，谁也不觉得自己错了。
"""

from ai_assistant.apps.chat.services.perception.decoders.image import (
    ImageDecoder,
)
from ai_assistant.apps.chat.services.perception.decoders.table import (
    TableDecoder,
)
from ai_assistant.apps.chat.services.perception.decoders.text import (
    TextDecoder,
)
from ai_assistant.apps.chat.services.perception.ports import (
    Decoded,
    InputDecoder,
    UnsupportedInput,
)

# 装了哪几路。⚠ 加一路 = 加一个文件 + 这里一行 + 一条契约测试
DECODERS: tuple[InputDecoder, ...] = (
    TableDecoder(),
    TextDecoder(),
    ImageDecoder(),
)


def accepted_suffixes(
    decoders: tuple[InputDecoder, ...] = DECODERS,
) -> tuple[str, ...]:
    """界面 file input 的 accept 名单，按注册序摊平。

    Args: decoders（只给测试换一份假的用）。
    """
    return tuple(one for decoder in decoders for one in decoder.suffixes)


def decoder_for(
    filename: str, decoders: tuple[InputDecoder, ...] = DECODERS
) -> InputDecoder:
    """按文件名后缀挑一路；一路都不认就抛。

    ⚠ 先到先得，按注册序。名单重叠时靠顺序定，而不是靠「最长后缀优先」这类
    隐式规则——那种规则在加第四路时没人记得。

    Args: filename, decoders。
    """
    lowered = filename.lower()
    for decoder in decoders:
        if lowered.endswith(decoder.suffixes):
            return decoder
    raise UnsupportedInput(
        f"认不出 {filename} 是什么文件。收表格（.xlsx / .csv）、"
        "纯文本（.txt / .md / .json 等）与图片（.png / .jpg / .webp）"
    )


def decode(
    filename: str,
    raw: bytes,
    decoders: tuple[InputDecoder, ...] = DECODERS,
) -> Decoded:
    """挑一路解码器把它解开。

    Args: filename, raw, decoders。
    """
    return decoder_for(filename, decoders).decode(raw, filename)
