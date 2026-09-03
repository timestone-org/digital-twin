"""知识库那一路工具：列库、检索、看整块。全部只读，出处三样一个不少。"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import pytest

from knowledge_server.apps.chat.services.scope import (
    ALL_BASES,
    BaseOutOfScope,
    BaseScope,
    ScopeBase,
)
from knowledge_server.apps.chat.services.tools import ToolDeps, build_registry
from knowledge_server.apps.chat.services.tools.client import ASK_TOOL
from knowledge_server.apps.chat.services.tools.knowledge import (
    LIST_BASES,
    READ_CHUNK,
    SEARCH,
    KnowledgeTools,
)
from llmcore.tools.ports import RunsElsewhere, UnknownTool


@dataclass
class _Session:
    """不连库的假会话：这一层的用例只验入参与出参的形状。"""

    async def execute(self, *_a: Any, **_k: Any) -> Any:
        raise AssertionError("这条用例不该碰库")


@asynccontextmanager
async def _sessions() -> AsyncIterator[_Session]:
    yield _Session()


def _tools(scope: BaseScope = ALL_BASES) -> KnowledgeTools:
    return KnowledgeTools(sessions=_sessions, strategies=(), scope=scope)


def _scope(*base_ids: uuid.UUID) -> BaseScope:
    return BaseScope(
        bases=tuple(
            ScopeBase(base_id=one, name=f"库{index}", is_missing=False)
            for index, one in enumerate(base_ids)
        )
    )


def test_the_registry_offers_three_read_tools_and_one_ask() -> None:
    """⚠ 顺序是契约：知识库那一路在前，客户端那一路在后。"""
    made = build_registry(
        ToolDeps(sessions=_sessions, strategies=(), scope=ALL_BASES)
    )

    assert [one.name for one in made.specs] == [
        LIST_BASES,
        SEARCH,
        READ_CHUNK,
        ASK_TOOL,
    ]


def test_every_knowledge_tool_is_read_only_by_name() -> None:
    """⚠ 一期不给写工具：让模型能改库里的东西没有撤销栈。"""
    names = [one.name for one in _tools().specs()]

    assert all(
        not any(verb in name for verb in ("write", "delete", "create", "sync"))
        for name in names
    )


async def test_the_ask_tool_never_runs_on_the_server() -> None:
    """⚠ 静默成功会让模型以为问过了，按它自己猜的选项答。"""
    made = build_registry(
        ToolDeps(sessions=_sessions, strategies=(), scope=ALL_BASES)
    )

    with pytest.raises(RunsElsewhere):
        await made.run(ASK_TOOL, {"question": "哪台", "options": []})


async def test_an_unknown_tool_name_is_refused() -> None:
    with pytest.raises(UnknownTool):
        await _tools().run("kb.delete_everything", {})


async def test_search_requires_a_real_uuid_for_the_base() -> None:
    """⚠ 模型凭印象填的库 id 要在这里被拒，而不是打到库上变成 500。"""
    with pytest.raises(UnknownTool, match="base_id"):
        await _tools().run(SEARCH, {"base_id": "不是id", "query": "锅炉"})


async def test_search_requires_a_query() -> None:
    with pytest.raises(UnknownTool, match="query"):
        await _tools().run(
            SEARCH, {"base_id": str(uuid.uuid4()), "query": "   "}
        )


async def test_read_chunk_requires_a_real_uuid() -> None:
    with pytest.raises(UnknownTool, match="chunk_id"):
        await _tools().run(READ_CHUNK, {"chunk_id": "c1"})


async def test_search_outside_the_scope_is_refused_before_touching_the_db() -> (
    None
):
    """⚠ 抛而不是回空表：空表与「这个库里确实没这句话」长得一模一样。

    假会话一碰就抛，所以这条同时钉住「拦在开事务之前」。
    """
    inside = uuid.uuid4()
    outside = uuid.uuid4()

    with pytest.raises(BaseOutOfScope, match="范围"):
        await _tools(_scope(inside)).run(
            SEARCH, {"base_id": str(outside), "query": "锅炉"}
        )


async def test_search_inside_the_scope_gets_through_to_the_db() -> None:
    """范围里的库照常放行——拦截不许顺手把合法的那条也拦了。"""
    inside = uuid.uuid4()

    with pytest.raises(AssertionError, match="不该碰库"):
        await _tools(_scope(inside)).run(
            SEARCH, {"base_id": str(inside), "query": "锅炉"}
        )


async def test_the_default_scope_lets_every_base_through() -> None:
    """不限库时任何一个 id 都过得去。"""
    with pytest.raises(AssertionError, match="不该碰库"):
        await _tools().run(
            SEARCH, {"base_id": str(uuid.uuid4()), "query": "锅炉"}
        )


def test_a_missing_base_stays_in_the_scope() -> None:
    """⚠ 库被删了也留在范围里：抹掉等于替用户把边界改宽。"""
    gone = uuid.uuid4()
    scope = BaseScope(
        bases=(ScopeBase(base_id=gone, name="", is_missing=True),)
    )

    assert scope.allows(gone)
    assert scope.ids() == (gone,)
