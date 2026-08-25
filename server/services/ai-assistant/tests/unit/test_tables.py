"""读用户上传的点表。

守三条现场教训：CSV 带 BOM 是常态（不剥的话首列表头多一个看不见的字符）、
xlsx 里要取公式**算出来的值**（取到 `=A1*2` 的话匹配永远对不上，而表格在 Excel
里看着一切正常）、以及截断了必须说出来（少了多少行，从外面得看得见）。
"""

import io

import pytest
from openpyxl import Workbook

from ai_assistant.apps.chat.services.tables import (
    MAX_ROWS,
    UnsupportedTable,
    parse_table,
    to_text,
)


def _xlsx(rows: list[list[object]]) -> bytes:
    book = Workbook()
    sheet = book.active
    assert sheet is not None
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def test_a_csv_is_read_into_a_header_and_rows() -> None:
    got = parse_table(
        "点表.csv", b"code,name\nK1_TT,\xe6\xb8\xa9\xe5\xba\xa6\n"
    )
    assert got.columns == ["code", "name"]
    assert got.rows == [["K1_TT", "温度"]]


def test_a_byte_order_mark_never_reaches_the_first_header() -> None:
    # 不剥的话首列表头多一个看不见的字符，「为什么第一列匹配不上」极难查
    got = parse_table("点表.csv", "﻿code,name\na,b\n".encode())
    assert got.columns[0] == "code"


def test_a_local_encoding_falls_back_instead_of_failing() -> None:
    got = parse_table("点表.csv", "编码,名称\na,出口温度\n".encode("gb18030"))
    assert got.columns == ["编码", "名称"]


def test_a_comma_inside_quotes_stays_in_one_cell() -> None:
    # 寻址串里带逗号是常事
    got = parse_table("点表.csv", b'code,address\na,"ns=2;s=A,B"\n')
    assert got.rows == [["a", "ns=2;s=A,B"]]


def test_an_xlsx_is_read_the_same_way() -> None:
    got = parse_table("点表.xlsx", _xlsx([["code", "name"], ["K1_TT", "温度"]]))
    assert got.columns == ["code", "name"]
    assert got.rows == [["K1_TT", "温度"]]


def test_numbers_come_through_as_text() -> None:
    got = parse_table("点表.xlsx", _xlsx([["code", "n"], ["a", 12]]))
    assert got.rows == [["a", "12"]]


def test_blank_rows_are_dropped() -> None:
    # 导出的表尾常挂着几十行空格，进了上下文就是纯噪音
    got = parse_table("点表.csv", b"code\na\n\n\n")
    assert got.rows == [["a"]]


def test_a_file_with_nothing_in_it_reads_as_empty() -> None:
    got = parse_table("空.csv", b"\n\n")
    assert got.columns == []
    assert to_text(got) == "（这个文件里没有读到任何内容）"


def test_a_long_table_is_truncated_and_says_so() -> None:
    body = "\n".join(f"p{index}" for index in range(MAX_ROWS + 50))
    got = parse_table("点表.csv", f"code\n{body}\n".encode())
    assert len(got.rows) == MAX_ROWS
    assert got.is_truncated is True
    assert got.total_rows == MAX_ROWS + 50


def test_the_truncation_shows_up_in_the_text() -> None:
    body = "\n".join(f"p{index}" for index in range(MAX_ROWS + 50))
    got = parse_table("点表.csv", f"code\n{body}\n".encode())
    assert str(MAX_ROWS + 50) in to_text(got)


def test_the_text_is_pipe_separated_not_json() -> None:
    # 同样的内容，表格形态的 token 数少得多
    got = parse_table("点表.csv", b"code,name\na,b\n")
    assert to_text(got).splitlines()[0] == "code | name"


def test_an_unknown_suffix_is_refused_plainly() -> None:
    with pytest.raises(UnsupportedTable):
        parse_table("点表.pdf", b"%PDF")


def test_an_unreadable_encoding_is_refused_plainly() -> None:
    with pytest.raises(UnsupportedTable):
        parse_table("点表.csv", b"\xff\xfe\x00\x00\xff")
