"""推进一个回合：装上下文、跑循环、逐步吐出去、落库。

⚠ 与助手那份同构但**更薄**：没有工作面、没有附件、没有计划子系统
（docs/KNOWLEDGE_CHAT_DESIGN.md §7）。上下文只有三层：常驻提示词 → 历史
（含窗口外折成的摘要）→ 这一次的输入。
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
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.chat.crud import session_crud
from knowledge_server.apps.chat.errors import ChatUnavailable
from knowledge_server.apps.chat.models import ChatMessage, ChatSession
from knowledge_server.apps.chat.services import (
    advance_persist,
    title_service,
)
from knowledge_server.apps.chat.services import scope as scope_service
from knowledge_server.apps.chat.services.citations import (
    CitationsFound,
    Cited,
    Ledger,
    as_json,
    with_figures,
)
from knowledge_server.apps.chat.services.markers import numbers_in
from knowledge_server.apps.chat.services.prompt import (
    SYSTEM_PROMPT,
    scope_messages,
)
from knowledge_server.apps.chat.services.scope import BaseScope
from knowledge_server.apps.chat.services.tools import (
    ToolDeps,
    build_registry,
)
from knowledge_server.apps.chat.services.tools.client import ASK_TOOL
from knowledge_server.apps.knowledge.services.assembly import (
    lanes_of,
    strategies,
)
from knowledge_server.container import Container
from knowledge_server.settings import HISTORY_DROP_STEP, MAX_HISTORY_MESSAGES
from lib.auth import CallerContext
from llmcore import ModelChoice
from llmcore.memory import (
    HistoryRow,
    Summarizer,
    Summary,
    history,
    summarize,
)
from llmcore.tools.registry import ToolRegistry
from llmcore.tools.selection import specs_named
from llmcore.tools.shapes import ToolSpec
from llmcore.turn import (
    Responder,
    TurnDeps,
    TurnEvent,
    TurnOutcome,
    TurnStep,
    stream_turn,
)

# 开一个数据库会话。⚠ 留成可注入的：流式响应的生成器跑在路由函数返回之后，
# 拿请求作用域那个会话会碰上一个已经收摊的依赖；而用例要把它换成自己那条
# 回滚连接，否则跑一遍回合就在库里留下真数据
SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# 按这次对话的范围造一份工具注册表。⚠ 收工厂而不是收一份现成的：范围钉在会话
# 上，而依赖是按请求装的——装配那一刻还不知道这一次要推进的是哪个会话
ToolFactory = Callable[[BaseScope, Ledger], ToolRegistry]


@dataclass(frozen=True)
class AdvanceDeps:
    """推进一个回合要的那几样。"""

    sessions: SessionFactory
    model: Responder
    tools: ToolFactory
    summarizer: Summarizer


def deps_of(container: Container, caller: CallerContext) -> AdvanceDeps:
    """从容器取出这几样；没接对话档就抛。

    Args: container, caller（只用来确认已认证；工具在进程内直调，不转发头）。
    """
    del caller
    # ⚠ 问的是**此刻**：对话档的端点来自运行期可改的目录，装配了不等于能用
    if not container.answerer.can_answer:
        raise ChatUnavailable("这套部署没有接对话档，知识库对话用不了")
    lanes = strategies(lanes_of(container))
    return AdvanceDeps(
        sessions=container.database.session,
        model=container.responder,
        # ⚠ 走注册表而不是直接造 `KnowledgeTools`：客户端那一路的名字也在
        # 表里，于是「本该交给浏览器的工具走到了服务端」会得到一句说得清的错
        tools=lambda chosen, ledger: build_registry(
            ToolDeps(
                sessions=container.database.session,
                strategies=lanes,
                scope=chosen,
                ledger=ledger,
            )
        ),
        summarizer=summarize.ModelSummarizer(
            model=container.responder, profile="default"
        ),
    )


@dataclass(frozen=True)
class ClientToolResult:
    """浏览器跑完反问之后带回来的东西。"""

    call_id: str
    output: Any = None
    error: str | None = None

    def as_text(self) -> str:
        """摊成模型认的一段工具输出。"""
        if self.error is not None:
            return f"失败：{self.error}"
        return str(self.output)


@dataclass(frozen=True)
class AdvanceInput:
    """推进一次要的输入。用户发话与工具回填**二选一**。"""

    user_text: str | None = None
    tool_results: list[ClientToolResult] = field(
        default_factory=list[ClientToolResult]
    )
    # 这一页实现了哪些客户端工具（前端自报）。没报的模型看不见
    client_tools: tuple[str, ...] = ()


def incoming_messages(payload: AdvanceInput) -> list[BaseMessage]:
    """把这一次的输入摊成模型认的消息。

    ⚠ 工具回填必须逐条带回 `call_id`：对不上的话，模型看到的是「我问了 A，
    回来的是 B 的答案」。

    Args: payload。
    """
    if payload.user_text is not None:
        return [HumanMessage(content=payload.user_text)]
    return [
        ToolMessage(content=result.as_text(), tool_call_id=result.call_id)
        for result in payload.tool_results
    ]


@dataclass(frozen=True)
class LoadedContext:
    """一次读库拿到的原料。折叠与拼装都在事务之外用它。"""

    rows: list[HistoryRow]
    summary: Summary | None
    # 这个会话此刻的检索范围。⚠ 每一轮现读：用户可能在两轮之间刚改过它
    scope: BaseScope


async def load_context(
    session: AsyncSession, *, chat_session_id: uuid.UUID
) -> LoadedContext:
    """读出这个会话的历史、已有摘要与检索范围。

    ⚠ 只读不拼：拼装要等折叠的结果，而折叠是一次模型调用，不能在这个事务里跑
    （database-standard：事务里禁止外部 IO）。

    Args: session, chat_session_id。
    """
    rows = await session_crud.messages_of(session, chat_session_id)
    row = await session.get(ChatSession, chat_session_id)
    return LoadedContext(
        rows=[_history_row(one) for one in rows],
        summary=(
            summarize.stored_of(row.summary_json) if row is not None else None
        ),
        scope=await scope_service.resolve(
            session, row.base_scope_ids if row is not None else None
        ),
    )


def _history_row(row: ChatMessage) -> HistoryRow:
    """库里的一行 → 上下文那一层认的一条。

    ⚠ 这一步是**边界**：`llmcore` 不许含 ORM（ADR-0037 决策二）。

    Args: row。
    """
    return HistoryRow(role=row.role, seq=row.seq, content_json=row.content_json)


def assemble(
    *,
    payload: AdvanceInput,
    rows: list[HistoryRow],
    summary: Summary | None,
    scope: BaseScope,
) -> list[BaseMessage]:
    """把这一轮喂给模型的消息列表拼出来。

    ⚠ 顺序就是上下文的分层，从最稳到每轮都变：常驻提示词 → 检索范围（会话内
    不变）→ 摘要 → 历史窗口 → 这一次的输入。易变的东西一旦挪到前面去，它后面
    的整段历史会跟着一起丢掉端点的前缀缓存（ADR-0025）。

    ⚠ 尾部没应答的工具调用要补回执：否则端点判整段历史不合法，而这个会话再也
    发不出下一句。

    Args: payload, rows, summary, scope。
    """
    recent = history.window(rows, MAX_HISTORY_MESSAGES, HISTORY_DROP_STEP)
    replayed = history.replay(recent)
    fresh = incoming_messages(payload)
    answered = {
        one.tool_call_id for one in fresh if isinstance(one, ToolMessage)
    }
    orphans = tuple(
        call_id
        for call_id in history.unanswered(replayed)
        if call_id not in answered
    )
    return [
        SystemMessage(content=SYSTEM_PROMPT),
        *scope_messages(scope),
        *summarize.messages_of(summary),
        *replayed,
        *history.fillers(orphans),
        *fresh,
    ]


async def advance(
    deps: AdvanceDeps,
    *,
    chat_session_id: uuid.UUID,
    payload: AdvanceInput,
) -> AsyncIterator[TurnEvent | title_service.SessionTitled | CitationsFound]:
    """推进一个回合，边跑边吐，最后落库。

    ⚠ 增量**不进落库那一摞**：回合结束时落的是攒齐的那条助手消息，增量只是
    它的碎片。

    Args: deps, chat_session_id, payload。
    """
    loaded, messages = await _opened(deps, chat_session_id, payload)
    # ⚠ 注册表按这一轮读到的范围现造：范围改了下一轮就跟着改，不留隔夜的那份
    ledger = Ledger()
    registry = deps.tools(loaded.scope, ledger)
    turn = TurnDeps(
        model=deps.model,
        specs=_offered(registry.specs, payload.client_tools),
        run_tool=registry.run,
        choice=ModelChoice(),
    )
    produced: list[TurnStep] = []
    outcome: TurnOutcome | None = None
    async for item in stream_turn(turn, messages):
        if isinstance(item, TurnOutcome):
            outcome = item
            continue
        if isinstance(item, TurnStep):
            produced.append(item)
        yield item
    if outcome is not None:
        cited = await _stored(
            deps, chat_session_id, payload, (outcome, produced), ledger
        )
        async for tail in _closing(
            deps, chat_session_id, payload, cited, outcome
        ):
            yield tail


async def _stored(
    deps: AdvanceDeps,
    chat_session_id: uuid.UUID,
    payload: AdvanceInput,
    made: tuple[TurnOutcome, list[TurnStep]],
    ledger: Ledger,
) -> list[Cited]:
    """解出这一轮用到的依据，连同消息与步骤一起落库，回那几条。

    ⚠ 引用要在落库**之前**算出来：它跟着那条助手消息一起落，落完再算就得再写
    一次库。不落的表现是回放时整块依据凭空消失——而依据里挂着的正是文档解析出来
    的那几张图。

    Args: deps, chat_session_id, payload, made（这一轮的结果与步骤）, ledger。
    """
    outcome, produced = made
    cited = await with_figures(
        deps.sessions, ledger.resolve(numbers_in(outcome.reply))
    )
    await advance_persist.persist(
        deps.sessions,
        chat_session_id=chat_session_id,
        record=advance_persist.TurnRecord(
            incoming=incoming_messages(payload),
            outcome=outcome,
            steps=produced,
            citations=as_json(cited),
        ),
    )
    return cited


async def _closing(
    deps: AdvanceDeps,
    chat_session_id: uuid.UUID,
    payload: AdvanceInput,
    cited: list[Cited],
    outcome: TurnOutcome,
) -> AsyncIterator[TurnEvent | title_service.SessionTitled | CitationsFound]:
    """落库之后收尾的那几帧，次序是有讲究的。

    ⚠ 引用排在 outcome **之前**：前端拿到 outcome 就把回合标成结束了，之后
    再来的帧要么被丢掉、要么显得像「答完了又冒出来一块」。

    ⚠ 起名字排在 outcome **之后**：它要再调一次模型，而用户此刻已经看到答案
    了；排在前面的话，那一秒会被读成「还在答」。

    Args: deps, chat_session_id, payload, cited（已落库的那几条）, outcome。
    """
    if cited:
        yield CitationsFound(items=tuple(cited))
    yield outcome
    named = await _named(deps, chat_session_id, payload, outcome)
    if named is not None:
        yield named


async def _named(
    deps: AdvanceDeps,
    chat_session_id: uuid.UUID,
    payload: AdvanceInput,
    outcome: TurnOutcome,
) -> title_service.SessionTitled | None:
    """这一轮之后，会话还没有标题就给它起一个。

    ⚠ 只拿**用户发话**那一轮起名：工具回填那一轮的 `user_text` 是空的，
    拿它起名会得到一个基于半截上下文的标题。

    ⚠ 停在等浏览器时不起名：那时 `reply` 是「我准备这么做」那句，不是答案。

    Args: deps, chat_session_id, payload, outcome。
    """
    if payload.user_text is None or outcome.is_waiting:
        return None
    return await title_service.autotitle(
        deps.sessions,
        deps.model,
        chat_session_id,
        (payload.user_text, outcome.reply),
    )


def _offered(
    specs: tuple[ToolSpec, ...], client_tools: tuple[str, ...]
) -> tuple[ToolSpec, ...]:
    """这一轮模型看得见哪些工具：服务端的全给，客户端的只给页面自报的。

    ⚠ 页面没报 `user.ask` 就不下发它：下发了模型会调，而那一页渲染不出选项，
    用户看到的是一个永远转圈的回合。

    Args: specs, client_tools。
    """
    wanted = {one.name for one in specs if one.runs_on == "server"}
    if ASK_TOOL in client_tools:
        wanted.add(ASK_TOOL)
    return specs_named(specs, frozenset(wanted))


async def _opened(
    deps: AdvanceDeps, chat_session_id: uuid.UUID, payload: AdvanceInput
) -> tuple[LoadedContext, list[BaseMessage]]:
    """读原料 → 折叠 → 拼上下文。折叠在事务之外。

    Args: deps, chat_session_id, payload。
    """
    async with deps.sessions() as session:
        loaded = await load_context(session, chat_session_id=chat_session_id)
    summary = await _summary_of(deps, chat_session_id, loaded)
    return loaded, assemble(
        payload=payload,
        rows=loaded.rows,
        summary=summary,
        scope=loaded.scope,
    )


async def _summary_of(
    deps: AdvanceDeps, chat_session_id: uuid.UUID, loaded: LoadedContext
) -> Summary | None:
    """这一轮该挂哪一段摘要：同台阶复用，跨台阶重折；折不出来退回上一段。

    Args: deps, chat_session_id, loaded。
    """
    dropped, kept = history.split(
        loaded.rows, MAX_HISTORY_MESSAGES, HISTORY_DROP_STEP
    )
    if not dropped:
        return None
    through = kept[0].seq if kept else dropped[-1].seq + 1
    stamp = summarize.stamp_of(ModelChoice(kind="summary"))
    kept_as_is = summarize.reuse(loaded.summary, through, stamp)
    if kept_as_is is not None:
        return kept_as_is
    folded = await deps.summarizer.fold(dropped, through, loaded.summary)
    if folded is None:
        return loaded.summary
    async with deps.sessions() as session:
        await session.execute(
            update(ChatSession)
            .where(ChatSession.id == chat_session_id)
            .values(summary_json=summarize.as_json(folded))
        )
    return folded
