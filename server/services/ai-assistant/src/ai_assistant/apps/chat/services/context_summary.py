"""持久摘要的容量切点与短事务写入，模型调用位于事务外。"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import TYPE_CHECKING

from sqlalchemy import update

from ai_assistant.apps.chat.models import ChatSession
from ai_assistant.apps.chat.services.context_budget import (
    MIN_RECENT_MESSAGES,
    bounded_fold,
    tokens_of,
)
from ai_assistant.settings import MAX_HISTORY_MESSAGES
from llmcore.memory import HistoryRow, Summary, history, summarize
from llmcore.ports import ModelChoice

if TYPE_CHECKING:
    from ai_assistant.apps.chat.services.advance_service import (
        AdvanceDeps,
        LoadedContext,
    )


async def summary_of(
    deps: AdvanceDeps, chat_session_id: uuid.UUID, loaded: LoadedContext
) -> Summary | None:
    """这一轮该挂哪一段摘要：同台阶复用，跨台阶重折。

    ⚠ **同一个台阶内必须原样复用**，不许重折。重折出来的字句一定与上一轮不同，
    而它排在历史区前面——那就是一个新的前缀断点，后面整段历史跟着作废。

    ⚠ 换了模型也要重折：两截摘要由不同模型折出来时口径可以差很远，
    而拼在一起看不出接缝。

    ⚠ 折不出来时退回**上一段**（可能是 `None`）：那一段仍然逐字稳定，
    比没有强，也比抛出去让整个回合发不出去强。

    Args: deps, chat_session_id, loaded。
    """
    dropped, kept = summary_partition(loaded.rows, deps.context_tokens)
    if not dropped:
        return None
    through = kept[0].seq if kept else dropped[-1].seq + 1
    stored = loaded.summary
    stamp = summarize.stamp_of(
        ModelChoice(kind="summary", profile=loaded.choice.profile)
    )
    if (
        stored is not None
        and stored.model == stamp
        and stored.through_seq >= through
    ):
        return stored
    fold_rows, previous = bounded_fold(dropped, stored, deps.context_tokens)
    folded = await deps.summarizer(loaded.choice.profile).fold(
        fold_rows, through, previous
    )
    if folded is None:
        return stored
    await _save_summary(deps, chat_session_id, folded)
    return folded


def summary_partition(
    rows: Sequence[HistoryRow], context_tokens: int
) -> tuple[list[HistoryRow], list[HistoryRow]]:
    """条数与容量共同决定持久摘要切点；Args: rows, context_tokens。"""
    limit = MAX_HISTORY_MESSAGES
    dropped, kept = history.split(rows, limit)
    while (
        len(kept) > MIN_RECENT_MESSAGES
        and tokens_of(history.replay(kept)) > context_tokens * 0.55
    ):
        limit = max(1, len(kept) - 1)
        dropped, kept = history.split(rows, limit)
    return dropped, kept


async def _save_summary(
    deps: AdvanceDeps, chat_session_id: uuid.UUID, summary: Summary
) -> None:
    """把折出来的那段落库。

    ⚠ 单开一次短事务：折叠那次模型调用已经跑完了，这里只写一行。

    Args: deps, chat_session_id, summary。
    """
    async with deps.sessions() as session:
        await session.execute(
            update(ChatSession)
            .where(ChatSession.id == chat_session_id)
            .values(summary_json=summarize.as_json(summary))
        )
