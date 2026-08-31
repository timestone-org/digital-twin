"""纯文本解码器：txt / md / json / yaml 这一类逐字读进来。

解析本身在 `perception/tables.py`，这里只把它接到注册表的形状上。
"""

from dataclasses import dataclass

from ai_assistant.apps.chat.services.perception.ports import AsText, Decoded
from ai_assistant.apps.chat.services.perception.tables import (
    TEXT_SUFFIXES,
    parse_table,
    summary_of,
    to_text,
)


@dataclass(frozen=True)
class TextDecoder:
    """一份资料原样进上下文，只按字符数截断。"""

    @property
    def name(self) -> str:
        """这一路解码器在注册表里的名字。"""
        return "text"

    @property
    def suffixes(self) -> tuple[str, ...]:
        """认哪些后缀。⚠ 与 `tables.py` 共用同一份，不另抄。"""
        return TEXT_SUFFIXES

    @property
    def media_types(self) -> tuple[str, ...]:
        """按后缀判就够了。"""
        return ()

    def decode(self, raw: bytes, filename: str) -> Decoded:
        """读成一段正文。

        Args: raw, filename。
        """
        table = parse_table(filename, raw)
        return AsText(
            text=to_text(table),
            is_truncated=table.is_truncated,
            summary=summary_of(table),
        )
