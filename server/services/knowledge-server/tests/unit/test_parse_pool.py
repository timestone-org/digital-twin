"""解析进程池：一份解不动的文档超时之后，池子要换新的，后面的文档照常解。

⚠ 不换的话，超时只是不再等它，子进程仍在跑那一份；单工池里排在后面的每一份
都在队里耗光自己的超时，被记成「解析超时」，而它们本来是好好的。
"""

import time

import pytest

from knowledge_server.apps.knowledge.services.embedding import NullEmbedder
from knowledge_server.apps.knowledge.services.indexing import build_indexes
from knowledge_server.apps.knowledge.services.ingest_pipeline import (
    IngestDeps,
    IngestFailed,
    _parsed_locally,
)
from knowledge_server.apps.knowledge.services.parse_pool import RecyclingPool
from knowledge_server.apps.knowledge.services.parsing import RawItem

# 被卡住的那一份要跑多久。⚠ 远长于下面那一份的超时：池子没换的话后者必然超时
_STUCK_S = 60.0


def _deps(pool: RecyclingPool, timeout_s: float) -> IngestDeps:
    return IngestDeps(
        sources=(),
        embedder=NullEmbedder(),
        indexes=build_indexes(4),
        pool=pool,
        store=None,
        parse_timeout_s=timeout_s,
    )


def _markdown() -> RawItem:
    return RawItem(
        filename="手册.md",
        media_type="text/markdown",
        content="# 冷却水\n出口温度不得高于 65 ℃".encode(),
    )


async def test_a_timed_out_parse_does_not_starve_the_next_one() -> None:
    pool = RecyclingPool()
    try:
        pool.submit(time.sleep, _STUCK_S)
        with pytest.raises(IngestFailed, match="解析超时"):
            await _parsed_locally(_deps(pool, 0.5), _markdown())

        made = await _parsed_locally(_deps(pool, 30.0), _markdown())

        assert made.blocks
    finally:
        pool.shutdown(wait=False, cancel_futures=True)


def test_recycling_kills_the_process_that_was_stuck() -> None:
    pool = RecyclingPool()
    try:
        stuck = pool.submit(time.sleep, _STUCK_S)
        started = time.monotonic()
        while not stuck.running() and time.monotonic() - started < 30:
            time.sleep(0.05)

        pool.recycle()

        assert pool.submit(abs, -1).result(timeout=30) == 1
    finally:
        pool.shutdown(wait=False, cancel_futures=True)
