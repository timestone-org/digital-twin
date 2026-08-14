"""锁住分页两种形态：页码给出偏移，游标不透明且畸形输入一律按参数错拒绝。

游标形状见 docs/agents/api-contract.md §5.1–§5.2：时序集合不返回 total。
"""

import pytest

from lib.errors.base import ValidationFailed
from lib.web import CursorPage, Page, PageParams, decode_cursor, encode_cursor
from lib.web.pagination import DEFAULT_CURSOR_LIMIT, MAX_PAGE_SIZE

ANCHOR = {"ts": "2026-08-12T00:00:00.000Z"}
ANCHOR_CURSOR = "eyJ0cyI6IjIwMjYtMDgtMTJUMDA6MDA6MDAuMDAwWiJ9"


def test_page_params_turn_a_page_number_into_an_offset() -> None:
    assert PageParams(page=3, size=20).offset == 40


def test_page_params_start_at_the_first_row() -> None:
    assert PageParams(page=1, size=20).offset == 0


def test_cursor_limit_shares_the_page_size_ceiling() -> None:
    assert (DEFAULT_CURSOR_LIMIT, MAX_PAGE_SIZE) == (100, 200)


def test_cursor_page_carries_no_total() -> None:
    # ⚠ 时序集合算一次区间计数要全表扫，契约里就不该有这个字段
    page = CursorPage[str](items=["a"], next=ANCHOR_CURSOR, has_more=True)
    assert set(page.model_dump()) == {"items", "next", "has_more"}


def test_page_still_carries_a_total() -> None:
    page = Page[str](items=[], page=1, size=20, total=0)
    assert page.model_dump() == {
        "items": [],
        "page": 1,
        "size": 20,
        "total": 0,
    }


def test_encode_cursor_is_url_safe_base64_of_compact_json() -> None:
    assert encode_cursor(ANCHOR) == ANCHOR_CURSOR


def test_decode_cursor_reads_back_what_encode_wrote() -> None:
    assert decode_cursor(ANCHOR_CURSOR) == ANCHOR


def test_decode_cursor_accepts_an_empty_anchor() -> None:
    assert decode_cursor("e30=") == {}


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "!!!",
        "中文",
        "bm90IGpzb24gYXQgYWxs",
        "WzEsIDJd",
        "eyJ0cyI6IDF9",
        "eyJ0cyI6ICJ4IiwgIm4iOiBudWxsfQ==",
    ],
    ids=[
        "empty",
        "not-base64",
        "not-ascii",
        "not-json",
        "json-array",
        "number-value",
        "null-value",
    ],
)
def test_decode_cursor_rejects_anything_malformed(raw: str) -> None:
    # ⚠ 游标是客户端能随手改的入参，漏一条解析路径就是一个 500
    with pytest.raises(ValidationFailed):
        decode_cursor(raw)


def test_rejected_cursor_points_at_the_after_parameter() -> None:
    with pytest.raises(ValidationFailed) as caught:
        decode_cursor("!!!")
    assert [(item.field, item.code) for item in caught.value.details] == [
        ("after", "invalid_cursor")
    ]
    assert caught.value.http_status == 400
