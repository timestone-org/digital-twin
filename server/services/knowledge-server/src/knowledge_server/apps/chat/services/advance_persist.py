"""一个回合跑完之后怎么落库：入向消息、一条助手消息、若干步骤与引用。

⚠ 增量**不进落库那一摞**：回合结束时落的是攒齐的那条助手消息，增量只是它的
碎片。都留下的话，同一段话在库里会有两份。

⚠ 引用与步骤一样挂在**本回合最后一条消息**上。不落的话它只作为一帧流出去，
回放会话时整块依据凭空消失——而依据里挂着的正是文档解析出来的那几张图，
表现是「问的时候看得见图，重开这条对话图就没了」。
"""

import uuid
from collections.abc import Callable, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import BaseMessage
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.crud import session_crud
from knowledge_server.apps.chat.models import ChatMessage, ChatStep
from lib.logging import get_logger
from llmcore.memory import history
from llmcore.turn import TurnOutcome, TurnStep

_logger = get_logger("knowledge.chat.persist")

Sessions = Callable[[], AbstractAsyncContextManager[AsyncSession]]


@dataclass(frozen=True)
class TurnRecord:
    """一个回合要落的那几样。

    ⚠ 收成一个对象而不是四个形参：这一层的参数上限是 5（code-style-python），
    而「这一回合产出了什么」本来就是一件事。
    """

    incoming: Sequence[BaseMessage]
    outcome: TurnOutcome
    steps: list[TurnStep]
    # `citations.as_json` 摊好的那一份；这一轮一条都没引到就是空表
    citations: list[dict[str, Any]] = field(
        default_factory=list[dict[str, Any]]
    )


async def persist(
    sessions: Sessions,
    *,
    chat_session_id: uuid.UUID,
    record: TurnRecord,
) -> None:
    """把这一回合的输入、产出、步骤与引用落库。

    Args: sessions, chat_session_id, record。
    """
    async with sessions() as session:
        rows = await session_crud.messages_of(session, chat_session_id)
        seq = max((row.seq for row in rows), default=0)
        written: list[ChatMessage] = []
        for message in [*record.incoming, *record.outcome.messages]:
            seq += 1
            role, body = history.to_content(message)
            row = ChatMessage(
                session_id=chat_session_id,
                seq=seq,
                role=role,
                content_json=body,
            )
            session.add(row)
            written.append(row)
        # ⚠ 先 flush 拿到主键再挂步骤，且**必须自己攥着这些行**：flush 之后
        # 它们就从 `session.new` 里出去了
        await session.flush()
        _attach_steps(session, written, record.steps, record.outcome)
        _attach_citations(written, record.citations)


def _attach_citations(
    written: list[ChatMessage], citations: list[dict[str, Any]]
) -> None:
    """把引用挂到本回合最后一条消息上。

    ⚠ 空表落成 `NULL` 而不是 `[]`：两者在读侧是同一件事（这一条没有引用），
    而留一列空数组只是让每一行都多存一格。

    Args: written, citations。
    """
    if not written or not citations:
        return
    written[-1].citations_json = citations


def _attach_steps(
    session: AsyncSession,
    written: list[ChatMessage],
    steps: list[TurnStep],
    outcome: TurnOutcome,
) -> None:
    """把步骤挂到本回合最后一条消息上。

    ⚠ 等浏览器时补一条 `awaiting_client` 的步骤：界面上它是转着圈的那一行，
    而浏览器回来时要能按它认出自己接的是哪一步。

    Args: session, written, steps, outcome。
    """
    if not written:
        _logger.warning("turn_message_missing", "本回合没有落下任何消息")
        return
    last = written[-1].id
    order = 0
    for step in steps:
        order += 1
        session.add(_row_of(last, order, step))
    if outcome.is_waiting:
        order += 1
        session.add(
            ChatStep(
                message_id=last,
                seq=order,
                kind="client_tool",
                name=outcome.pending[0].name,
                state="awaiting_client",
                input_json={
                    "calls": [
                        {
                            "call_id": call.call_id,
                            "name": call.name,
                            "arguments": call.arguments,
                        }
                        for call in outcome.pending
                    ]
                },
            )
        )


def _row_of(message_id: uuid.UUID, order: int, step: TurnStep) -> ChatStep:
    return ChatStep(
        message_id=message_id,
        seq=order,
        kind=step.kind,
        name=step.name,
        state="succeeded" if step.state == "succeeded" else "failed",
        input_json=step.input_json,
        output_json=step.output_json,
        error=step.error,
    )
