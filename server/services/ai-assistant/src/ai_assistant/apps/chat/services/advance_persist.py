"""一个回合跑完之后怎么落库：一条助手消息、若干步骤、用量与摘要。

⚠ 与 `advance_service` 分家只因为**行数上限**（模块 ≤600 行），不是因为它们是
两件事：落库是推进的最后一步，改其中一处几乎总要看另一处。

⚠ 增量**不进落库那一摞**：回合结束时落的是攒齐的那条助手消息，增量只是它的
碎片。都留下的话，同一段话在库里会有两份，而重放时模型看到自己把同一件事说了
两遍。
"""

import uuid
from collections.abc import Callable, Sequence
from contextlib import AbstractAsyncContextManager

from langchain_core.messages import BaseMessage
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.crud import session_crud
from ai_assistant.apps.chat.models import ChatMessage, ChatStep
from lib.logging import get_logger
from llmcore.memory import history
from llmcore.turn import TurnOutcome, TurnStep

_logger = get_logger("assistant.advance")

# 开一个事务的那件东西。⚠ 收工厂而不是收一个已开的会话：落库要自己的事务，
# 而推进那条链路的大半是在事务之外跑的（折叠要调模型，事务里禁止外部 IO）
Sessions = Callable[[], AbstractAsyncContextManager[AsyncSession]]


async def persist(
    sessions: Sessions,
    *,
    chat_session_id: uuid.UUID,
    incoming: Sequence[BaseMessage],
    outcome: TurnOutcome,
    steps: list[TurnStep],
) -> None:
    """把这一回合的输入、产出与步骤落库。

    ⚠ 收的是**已经摊好的入向消息**而不是原始载荷：那一步的解码是推进那一层的
    事，收载荷会把这里与工作面、附件、截图全绑在一起。

    Args: sessions, chat_session_id, incoming, outcome, steps。
    """
    async with sessions() as session:
        rows = await session_crud.messages_of(session, chat_session_id)
        seq = max((row.seq for row in rows), default=0)
        written: list[ChatMessage] = []
        for message in [*incoming, *outcome.messages]:
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
        # 它们就从 `session.new` 里出去了，回头再去那里找是一场空——表现是
        # 步骤一条都没落库，而消息看着都在
        await session.flush()
        _attach_steps(session, written, steps, outcome)


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
