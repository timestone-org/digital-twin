"""表格解码器：xlsx / xlsm / csv 摊成表头加数据行。

解析本身在 `perception/tables.py`，这里只把它接到注册表的形状上。
"""

from dataclasses import dataclass

from ai_assistant.apps.chat.services.perception.ports import AsText, Decoded
from ai_assistant.apps.chat.services.perception.tables import (
    TABLE_SUFFIXES,
    parse_table,
    summary_of,
    to_text,
)


@dataclass(frozen=True)
class TableDecoder:
    """点表这一路。现场拿到的表十有八九是 xlsx 或 csv。"""

    @property
    def name(self) -> str:
        """这一路解码器在注册表里的名字。"""
        return "table"

    @property
    def suffixes(self) -> tuple[str, ...]:
        """认哪些后缀。⚠ 与 `tables.py` 共用同一份，不另抄。"""
        return TABLE_SUFFIXES

    @property
    def media_types(self) -> tuple[str, ...]:
        """按后缀判就够了：表格类的 media type 各家浏览器给的都不一样。"""
        return ()

    def decode(self, raw: bytes, filename: str) -> Decoded:
        """读成一段竖线表。

        Args: raw, filename。
        """
        table = parse_table(filename, raw)
        return AsText(
            text=to_text(table),
            is_truncated=table.is_truncated,
            summary=summary_of(table),
        )
