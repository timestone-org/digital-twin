"""原件 media type 那张表，以及「哪些类型可以当场摊开」的白名单。

⚠ 这几条盯的是两类静默故障：查不到类型时预览面整个走成「下载」，
以及把用户传上来的 HTML 以 inline 摊在本站域名下（存储型 XSS）。
"""

from knowledge_server.apps.knowledge.services.media_types import (
    FALLBACK_MEDIA_TYPE,
    is_inline_safe,
    media_type_of,
)
from knowledge_server.apps.knowledge.services.parsing import (
    PARSERS,
    MineruBackend,
    accepted_suffixes,
)


def test_every_accepted_suffix_has_a_media_type() -> None:
    """⚠ 收得进来、却查不到类型的后缀会让预览面一律走「下载」档，
    而两边单看都对：解析那边确实收它，表这边确实没它。"""
    external = (MineruBackend(base_url="http://mineru"),)
    for suffix in accepted_suffixes(external, PARSERS):
        assert media_type_of(suffix) != FALLBACK_MEDIA_TYPE, suffix


def test_an_unknown_suffix_falls_back_instead_of_guessing() -> None:
    """⚠ 猜错的代价是浏览器按错的类型渲染；如实给通用类型只是让界面
    走到「这个格式看不了」那一档。"""
    assert media_type_of(".zip") == FALLBACK_MEDIA_TYPE
    assert media_type_of("") == FALLBACK_MEDIA_TYPE


def test_the_suffix_is_matched_case_insensitively() -> None:
    assert media_type_of(".PDF") == "application/pdf"


def test_html_is_never_inline() -> None:
    """⚠ 这一条是安全边界，不是风格：把用户传上来的 HTML 以 inline 摊在本站
    域名下，那份 HTML 里的脚本就跑在本站源上——一次上传就是一次存储型 XSS。"""
    assert not is_inline_safe(media_type_of(".html"))
    assert not is_inline_safe(media_type_of(".htm"))


def test_office_formats_are_never_inline() -> None:
    """浏览器对它们只会弹下载，声明成 inline 只是让文件名那一格失效。"""
    for suffix in (".docx", ".xlsx", ".xlsm", ".pptx"):
        assert not is_inline_safe(media_type_of(suffix)), suffix


def test_pdf_text_and_images_are_inline() -> None:
    for suffix in (".pdf", ".png", ".jpg", ".jpeg", ".txt", ".md", ".json"):
        assert is_inline_safe(media_type_of(suffix)), suffix


def test_a_charset_parameter_does_not_break_the_whitelist() -> None:
    """⚠ 连着参数一起比的话白名单每一条都要写两遍，而漏写的那一条会安静地
    掉进「下载」档。"""
    assert is_inline_safe("text/plain; charset=utf-8")
    assert is_inline_safe("TEXT/PLAIN")
