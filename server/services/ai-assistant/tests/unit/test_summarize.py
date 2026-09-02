"""窗口外那一截怎么折，以及折出来的那段什么时候许重折。

守的是两件互相拉扯的事。一是**别把结论丢了**：跑了几十轮的会话，最早那几十条
里查到的点位与定下的口径不该凭空消失。二是**别把前缀缓存打光**：摘要排在历史区
前面，同一个台阶内它必须逐字不变，否则它就是 ADR-0025 之外的第五个断点——
而断点没有任何运行期迹象，只有账单和延迟会慢慢变难看。

还守一条降级：折不出来时回合照常走完。让一个本来能跑完的回合因为摘要没折成
就发不出去，是这里最坏的一种错法。
"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, cast

import pytest
from langchain_core.messages import AIMessage
from openai import APIConnectionError

from ai_assistant.apps.chat.models import ChatMessage
from ai_assistant.apps.chat.services.advance_service import (
    AdvanceDeps,
    LoadedContext,
    _summary_of,
)
from ai_assistant.llm import GuardedModel, ModelChoice
from ai_assistant.settings import MAX_HISTORY_MESSAGES
from lib.resilience import CircuitBreaker
from llmcore.memory import Summary, history, summarize
from unit.llm_fakes import ScriptedChat
from unit.summarize_fakes import RecordingSession, RecordingSummarizer

STAMP = "default:summary"


def _row(role: str, text: str, seq: int) -> ChatMessage:
    return ChatMessage(
        session_id=uuid.uuid4(), seq=seq, role=role, content_json={"text": text}
    )


def _talk(count: int, *, start: int = 1) -> list[ChatMessage]:
    return [
        _row("user" if index % 2 else "assistant", f"第 {index} 句", index)
        for index in range(start, start + count)
    ]


def _model(reply: str = "折好的那一段", error: Exception | None = None):
    chat = ScriptedChat(reply=AIMessage(content=reply), error=error)

    async def source(_choice: ModelChoice):
        return chat

    return GuardedModel(source=source, breaker=CircuitBreaker(name="test"))


class TestReuse:
    """同台阶复用，跨台阶重折——这一条是整个模块存在的理由。"""

    def test_the_same_step_keeps_the_stored_summary_verbatim(self) -> None:
        stored = Summary(through_seq=20, text="旧的那段", model=STAMP)
        assert summarize.reuse(stored, 20, STAMP) is stored

    def test_crossing_a_step_asks_for_a_refold(self) -> None:
        stored = Summary(through_seq=20, text="旧的那段", model=STAMP)
        assert summarize.reuse(stored, 30, STAMP) is None

    def test_a_different_model_asks_for_a_refold(self) -> None:
        """两截摘要由不同模型折出来时口径能差很远，而拼在一起看不出接缝。"""
        stored = Summary(through_seq=20, text="旧的那段", model="codex:summary")
        assert summarize.reuse(stored, 20, STAMP) is None

    def test_nothing_stored_asks_for_a_fold(self) -> None:
        assert summarize.reuse(None, 20, STAMP) is None


class TestStoredShape:
    """JSONB 是无类型的，一行脏数据不该让这个会话从此发不出任何一句。"""

    def test_a_well_formed_row_comes_back(self) -> None:
        got = summarize.stored_of(
            {"through_seq": 12, "text": "一段", "model": STAMP}
        )
        assert got == Summary(through_seq=12, text="一段", model=STAMP)

    @pytest.mark.parametrize(
        "body",
        [
            None,
            "不是对象",
            {"through_seq": "12", "text": "一段"},
            {"through_seq": 12, "text": ""},
            {"text": "少了边界"},
        ],
    )
    def test_a_broken_row_reads_as_nothing(self, body: object) -> None:
        assert summarize.stored_of(body) is None


class TestPlacement:
    """摘要挂在历史区最前面，且要说清它不是用户刚说的话。"""

    def test_no_summary_hangs_nothing(self) -> None:
        assert summarize.messages_of(None) == []

    def test_the_block_says_it_is_not_the_user_speaking(self) -> None:
        """不说的话模型会回一句「你贴的这个是什么意思」（与状态块同一个坑）。"""
        said = summarize.messages_of(
            Summary(through_seq=1, text="一段", model=STAMP)
        )
        assert len(said) == 1
        body = str(said[0].content)
        assert "不是用户说的话" in body
        assert "一段" in body


class TestFoldInput:
    """喂进去的只有「上一段摘要 + 新脱落的那几条」，不是从头再来一遍。"""

    def test_only_rows_after_the_previous_boundary_go_in(self) -> None:
        previous = Summary(through_seq=5, text="更早的结论", model=STAMP)
        body = summarize._fold_input(_talk(10), previous)
        assert "更早的结论" in body
        # 第 1–4 句在上一段摘要里了，不该再喂一遍
        assert "第 1 句" not in body
        assert "第 6 句" in body

    def test_the_first_fold_takes_everything_dropped(self) -> None:
        body = summarize._fold_input(_talk(4), None)
        assert "第 1 句" in body
        assert "已有摘要" not in body

    def test_tool_messages_do_not_go_in(self) -> None:
        """过程不是结论：调了哪个工具、报了什么错，折进去只会占字数。"""
        rows = [*_talk(2), _row("tool", "工具回执", 3)]
        assert "工具回执" not in summarize._fold_input(rows, None)

    def test_an_empty_stretch_folds_to_nothing(self) -> None:
        assert summarize._fold_input([], None) == ""


class TestModelSummarizer:
    """真折那一路：折得出来就落一段，折不出来给 None。"""

    async def test_a_fold_carries_the_boundary_and_the_model_stamp(
        self,
    ) -> None:
        folded = await summarize.ModelSummarizer(
            model=_model("结论一二三"), profile="default"
        ).fold(_talk(12), through_seq=13, previous=None)
        assert folded is not None
        assert folded.text == "结论一二三"
        assert folded.through_seq == 13
        assert folded.model == STAMP

    async def test_it_folds_on_the_summary_kind_not_the_chat_one(self) -> None:
        """摘要单列一档是为了断路器：它连挂不该短路掉用户正在说的那句话。"""
        assert (
            summarize.ModelSummarizer(
                model=_model(), profile="codex"
            ).choice.kind
            == "summary"
        )

    async def test_a_dead_endpoint_folds_to_nothing_instead_of_raising(
        self,
    ) -> None:
        """折不成是可接受的降级；抛出去会让一个本来能跑完的回合发不出去。"""
        broken = _model(error=APIConnectionError(request=None))  # type: ignore[arg-type]  # 理由：假件只用它的类型分档
        folded = await summarize.ModelSummarizer(
            model=broken, profile="default"
        ).fold(_talk(12), through_seq=13, previous=None)
        assert folded is None

    async def test_an_empty_answer_folds_to_nothing(self) -> None:
        folded = await summarize.ModelSummarizer(
            model=_model("   "), profile="default"
        ).fold(_talk(12), through_seq=13, previous=None)
        assert folded is None

    async def test_the_null_one_never_folds(self) -> None:
        """装不上摘要那一档时如实缺席，不是半个实现。"""
        got = await summarize.NullSummarizer().fold(
            _talk(12), through_seq=13, previous=None
        )
        assert got is None


def _deps(
    folder: RecordingSummarizer, session: RecordingSession
) -> AdvanceDeps:
    @asynccontextmanager
    async def sessions() -> AsyncIterator[Any]:
        yield session

    return AdvanceDeps(
        sessions=cast("Any", sessions),
        model=_model(),
        server_tools=cast("Any", None),
        summarizer=lambda _profile: cast("Any", folder),
    )


def _loaded(rows: list[ChatMessage], stored: Summary | None) -> LoadedContext:
    return LoadedContext(
        rows=rows, plan=None, summary=stored, choice=ModelChoice()
    )


class TestSummaryOrchestration:
    """读原料 → 该不该重折 → 落库，三步各自的边界。"""

    async def test_a_short_session_gets_no_summary_at_all(self) -> None:
        """没脱落就没什么可折的，别为了有而有。"""
        folder, session = RecordingSummarizer(None), RecordingSession()
        got = await _summary_of(
            _deps(folder, session), uuid.uuid4(), _loaded(_talk(4), None)
        )
        assert got is None
        assert folder.calls == 0

    async def test_the_same_step_never_calls_the_model(self) -> None:
        """复用是逐字的，也是免费的——同一个台阶内不该再折一次。"""
        rows = _talk(MAX_HISTORY_MESSAGES + 12)
        _, kept = history.split(rows, MAX_HISTORY_MESSAGES)
        stored = Summary(through_seq=kept[0].seq, text="旧的", model=STAMP)
        folder, session = RecordingSummarizer(None), RecordingSession()

        got = await _summary_of(
            _deps(folder, session), uuid.uuid4(), _loaded(rows, stored)
        )
        assert got is stored
        assert folder.calls == 0
        assert session.written == []

    async def test_crossing_a_step_refolds_and_persists(self) -> None:
        rows = _talk(MAX_HISTORY_MESSAGES + 12)
        _, kept = history.split(rows, MAX_HISTORY_MESSAGES)
        stale = Summary(through_seq=1, text="很旧的", model=STAMP)
        fresh = Summary(through_seq=kept[0].seq, text="新的", model=STAMP)
        folder, session = RecordingSummarizer(fresh), RecordingSession()

        got = await _summary_of(
            _deps(folder, session), uuid.uuid4(), _loaded(rows, stale)
        )
        assert got is fresh
        assert folder.calls == 1
        # ⚠ 增量折：上一段要交给折叠器，否则每跨一个台阶都要从头再喂一遍
        assert folder.previous is stale
        assert len(session.written) == 1

    async def test_a_failed_fold_falls_back_and_writes_nothing(self) -> None:
        """折不成就退回上一段：它仍然逐字稳定，比没有强，也比抛出去强。"""
        rows = _talk(MAX_HISTORY_MESSAGES + 12)
        stale = Summary(through_seq=1, text="很旧的", model=STAMP)
        folder, session = RecordingSummarizer(None), RecordingSession()

        got = await _summary_of(
            _deps(folder, session), uuid.uuid4(), _loaded(rows, stale)
        )
        assert got is stale
        assert session.written == []

    async def test_a_failed_first_fold_leaves_the_turn_without_a_summary(
        self,
    ) -> None:
        """一次都没折成过时也照常走完，历史退回今天的「那一截直接丢」。"""
        folder, session = RecordingSummarizer(None), RecordingSession()
        got = await _summary_of(
            _deps(folder, session),
            uuid.uuid4(),
            _loaded(_talk(MAX_HISTORY_MESSAGES + 12), None),
        )
        assert got is None
