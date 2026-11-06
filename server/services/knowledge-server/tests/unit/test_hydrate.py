"""召回补全：落库的定位 JSON 还原成带出处的 Hit。"""

import json
import uuid
from collections.abc import Sequence
from dataclasses import asdict
from types import SimpleNamespace
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge import crud
from knowledge_server.apps.knowledge.services.parsing import Locator
from knowledge_server.apps.knowledge.services.retrieval.hydrate import hydrated
from knowledge_server.apps.knowledge.services.retrieval.ports import Fused

CHUNK = uuid.UUID("00000000-0000-7000-8000-000000000001")


class _NoTitles:
    """标题查询的替身：这条用例只看定位。"""

    async def execute(self, statement: object) -> SimpleNamespace:
        del statement
        return SimpleNamespace(all=list[tuple[uuid.UUID, str]])


async def test_a_chunk_spanning_pages_keeps_its_last_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 只报起页的引用会让人翻到第 4 页却找不到那句话。"""
    stored = json.loads(json.dumps(asdict(Locator(page=4, page_end=6))))

    async def chunks(
        session: object, ids: Sequence[uuid.UUID]
    ) -> list[SimpleNamespace]:
        del session, ids
        return [
            SimpleNamespace(
                id=CHUNK,
                document_id=uuid.uuid4(),
                text="正文",
                heading_path="",
                locator_json=stored,
            )
        ]

    monkeypatch.setattr(crud.chunk, "chunks_by_ids", chunks)

    hits = await hydrated(
        cast("AsyncSession", _NoTitles()),
        [Fused(chunk_id=CHUNK, score=1.0, reasons=())],
        limit=1,
    )

    assert hits[0].locator.page_end == 6
    assert hits[0].locator.label() == "第 4–6 页"
