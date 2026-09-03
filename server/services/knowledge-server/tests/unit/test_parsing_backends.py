"""解析后端分两路：本地库解与外部服务解（ADR-0043）。

⚠ 一期外部那一路**一个实现都没有**，所以这里的外部后端全是用例里的假件。
它们同时也是那份端口的样板：将来接 MinerU 就是照这个形状写一个真的。
"""

from dataclasses import dataclass, field

import pytest

from knowledge_server.apps.knowledge.services.parsing import (
    PARSERS,
    Block,
    DocumentParser,
    ExternalParseFailed,
    ExternalParserBackend,
    Locator,
    ParsedDocument,
    ParserBackend,
    RawItem,
    accepted_suffixes,
    external_for,
)
from knowledge_server.apps.knowledge.services.parsing.text import TextParser


@dataclass(frozen=True)
class FakeRemote:
    """一个假的外部解析后端：把原件的文件名当一块交回去。"""

    name: str = "fake-remote"
    suffixes: tuple[str, ...] = (".pdf",)
    media_types: tuple[str, ...] = ("application/pdf",)
    blocks: tuple[Block, ...] = field(default_factory=tuple)

    async def parse_remote(
        self, raw: RawItem, timeout_s: float
    ) -> ParsedDocument:
        """把上游的产出翻成带 locator 的块序列。

        Args: raw, timeout_s。
        """
        assert timeout_s > 0
        return ParsedDocument(
            title=raw.filename,
            blocks=self.blocks
            or (
                Block(
                    kind="paragraph",
                    text=raw.filename,
                    locator=Locator(page=1),
                ),
            ),
        )


def _raw(name: str, media_type: str = "") -> RawItem:
    return RawItem(filename=name, media_type=media_type, content=b"body")


def test_nothing_is_picked_when_no_external_backend_is_configured() -> None:
    """⚠ 没接就是**诚实缺席**：整条链路与「没有这一层」逐字相同，
    而缺席能被 /capabilities 如实答出来。"""
    assert external_for(_raw("图纸.pdf"), ()) is None


def test_a_configured_external_backend_is_picked_by_suffix() -> None:
    picked = external_for(_raw("图纸.pdf"), (FakeRemote(),))
    assert picked is not None
    assert picked.name == "fake-remote"


def test_media_type_is_only_the_external_fallback() -> None:
    """⚠ 与本地那一路同一条规矩：外部系统拉回来的条目常常没有像样的文件名。"""
    assert external_for(_raw("没有后缀"), (FakeRemote(),)) is None
    picked = external_for(_raw("没有后缀", "application/pdf"), (FakeRemote(),))
    assert picked is not None


def test_an_external_backend_that_claims_nothing_is_never_picked() -> None:
    empty = FakeRemote(name="空", suffixes=(), media_types=())
    assert external_for(_raw("图纸.pdf"), (empty,)) is None


def test_the_accept_list_covers_both_lanes() -> None:
    """⚠ 接了一路能吃 PDF 的外部后端之后，界面必须当场收 PDF——否则那一路
    接了也用不上，而界面上看不出任何异常。"""
    names = accepted_suffixes(PARSERS, (FakeRemote(),))
    assert ".pdf" in names
    assert ".docx" in names


def test_the_accept_list_never_repeats_a_suffix() -> None:
    """⚠ 两路都声明 `.docx` 时 accept 名单里出现两遍——名单是直接下发给
    浏览器的，重复项没有意义。"""
    overlap = FakeRemote(name="重叠", suffixes=(".docx", ".pdf"))
    names = accepted_suffixes(PARSERS, (overlap,))
    assert len(names) == len(set(names))


def test_pdf_stays_absent_while_no_external_backend_is_connected() -> None:
    """⚠ 本地那几路一个都不吃 PDF：收 PDF 这件事完全靠外部后端，
    没接的时候传 PDF 的人拿到的是一句点得出名字的错。"""
    assert ".pdf" not in accepted_suffixes(())


def test_both_lanes_satisfy_the_shared_backend_protocol() -> None:
    for one in (*PARSERS, FakeRemote()):
        assert isinstance(one, ParserBackend), one


def test_the_two_lanes_are_not_interchangeable() -> None:
    """⚠ 两条口径故意不是同一个函数签名：混成一个的话，把外部后端当本地的
    调用会拿到一个没 await 的协程当 `ParsedDocument` 用，而那不报错。"""
    assert not isinstance(TextParser(), ExternalParserBackend)
    assert not isinstance(FakeRemote(), DocumentParser)


async def test_an_external_backend_must_produce_located_blocks() -> None:
    """⚠ 外部服务回的是 markdown + 版面 JSON，翻成带 `locator` 的块序列这一步
    由那一路后端自己做完——放宽成一坨字符串的话，「换一个后端」就会连着改
    切块层，而引用也指不出出处了。"""
    made = await FakeRemote().parse_remote(_raw("图纸.pdf"), 1.0)
    assert made.blocks[0].locator.page == 1


def test_the_external_failure_type_is_part_of_the_port() -> None:
    """⚠ 实现必须把上游的任何失败翻成这一个异常：漏出 http 客户端的异常，
    摄取管线就要认得每一种客户端库的异常类型。"""
    with pytest.raises(ExternalParseFailed):
        raise ExternalParseFailed("上游 502")
