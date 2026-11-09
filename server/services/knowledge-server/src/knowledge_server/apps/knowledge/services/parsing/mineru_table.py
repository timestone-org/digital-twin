"""MinerU 回包里 `table_body` 那段 HTML 拆成一行行单元格。

⚠ 不执行任何脚本、不跟外链：这段 HTML 是外部服务产出的。
"""

from html.parser import HTMLParser

from knowledge_server.apps.knowledge.services.parsing.structure import cell_text

# 一格最多认它跨几列。⚠ 不设上限的话一句 colspan 就能把一行铺成十万格
_MAX_COLSPAN = 50


def table_rows(html: str) -> list[list[str]]:
    """把 `table_body` 那段 HTML 拆成一行行单元格。

    Args: html。
    """
    walk = _TableWalk()
    walk.feed(html)
    walk.close()
    return walk.rows


class _TableWalk(HTMLParser):
    """只收 `tr` / `td` / `th` 的文本，别的一律丢掉。

    ⚠ 不执行任何脚本、不跟外链：这段 HTML 是外部服务产出的。
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._cells: list[str] = []
        self._buffer: list[str] = []
        self._in_cell = False
        self._span = 1

    def handle_starttag(
        self, tag: str, attrs: list[tuple[str, str | None]]
    ) -> None:
        if tag == "tr":
            self._cells = []
        elif tag in ("td", "th"):
            self._in_cell = True
            self._buffer = []
            span = (dict(attrs).get("colspan") or "").strip()
            self._span = min(int(span), _MAX_COLSPAN) if span.isdigit() else 1
            self._span = max(1, self._span)

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._in_cell:
            self._in_cell = False
            # ⚠ 合并单元格按它跨的列数铺开：不铺的话，后面每一列都配错列名
            text = cell_text("".join(self._buffer))
            self._cells.extend([text] * self._span)
        elif tag == "tr" and self._cells:
            self.rows.append(self._cells)
            self._cells = []

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._buffer.append(data)
