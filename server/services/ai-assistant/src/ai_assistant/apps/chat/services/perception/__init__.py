"""层 1 感知输入：把用户与页面交进来的东西解成模型看得懂的样子。

⚠ 这一包对外只认这个再导出面。别的功能模块直接伸进子模块时结构闸**不会拦**
（它只判跨功能 import 路径的第 4 段是不是 `services`），只能靠这份清单与评审守。
"""

from ai_assistant.apps.chat.services.perception.ports import (
    AsImage,
    AsText,
    Decoded,
    InputDecoder,
    UnsupportedInput,
)
from ai_assistant.apps.chat.services.perception.registry import (
    DECODERS,
    accepted_suffixes,
    decode,
    decoder_for,
)

__all__ = [
    "DECODERS",
    "AsImage",
    "AsText",
    "Decoded",
    "InputDecoder",
    "UnsupportedInput",
    "accepted_suffixes",
    "decode",
    "decoder_for",
]
