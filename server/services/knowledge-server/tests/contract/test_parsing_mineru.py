"""MinerU 那一路的翻译：拿**真服务的回包**验，不拿手写的样例验。

⚠ 夹具是 `tests/fixtures/mineru_file_parse.json`，从一台真跑着的
`mineru==3.4.5` 上抓的（ADR-0043：没有真实端点可验，写出来的是一份猜的线形）。
原件是一份每页内容已知的三页 PDF，每页埋了一个哨兵串——页码对不对靠它验，
而不是只验「有 page 这一格」。
"""

import json
import pathlib

import pytest

from knowledge_server.apps.knowledge.services.parsing import (
    ExternalParseFailed,
)
from knowledge_server.apps.knowledge.services.parsing.mineru import (
    MineruBackend,
    document_of,
)

FIXTURE = (
    pathlib.Path(__file__).parent.parent / "fixtures" / "mineru_file_parse.json"
)
# 哨兵串 → 它该在第几页（从 1 起；MinerU 的 page_idx 从 0 起）
SENTINELS = {"PAGE-ONE": 1, "PAGE-TWO": 2, "PAGE-THREE": 3}


def _payload() -> dict[str, object]:
    return json.loads(FIXTURE.read_text(encoding="utf-8"))


def test_the_fixture_still_ships_content_list_as_a_json_string() -> None:
    """⚠ 钉住这一条：`content_list` 是**一个 JSON 字符串**，不是数组。
    当成数组用的话拿到的是三千多个单字符，而那一路不报错——它只表现为
    「切出来一份全是单字的文档」。"""
    one = _payload()["results"]["spec"]  # pyright: ignore[reportIndexIssue]
    assert isinstance(one["content_list"], str)


def test_every_block_carries_the_page_it_came_from() -> None:
    made = document_of("spec.pdf", _payload())
    assert made.blocks
    assert all(one.locator.page is not None for one in made.blocks)


@pytest.mark.parametrize(("mark", "page"), sorted(SENTINELS.items()))
def test_the_page_number_is_right_not_just_present(
    mark: str, page: int
) -> None:
    """⚠ 只验「有 page 这一格」是不够的：全填 1 也能过。哨兵串钉的是**对不对**。

    Args: mark, page。
    """
    made = document_of("spec.pdf", _payload())
    hit = [one for one in made.blocks if mark in one.text]
    assert len(hit) == 1
    assert hit[0].locator.page == page


def test_the_table_header_is_folded_into_every_row() -> None:
    """⚠ 只存 `65 | 28 | ℃` 的话，检索到这一行也读不出它是什么——
    列名在表头那一行，而那一行是另一个块。"""
    made = document_of("spec.pdf", _payload())
    rows = [one for one in made.blocks if one.kind == "table_row"]
    assert rows
    assert all("参数=" in one.text for one in rows)
    assert any(
        "冷凝器出口温度" in one.text and "上限=65" in one.text for one in rows
    )


def test_the_table_rows_land_on_the_page_the_table_is_on() -> None:
    made = document_of("spec.pdf", _payload())
    rows = [one for one in made.blocks if one.kind == "table_row"]
    assert {one.locator.page for one in rows} == {2}


def test_the_figure_caption_survives_as_searchable_text() -> None:
    """⚠ 图注要进正文：不进的话「图 1 冷却水回路示意图」这句话在库里根本
    不存在，检索不到。"""
    made = document_of("spec.pdf", _payload())
    figures = [one for one in made.blocks if one.kind == "figure"]
    assert any("冷却水回路示意图" in one.text for one in figures)


def test_a_figure_block_points_at_the_bytes_by_basename() -> None:
    """⚠ `img_path` 是 `images/<sha>.jpg` 而 `images` 那个字典的键是
    `<sha>.jpg`——两边靠 basename 对上。取整条路径的话一张也对不上，
    而表现是「解析成功但一张图都没有」。"""
    made = document_of("spec.pdf", _payload())
    refs = {one.figure_ref for one in made.blocks if one.kind == "figure"}
    assert refs
    assert refs <= {one.ref for one in made.figures}
    assert all("/" not in one for one in refs)


def test_the_image_bytes_come_out_of_the_data_uri() -> None:
    """⚠ `images` 的值是**完整的 data URI**，不是裸 base64：当成裸的去 decode
    会在头几个字节上就失败，而那时一张图都出不来。"""
    made = document_of("spec.pdf", _payload())
    assert made.figures
    assert all(one.content for one in made.figures)
    assert all(one.media_type.startswith("image/") for one in made.figures)


def test_a_figure_carries_the_page_and_caption_from_the_layout_list() -> None:
    made = document_of("spec.pdf", _payload())
    drawing = next(
        one for one in made.figures if "冷却水回路示意图" in one.caption
    )
    assert drawing.kind == "image"
    assert drawing.page == 3
    assert drawing.bbox is not None


def test_the_table_screenshot_comes_out_alongside_its_rows() -> None:
    """⚠ 表格截图与那些 `table_row` 文本块**并存**：文本块负责被检索到，
    截图负责让人看清合并单元格那类版面——两者缺一个都不够。"""
    made = document_of("spec.pdf", _payload())
    tables = [one for one in made.figures if one.kind == "table"]
    assert len(tables) == 1
    assert tables[0].page == 2
    assert any(one.kind == "table_row" for one in made.blocks)


def test_a_figure_without_a_caption_still_gets_a_block() -> None:
    """⚠ 块的正文不许为空（`text_present` 那条 CHECK），而一张没有图注的图
    仍然值得在引用面上摆出来——所以用一句占位，不是丢掉它。"""
    body = {
        "results": {
            "spec": {
                "content_list": json.dumps(
                    [
                        {
                            "type": "image",
                            "img_path": "images/x.jpg",
                            "image_caption": [],
                            "page_idx": 0,
                        }
                    ]
                )
            }
        }
    }
    made = document_of("spec.pdf", body)
    figure = next(one for one in made.blocks if one.kind == "figure")
    assert figure.text
    assert figure.figure_ref == "x.jpg"


def test_a_reply_without_images_still_parses() -> None:
    """⚠ 没要图（或后端没给）时不该整份失败：文本那一半仍然有用。"""
    body = {
        "results": {
            "spec": {
                "content_list": json.dumps(
                    [{"type": "text", "text": "正文一句", "page_idx": 0}]
                )
            }
        }
    }
    made = document_of("spec.pdf", body)
    assert made.figures == ()
    assert made.blocks


def test_headings_become_headings_and_carry_a_path() -> None:
    made = document_of("spec.pdf", _payload())
    headings = [one for one in made.blocks if one.kind == "heading"]
    assert [one.text for one in headings] == [
        "冷却水系统操作规程",
        "一、适用范围",
        "二、运行参数",
        "三、系统示意",
    ]
    # ⚠ 层级是 MinerU 自己判的：这份 PDF 的 h1 与 h2 都回了 text_level=2，
    # 所以标题栈是**平的**，路径只到「最近的一个标题」——别指望层级链
    assert all(len(one.locator.path) == 1 for one in headings)


def test_no_block_is_blank() -> None:
    made = document_of("spec.pdf", _payload())
    assert all(one.text.strip() for one in made.blocks)


def test_a_reply_without_the_layout_list_says_which_flag_is_missing() -> None:
    """⚠ `return_content_list` 默认是 false：忘了带的表现是回包里只有
    markdown，而 markdown 里没有页码。这句话要点得出那一格的名字。"""
    with pytest.raises(ExternalParseFailed, match="return_content_list"):
        document_of("spec.pdf", {"results": {"spec": {"md_content": "# 甲"}}})


def test_an_empty_parse_is_not_passed_off_as_a_document() -> None:
    """⚠ 回空壳的话，文档会走到 ready 而检索永远查不到它——
    那与「这份文档里确实没有这句话」长得一模一样。"""
    with pytest.raises(ExternalParseFailed):
        document_of("spec.pdf", {"results": {"spec": {"content_list": "[]"}}})


def test_no_results_at_all_is_an_error_not_an_empty_document() -> None:
    with pytest.raises(ExternalParseFailed):
        document_of("spec.pdf", {"results": {}})


def test_office_is_left_to_the_local_parsers() -> None:
    """⚠ 外部这一路排在本地之前：声明了 .docx 就会把它从解得更准的
    `DocxParser` 手里抢走，还要多花几十秒 CPU。"""
    made = MineruBackend(base_url="http://mineru:8000")
    assert ".pdf" in made.suffixes
    assert not {".docx", ".xlsx", ".pptx"} & set(made.suffixes)
