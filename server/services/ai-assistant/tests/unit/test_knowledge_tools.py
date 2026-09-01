"""知识库那一路工具：只读、转发身份头、note 原样带出来。"""

from typing import Any

import pytest

from ai_assistant.apps.chat.services.tools.ports import UnknownTool
from ai_assistant.apps.chat.services.tools.providers.knowledge import (
    KNOWLEDGE_SPECS,
    MAX_SNIPPET_CHARS,
    KnowledgeTools,
)


class _Client:
    def __init__(self, answer: object) -> None:
        self._answer = answer
        self.seen: list[tuple[str, dict[str, str], object]] = []

    async def list_bases(self, headers: dict[str, str]) -> object:
        self.seen.append(("list", headers, None))
        return self._answer

    async def search(
        self, headers: dict[str, str], base_id: str, body: dict[str, Any]
    ) -> object:
        self.seen.append(("search", headers, (base_id, body)))
        return self._answer


def _tools(
    answer: object, headers: dict[str, str] | None = None
) -> KnowledgeTools:
    return KnowledgeTools(
        client=_Client(answer),  # pyright: ignore[reportArgumentType]
        headers=headers or {},
    )


async def test_no_knowledge_deployment_raises_by_name() -> None:
    """⚠ 规格照样进表（不然两份清单会漂开），而调用时要报一句点得出名字的错。"""
    with pytest.raises(UnknownTool, match="没有接知识库"):
        await KnowledgeTools().run("knowledge.list_bases", {})


async def test_an_unknown_tool_name_raises() -> None:
    with pytest.raises(UnknownTool):
        await _tools({}).run("knowledge.delete_everything", {})


async def test_listing_bases_keeps_only_what_the_model_needs() -> None:
    made = await _tools({"items": [{"id": "1", "name": "手册库"}]}).run(
        "knowledge.list_bases", {}
    )
    assert made["bases"] == [
        {
            "id": "1",
            "name": "手册库",
            "description": "",
            "document_count": 0,
        }
    ]


async def test_the_identity_headers_go_upstream() -> None:
    """⚠ 不转发的话上游按匿名判权限，而助手就成了越权通道。"""
    tools = _tools({"items": []}, {"X-Auth-Sig": "abc"})
    await tools.run("knowledge.list_bases", {})
    client = tools.client
    assert client is not None
    assert client.seen[0][1] == {
        "X-Auth-Sig": "abc"
    }  # pyright: ignore[reportAttributeAccessIssue]


async def test_search_passes_the_query_through() -> None:
    tools = _tools({"hits": [], "strategy": "hybrid", "note": ""})
    await tools.run(
        "knowledge.search", {"base_id": "1", "query": "出口温度", "limit": 3}
    )
    client = tools.client
    assert client is not None
    _kind, _headers, sent = client.seen[
        0
    ]  # pyright: ignore[reportAttributeAccessIssue]
    assert sent == ("1", {"query": "出口温度", "limit": 3})


async def test_a_missing_argument_raises_instead_of_guessing() -> None:
    with pytest.raises(UnknownTool, match="base_id"):
        await _tools({}).run("knowledge.search", {"query": "甲"})


async def test_the_note_reaches_the_model() -> None:
    """⚠ 「这套部署没接嵌入档，本次只走了关键词那一路」这类话必须传到模型眼前，
    否则它会把一次退化的召回当成全部事实。"""
    made = await _tools(
        {"hits": [], "strategy": "hybrid", "note": "只走了关键词那一路"}
    ).run("knowledge.search", {"base_id": "1", "query": "甲"})
    assert made["note"] == "只走了关键词那一路"


async def test_a_long_snippet_is_trimmed() -> None:
    """⚠ 一次检索十条整块正文能把工作面快照与技能正文整个挤出上下文，
    而挤掉了哪一段从外面完全看不出来。"""
    made = await _tools(
        {
            "hits": [
                {
                    "chunk_id": "c",
                    "document_title": "手册",
                    "text": "字" * (MAX_SNIPPET_CHARS + 500),
                    "locator": {"label": "第 12 页"},
                }
            ]
        }
    ).run("knowledge.search", {"base_id": "1", "query": "甲"})
    assert len(made["hits"][0]["text"]) == MAX_SNIPPET_CHARS
    assert made["hits"][0]["locator"] == "第 12 页"


async def test_an_unreadable_answer_never_looks_like_no_results() -> None:
    """⚠ 把「读不懂的回包」读成「没有结果」，助手会当着用户的面说库里没有。"""
    made = await _tools("这不是一个对象").run(
        "knowledge.search", {"base_id": "1", "query": "甲"}
    )
    assert made["hits"] == []
    assert made["note"]


def test_every_spec_is_read_only_and_runs_on_the_server() -> None:
    """⚠ 助手能动的东西越少，它被当成越权通道的可能就越小。"""
    assert {spec.runs_on for spec in KNOWLEDGE_SPECS} == {"server"}
    assert {spec.name for spec in KNOWLEDGE_SPECS} == {
        "knowledge.list_bases",
        "knowledge.search",
    }
