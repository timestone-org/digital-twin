"""推进一个回合：装上下文、跑循环、逐步吐出去、落库。

⚠ **不用请求级的数据库会话。** 流式响应的生成器跑在路由函数返回之后，那时
请求作用域的依赖可能已经收摊了——拿着一个关掉的会话去写库，报出来的错与
「助手做了什么」毫无关系，且只在流够长时才出现。本模块自己从容器开会话。

⚠ 落库在**流结束之前**完成。停在等浏览器时尤其要紧：浏览器一定会带着结果
回来，而它要能在库里找到自己接的是哪一步。
"""

import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from typing import Any

from langchain_core.messages import (
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.crud import session_crud
from ai_assistant.apps.chat.models import ChatMessage, ChatStep
from ai_assistant.apps.chat.services import history, vision
from ai_assistant.apps.chat.services.prompt import build_system_prompt
from ai_assistant.apps.chat.services.server_tools import ServerTools
from ai_assistant.apps.chat.services.tool_specs import TOOL_SPECS
from ai_assistant.apps.chat.services.turn import (
    ServerToolRunner,
    TurnDeps,
    stream_turn,
)
from ai_assistant.apps.chat.services.turn_types import TurnOutcome, TurnStep
from ai_assistant.container import Container
from ai_assistant.llm import GuardedModel, ModelDisabled
from ai_assistant.settings import MAX_HISTORY_MESSAGES
from lib.logging import get_logger

_logger = get_logger("assistant.advance")

# 开一个数据库会话。⚠ 留成可注入的：流式响应的生成器跑在路由函数返回之后，
# 拿请求作用域那个会话会碰上一个已经收摊的依赖；而用例要把它换成自己那条
# 回滚连接，否则跑一遍回合就在库里留下真数据
SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]


@dataclass(frozen=True)
class AdvanceDeps:
    """推进一个回合要的那几样。"""

    sessions: SessionFactory
    model: GuardedModel
    server_tools: ServerToolRunner


def deps_of(container: Container, headers: dict[str, str]) -> AdvanceDeps:
    """从容器取出这几样；没接模型就抛。

    ⚠ `headers` 是这一次调用要转发给 platform 的身份头，**每请求一份**。
    做成进程级的话，两个用户的请求会互相借用对方的身份。

    Args: container, headers。
    """
    if container.model is None:
        raise ModelDisabled("本部署没有接模型")
    return AdvanceDeps(
        sessions=container.database.session,
        model=container.model,
        server_tools=ServerTools(platform=container.platform, headers=headers),
    )


@dataclass(frozen=True)
class ClientToolResult:
    """浏览器跑完一个客户端工具之后带回来的东西。"""

    call_id: str
    # 成功时的产出；失败时给 None 并填 error
    output: Any = None
    error: str | None = None

    def as_text(self) -> str:
        """摊成模型认的一段工具输出。"""
        if self.error is not None:
            return f"失败：{self.error}"
        # ⚠ 图不放在工具消息里：那一层只认文字，塞进去多半被整条丢掉，
        # 表现是模型说「我没看到图」而调用明明成功了
        if vision.is_image(self.output):
            return vision.HANDOFF
        return str(self.output)

    def image(self) -> str | None:
        """这一条带回来的图；没有就是 None。"""
        if not vision.is_image(self.output):
            return None
        return str(self.output)


@dataclass(frozen=True)
class AdvanceInput:
    """推进一次要的输入。用户发话与工具回填**二选一**。"""

    surface_kind: str
    surface_label: str = ""
    user_text: str | None = None
    tool_results: list[ClientToolResult] = field(
        default_factory=list[ClientToolResult]
    )


def incoming_messages(payload: AdvanceInput) -> list[BaseMessage]:
    """把这一次的输入摊成模型认的消息。

    ⚠ 工具回填必须逐条带回 `call_id`：对不上的话，模型看到的是「我问了 A，
    回来的是 B 的答案」，而它多半会顺着错的往下走。

    Args: payload。
    """
    if payload.user_text is not None:
        return [HumanMessage(content=payload.user_text)]
    replies: list[BaseMessage] = [
        ToolMessage(content=result.as_text(), tool_call_id=result.call_id)
        for result in payload.tool_results
    ]
    # ⚠ 图统一排在这一批工具消息**之后**：夹在中间的话，工具消息与它对应的
    # 调用就不再相邻，而有的端点按相邻性校验这一段
    pictures = [one.image() for one in payload.tool_results]
    return replies + [vision.image_message(one) for one in pictures if one]


async def load_context(
    session: AsyncSession,
    *,
    chat_session_id: uuid.UUID,
    payload: AdvanceInput,
) -> list[BaseMessage]:
    """系统提示词 + 一段历史 + 这一次的输入。

    ⚠ 历史只带最近的一截。全带的话，一个跑了几十轮的会话会把上下文占满，
    而被挤掉的是**这一轮的工作面快照**——模型于是对着一屏它看不见的画布动手。

    Args: session, chat_session_id, payload。
    """
    rows = await session_crud.messages_of(session, chat_session_id)
    recent = rows[-MAX_HISTORY_MESSAGES:]
    system = SystemMessage(
        content=build_system_prompt(
            payload.surface_kind, surface_label=payload.surface_label
        )
    )
    return [system, *history.replay(recent), *incoming_messages(payload)]


async def advance(
    deps: AdvanceDeps,
    *,
    chat_session_id: uuid.UUID,
    payload: AdvanceInput,
) -> AsyncIterator[TurnStep | TurnOutcome]:
    """推进一个回合，逐步吐出去，最后落库。

    Args: deps, chat_session_id, payload。
    """
    async with deps.sessions() as session:
        messages = await load_context(
            session, chat_session_id=chat_session_id, payload=payload
        )
    turn = TurnDeps(
        model=deps.model,
        specs=TOOL_SPECS,
        run_tool=deps.server_tools,
        # 带图的这一轮走视觉档。⚠ 不能整个会话都走：视觉模型的单价与延迟都
        # 高得多，一次截图之后每一句闲聊都按视觉计费
        kind="vision" if has_image(payload) else "chat",
    )
    produced: list[TurnStep] = []
    outcome: TurnOutcome | None = None
    async for item in stream_turn(turn, messages):
        if isinstance(item, TurnOutcome):
            outcome = item
            continue
        produced.append(item)
        yield item
    if outcome is not None:
        await _persist(
            deps,
            chat_session_id=chat_session_id,
            payload=payload,
            outcome=outcome,
            steps=produced,
        )
        yield outcome


def has_image(payload: AdvanceInput) -> bool:
    """这一次回填里有没有图，也就是这一轮要不要走视觉档。

    Args: payload。
    """
    return any(one.image() is not None for one in payload.tool_results)


async def _persist(
    deps: AdvanceDeps,
    *,
    chat_session_id: uuid.UUID,
    payload: AdvanceInput,
    outcome: TurnOutcome,
    steps: list[TurnStep],
) -> None:
    """把这一回合的输入、产出与步骤落库。

    Args: deps, chat_session_id, payload, outcome, steps。
    """
    async with deps.sessions() as session:
        rows = await session_crud.messages_of(session, chat_session_id)
        seq = max((row.seq for row in rows), default=0)
        written: list[ChatMessage] = []
        for message in [*incoming_messages(payload), *outcome.messages]:
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
