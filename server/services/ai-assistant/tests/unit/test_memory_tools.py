"""长期记忆那一路工具（ADR-0030）。

守的是三件事：归属者**只能**来自签名身份头（模型自报一个别人的就能读到别人记的
东西）、没接嵌入档时如实说「记住了但暂时检索不到」而不是假装成功、以及没接上
仓储时抛一句点得出名字的错。
"""

from dataclasses import dataclass, field

import pytest

from ai_assistant.apps.chat.services.memory.ports import (
    Hit,
    Knowledge,
    Scope,
)
from ai_assistant.apps.chat.services.tools.ports import UnknownTool
from ai_assistant.apps.chat.services.tools.providers.memory import (
    MAX_LIMIT,
    MemoryTools,
)
from lib.auth.edge_headers import HEADER_USER_ID

OWNER = "11111111-1111-4111-8111-111111111111"


@dataclass
class FakeStore:
    """记在内存里的一路仓储，按 `(scope, owner)` 分格。"""

    can_rank: bool = True
    written: list[Knowledge] = field(default_factory=list[Knowledge])
    asked: list[tuple[str, str, str, int]] = field(
        default_factory=list[tuple[str, str, str, int]]
    )

    async def remember(self, item: Knowledge) -> str:
        self.written.append(item)
        return f"id-{len(self.written)}"

    async def search(
        self, query: str, scope: Scope, owner_id: str, limit: int
    ) -> list[Hit]:
        self.asked.append((query, scope, owner_id, limit))
        if not self.can_rank:
            return []
        return [
            Hit(
                id="k1",
                title="口径",
                body="1 号机组",
                score=0.9,
                has_vector=True,
            )
        ]


def _tools(
    store: FakeStore | None, *, owner: str | None = OWNER
) -> MemoryTools:
    headers = {} if owner is None else {HEADER_USER_ID: owner}
    return MemoryTools(store=store, headers=headers)


async def test_the_owner_comes_from_the_signed_header_not_the_arguments() -> (
    None
):
    """模型自报一个别人的归属者就能读到别人记的东西——所以入参里根本没这一格。"""
    store = FakeStore()
    await _tools(store).run(
        "memory.remember",
        {"title": "口径", "body": "正文", "owner_id": "someone-else"},
    )
    assert store.written[0].owner_id == OWNER


async def test_a_request_without_an_identity_header_is_refused() -> None:
    """回落成空串的话，所有没身份的请求会共用同一格记忆、互相读得到。"""
    with pytest.raises(UnknownTool, match="身份头"):
        await _tools(FakeStore(), owner=None).run(
            "memory.remember", {"title": "口径", "body": "正文"}
        )


async def test_searching_filters_by_the_callers_own_owner_id() -> None:
    """检索的归属者同样只能来自身份头，不能来自入参。"""
    store = FakeStore()
    await _tools(store).run("memory.search", {"query": "机组"})
    assert store.asked[0][2] == OWNER


async def test_remembering_without_an_embedder_says_it_is_not_searchable() -> (
    None
):
    """假装成功的话，用户以为记住了、下次却怎么也查不到。"""
    got = await _tools(FakeStore(can_rank=False)).run(
        "memory.remember", {"title": "口径", "body": "正文"}
    )
    assert isinstance(got, dict)
    assert got["is_searchable"] is False
    assert "检索不到" in str(got["note"])


async def test_remembering_with_an_embedder_says_it_is_searchable() -> None:
    """接上了就该如实说接上了，否则模型会一直转告一句过时的告警。"""
    got = await _tools(FakeStore(can_rank=True)).run(
        "memory.remember", {"title": "口径", "body": "正文"}
    )
    assert isinstance(got, dict)
    assert got["is_searchable"] is True


async def test_an_empty_search_says_why_instead_of_looking_like_nothing() -> (
    None
):
    """「查不到」与「没记过」是两件事，不说清模型会当成用户从没交代过。"""
    got = await _tools(FakeStore(can_rank=False)).run(
        "memory.search", {"query": "机组"}
    )
    assert isinstance(got, dict)
    assert got["hits"] == []
    assert "没接嵌入档" in str(got["note"])


async def test_the_limit_is_clamped_instead_of_trusted() -> None:
    """模型给一个大数就把整张表拖回来，而那只表现为「这次查得有点慢」。"""
    store = FakeStore()
    await _tools(store).run("memory.search", {"query": "机组", "limit": 999})
    assert store.asked[0][3] == MAX_LIMIT


async def test_a_missing_store_names_itself_instead_of_failing_vaguely() -> (
    None
):
    """没接上仓储时要点得出名字，否则它与「模型编了个工具名」混成一档。"""
    with pytest.raises(UnknownTool, match="仓储"):
        await _tools(None).run("memory.search", {"query": "机组"})


async def test_an_unknown_name_is_refused() -> None:
    """认不出就抛，不返回一个看起来正常的空结果。"""
    with pytest.raises(UnknownTool):
        await _tools(FakeStore()).run("memory.forget", {})
