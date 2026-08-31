"""解码器注册表与图片白名单。

守的是两件事：**加一种格式只该是加一个文件加一行**（不是改函数体），
以及**图的白名单按字节判**——按后缀判的话，把 `evil.svg` 改名成 `photo.png`
就能把一段能内嵌脚本的东西送进界面的缩略图里。
"""

import base64
from dataclasses import dataclass

import pytest

from ai_assistant.apps.chat.services.perception import (
    AsImage,
    AsText,
    Decoded,
    InputDecoder,
    UnsupportedInput,
    accepted_suffixes,
    decode,
    decoder_for,
)
from ai_assistant.apps.chat.services.perception.decoders.image import (
    ImageDecoder,
    check_data_uri,
)
from ai_assistant.settings import MAX_IMAGE_CHARS

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 32
WEBP = b"RIFF" + b"0000" + b"WEBP" + b"0" * 32
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'


def _uri(raw: bytes, declared: str = "image/png") -> str:
    return f"data:{declared};base64,{base64.b64encode(raw).decode('ascii')}"


@dataclass(frozen=True)
class _FakeDecoder:
    """一路假解码器，用来证明「加一路」真的只是加一个对象。"""

    @property
    def name(self) -> str:
        return "fake"

    @property
    def suffixes(self) -> tuple[str, ...]:
        return (".zzz",)

    @property
    def media_types(self) -> tuple[str, ...]:
        return ()

    def decode(self, raw: bytes, _filename: str) -> Decoded:
        return AsText(text=raw.decode(), is_truncated=False, summary="假的")


def test_a_new_format_needs_no_change_to_any_function_body() -> None:
    """加一路 = 造一个对象塞进注册元组，调用方一个字不动。"""
    decoders: tuple[InputDecoder, ...] = (_FakeDecoder(),)
    got = decode("说明.zzz", "内容".encode(), decoders)
    assert isinstance(got, AsText)
    assert got.text == "内容"


def test_the_accept_list_comes_from_the_registry() -> None:
    """界面那份 accept 名单由注册表算出来，不许再手抄一份。"""
    listed = accepted_suffixes()
    assert ".csv" in listed
    assert ".png" in listed
    # 名单没有的东西一律不下发，否则用户选得中却传不上去
    assert ".svg" not in listed


def test_an_unknown_suffix_says_what_is_accepted() -> None:
    """认不出时要说清收什么——只说「不支持」会让人反复换格式重试。"""
    with pytest.raises(UnsupportedInput, match="认不出"):
        decoder_for("手册.pdf")


def test_a_csv_still_reads_as_a_pipe_table() -> None:
    """走注册表之后，表格那一路的产出不变。"""
    got = decode("点表.csv", b"code,name\na,b\n")
    assert isinstance(got, AsText)
    assert got.text.splitlines()[0] == "code | name"
    assert got.summary == "2 列 × 1 行"


@pytest.mark.parametrize(
    ("raw", "media_type"),
    [(PNG, "image/png"), (JPEG, "image/jpeg"), (WEBP, "image/webp")],
)
def test_the_three_accepted_images_come_through(
    raw: bytes, media_type: str
) -> None:
    """三种收，且 media type 按字节认出来而不是照抄后缀。"""
    got = ImageDecoder().decode(raw, "现场.png")
    assert isinstance(got, AsImage)
    assert got.media_type == media_type


def test_an_svg_is_refused_and_says_why() -> None:
    """SVG 能内嵌脚本，而它要在界面上渲染——拒了还要说清为什么。"""
    with pytest.raises(UnsupportedInput, match="SVG"):
        ImageDecoder().decode(SVG, "图标.svg")


def test_renaming_an_svg_to_png_does_not_get_it_through() -> None:
    """⚠ 判的是字节不是后缀：后缀是调用方说了算的。"""
    with pytest.raises(UnsupportedInput, match="SVG"):
        ImageDecoder().decode(SVG, "photo.png")


def test_an_oversized_image_says_how_much_over() -> None:
    """只说「太大了」用户不知道要缩多少。"""
    huge = b"\x89PNG\r\n\x1a\n" + b"0" * MAX_IMAGE_CHARS
    with pytest.raises(UnsupportedInput, match="KB"):
        ImageDecoder().decode(huge, "现场.png")


def test_a_data_uri_is_judged_by_its_bytes_not_its_declared_type() -> None:
    """声明成 png 再塞一段 svg 是一句话的事，所以声明一个字都不能信。"""
    with pytest.raises(UnsupportedInput, match="SVG"):
        check_data_uri(_uri(SVG, "image/png"), "第 1 张图")


def test_a_data_uri_that_is_not_base64_is_refused() -> None:
    with pytest.raises(UnsupportedInput, match="data URI"):
        check_data_uri("https://example.com/a.png", "第 1 张图")


def test_a_good_data_uri_reports_its_real_media_type() -> None:
    assert check_data_uri(_uri(JPEG), "第 1 张图") == "image/jpeg"
