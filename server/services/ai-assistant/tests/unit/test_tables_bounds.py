"""xlsx 附件的读取有界：解压量与逐行计数都有上限。

守的是「一份高压缩比的表把事件循环钉住」：2 MB 的 xlsx 能解出几百 MB 的
sheet XML，整张读进内存再截断的话，同一副本上的其它请求一起卡住。
"""

import io
import zipfile

import pytest
from openpyxl import Workbook

from ai_assistant.apps.chat.schemas.attachment import MAX_CONTENT_CHARS
from ai_assistant.apps.chat.services.perception import (
    UnsupportedInput,
    tables,
)
from ai_assistant.apps.chat.services.perception.tables import (
    MAX_ROWS,
    parse_table,
    summary_of,
    to_text,
)


def _xlsx(count: int) -> bytes:
    book = Workbook()
    sheet = book.active
    assert sheet is not None
    sheet.append(["code", "name"])
    for index in range(count):
        sheet.append([f"p{index}", f"点{index}"])
    buffer = io.BytesIO()
    book.save(buffer)
    return buffer.getvalue()


def test_counting_stops_at_the_bound_and_says_so(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(tables, "MAX_COUNTED_ROWS", MAX_ROWS + 100)
    got = parse_table("点表.xlsx", _xlsx(MAX_ROWS + 500))
    assert len(got.rows) == MAX_ROWS
    assert got.is_truncated is True
    assert got.total_rows == MAX_ROWS + 100
    assert got.is_total_capped is True
    assert f"超过 {MAX_ROWS + 100} 行" in to_text(got)
    assert "已截断" in summary_of(got)


def test_a_sheet_under_the_bound_counts_exactly() -> None:
    got = parse_table("点表.xlsx", _xlsx(MAX_ROWS + 50))
    assert got.total_rows == MAX_ROWS + 50
    assert got.is_total_capped is False
    assert f"整张表共 {MAX_ROWS + 50} 行" in to_text(got)


def test_an_oversized_archive_is_refused_before_it_is_opened(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def refuse(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("超限的压缩包不该被 openpyxl 打开")

    monkeypatch.setattr(tables, "MAX_UNPACKED_BYTES", 1_000)
    monkeypatch.setattr(tables, "load_workbook", refuse)
    with pytest.raises(UnsupportedInput, match="解压后"):
        parse_table("点表.xlsx", _xlsx(10))


def test_a_dense_table_at_the_upload_cap_is_still_read() -> None:
    # 点表一类文字重复多的表实测压缩比约 15 倍：上限卡得比这还紧的话，
    # 一份没超上传上限的正常点表会被当成压缩炸弹拒掉
    uploaded = MAX_CONTENT_CHARS * 3 // 4
    buffer = io.BytesIO(_xlsx(10))
    with zipfile.ZipFile(buffer, "a", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("xl/media/pad.bin", bytes(16 * uploaded))
    content = buffer.getvalue()
    assert len(content) < uploaded
    got = parse_table("点表.xlsx", content)
    assert got.total_rows == 10
