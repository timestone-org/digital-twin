"""摄取管线挑哪一路后端解析，以及两条口径各自的失败怎么翻。

⚠ 两支的口径不同：本地那一路进进程池（阻塞、吃 CPU），外部那一路是网络 IO
（要有自己的超时、绝不自动重试）。这一组钉的就是这条分界（ADR-0043）。
"""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import pytest

from knowledge_server.apps.knowledge.services.embedding import NullEmbedder
from knowledge_server.apps.knowledge.services.indexing import (
    BruteForceIndex,
    IndexPair,
    LikeKeywordIndex,
)
from knowledge_server.apps.knowledge.services.ingest_pipeline import (
    IngestDeps,
    IngestFailed,
    _parsed,
)
from knowledge_server.apps.knowledge.services.parsing import (
    Block,
    ExternalParseFailed,
    ExternalParserBackend,
    Locator,
    ParsedDocument,
    RawItem,
)


@dataclass(frozen=True)
class _Remote:
    """一个假的外部后端；`fails` 决定它这次怎么坏。"""

    name: str = "fake-remote"
    suffixes: tuple[str, ...] = (".pdf",)
    media_types: tuple[str, ...] = ("application/pdf",)
    fails: str = ""

    async def parse_remote(
        self, raw: RawItem, timeout_s: float
    ) -> ParsedDocument:
        """按 `fails` 决定这次给什么。

        Args: raw, timeout_s。
        """
        if self.fails == "hangs":
            # ⚠ 故意不守约：端口要求实现自己守 timeout_s，管线外面那一层是兜底
            await asyncio.sleep(timeout_s * 100)
        if self.fails == "upstream":
            raise ExternalParseFailed("外部解析服务回了 502")
        return ParsedDocument(
            title=raw.filename,
            blocks=(
                Block(
                    kind="paragraph",
                    text="外部解出来的",
                    locator=Locator(page=1),
                ),
            ),
        )


def _deps(
    pool: ThreadPoolExecutor,
    external: tuple[ExternalParserBackend, ...] = (),
    external_timeout_s: float = 30.0,
) -> IngestDeps:
    return IngestDeps(
        sources=(),
        embedder=NullEmbedder(),
        indexes=IndexPair(vector=BruteForceIndex(), keyword=LikeKeywordIndex()),
        pool=pool,
        parse_timeout_s=30.0,
        external_parsers=external,
        external_parse_timeout_s=external_timeout_s,
    )


@pytest.fixture
def pool() -> ThreadPoolExecutor:
    # ⚠ 用线程池只是因为这一组不验「进程池」那件事；生产那一路仍是进程池
    with ThreadPoolExecutor(max_workers=1) as made:
        yield made


async def test_the_local_lane_runs_when_nothing_external_is_connected(
    pool: ThreadPoolExecutor,
) -> None:
    raw = RawItem(filename="手册.md", media_type="", content=b"# a\n\nbody\n")
    made = await _parsed(_deps(pool), raw)
    assert made.blocks[0].kind == "heading"


async def test_an_unknown_format_fails_by_name(
    pool: ThreadPoolExecutor,
) -> None:
    """⚠ 静默给空的表现是「传上去了、状态 ready、检索却查不到」。"""
    raw = RawItem(filename="图纸.pdf", media_type="", content=b"%PDF")
    with pytest.raises(IngestFailed, match=r"图纸\.pdf"):
        await _parsed(_deps(pool), raw)


async def test_a_connected_external_backend_takes_the_format_over(
    pool: ThreadPoolExecutor,
) -> None:
    """⚠ 接一路外部解析服务的动机就是让它接管它更擅长的那几种格式；接了却
    不生效等于白接。"""
    raw = RawItem(filename="图纸.pdf", media_type="", content=b"%PDF")
    made = await _parsed(_deps(pool, (_Remote(),)), raw)
    assert made.blocks[0].text == "外部解出来的"


async def test_a_hung_external_backend_becomes_a_failed_document(
    pool: ThreadPoolExecutor,
) -> None:
    """⚠ 没有超时的跨进程调用会把这条消费循环永久占住，而现象是「队列不动
    了」，看不出是哪一份文档导致的。"""
    raw = RawItem(filename="图纸.pdf", media_type="", content=b"%PDF")
    deps = _deps(pool, (_Remote(fails="hangs"),), external_timeout_s=0.05)
    with pytest.raises(IngestFailed, match="fake-remote"):
        await _parsed(deps, raw)


async def test_an_upstream_error_becomes_a_failed_document(
    pool: ThreadPoolExecutor,
) -> None:
    """⚠ 翻成 `IngestFailed` 即「重试没有意义」：摄取那条链不自动重试，
    由人按「重新解析」。"""
    raw = RawItem(filename="图纸.pdf", media_type="", content=b"%PDF")
    deps = _deps(pool, (_Remote(fails="upstream"),))
    with pytest.raises(IngestFailed, match="502"):
        await _parsed(deps, raw)


async def test_the_external_backend_is_skipped_for_formats_it_declines(
    pool: ThreadPoolExecutor,
) -> None:
    raw = RawItem(filename="手册.md", media_type="", content=b"# a\n")
    made = await _parsed(_deps(pool, (_Remote(),)), raw)
    assert made.blocks[0].kind == "heading"
