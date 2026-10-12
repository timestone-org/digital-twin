"""知识库回合编排：保留范围、引用与标题语义，按问题加载固定目录中的标准技能。"""

import json
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
    budget,
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
from knowledge_server.apps.chat.services.context import (
    ContextProjection,
    marked,
)
from knowledge_server.apps.chat.services.markers import numbers_in
from knowledge_server.apps.chat.services.prompt import (
    build_system_prompt,
    scope_messages,
)
from knowledge_server.apps.chat.services.scope import BaseScope
from knowledge_server.apps.chat.services.search_receipt import (
    compact_search_receipts,
)
from knowledge_server.apps.chat.services.tools import (
    ToolDeps,
    build_registry,
)
from knowledge_server.apps.chat.services.tools.execution import scoped_runner
from knowledge_server.apps.chat.services.tools.guides import (
    describe_tool,
    with_guides,
)
from knowledge_server.apps.chat.skills import default_catalog
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
from llmcore.output.tool_text import format_tool_output
from llmcore.skills import SkillCatalog, SkillManifest
from llmcore.skills.context import restored_from_messages
from llmcore.skills.tools import METADATA_SPECS
from llmcore.tools.execution import ToolExecutor
from llmcore.tools.registry import ToolRegistry
from llmcore.tools.selection import specs_named
from llmcore.tools.shapes import ToolSpec, openai_schema
from llmcore.turn import (
    DEFAULT_MAX_TOOL_RESULT_CHARS,
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
    # 一次工具产出最多占多少字。⚠ 按对话档模型的窗口折算（`budget`）：窗口小的
    # 模型上，一次检索回执就能把上下文顶穿，而端点回的 400 与长度毫无关系
    tool_result_chars: int = DEFAULT_MAX_TOOL_RESULT_CHARS
    # 回放进来的历史最多占多少字；0 = 不知道窗口，按条数窗口那一份走
    history_chars: int = 0
    # 整段上下文的字数预算；0 = 不知道窗口。⚠ 与上面两格是三条判据：一条管
    # 单次产出、一条管历史、这一条管「这一轮加起来」
    context_chars: int = 0
    skills: SkillCatalog | None = None
    codes: frozenset[str] | None = None


def deps_of(container: Container, caller: CallerContext) -> AdvanceDeps:
    """从容器取出这几样；没接对话档就抛。

    Args: container, caller（只用来确认已认证；工具在进程内直调，不转发头）。
    """
    # ⚠ 问的是**此刻**：对话档的端点来自运行期可改的目录，装配了不等于能用
    if not container.answerer.can_answer:
        raise ChatUnavailable("这套部署没有接对话档，知识库对话用不了")
    lanes = strategies(lanes_of(container))
    window_tokens = container.settings.model_context_tokens
    afforded = budget.result_chars(window_tokens, DEFAULT_MAX_TOOL_RESULT_CHARS)
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
                result_chars=afforded,
            )
        ),
        summarizer=summarize.ModelSummarizer(
            model=container.responder, profile="default"
        ),
        tool_result_chars=afforded,
        history_chars=budget.history_chars(window_tokens, afforded),
        context_chars=budget.context_chars(window_tokens),
        skills=container.skills,
        codes=caller.permissions,
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
            return (
                f"失败：{self.error}\ncode: client_tool_failed\n"
                "next_action: 核对会话状态、权限与工具参数后再调用；"
                "不要把失败当成空结果。"
            )
        return (
            self.output
            if isinstance(self.output, str)
            else json.dumps(self.output, ensure_ascii=False, default=str)
        )


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
    texts = compact_search_receipts(
        [result.as_text() for result in payload.tool_results]
    )
    return [
        ToolMessage(
            content=format_tool_output(body, 8000), tool_call_id=result.call_id
        )
        for result, body in zip(payload.tool_results, texts, strict=True)
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


MAX_SKILL_RESTORE_CHARS = 4000


@dataclass(frozen=True)
class ContextOptions:
    history_chars: int = 0
    skills: tuple[SkillManifest, ...] | None = None
    restore_chars: int = MAX_SKILL_RESTORE_CHARS


def assemble(
    *,
    payload: AdvanceInput,
    rows: list[HistoryRow],
    summary: Summary | None,
    scope: BaseScope,
    options: ContextOptions | None = None,
) -> list[BaseMessage]:
    """稳定规则、范围、摘要、历史、技能恢复按序组装。"""
    options = options or ContextOptions()
    selected = (
        options.skills
        if options.skills is not None
        else default_catalog().select()
    )
    recent = history.window(rows, MAX_HISTORY_MESSAGES, HISTORY_DROP_STEP)
    replayed = history.with_user_requests(
        rows, history.fitted(history.replay(recent), options.history_chars)
    )
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
        *marked(
            [
                SystemMessage(content=build_system_prompt(selected)),
                *scope_messages(scope),
            ],
            "prefix",
        ),
        *marked(summarize.messages_of(summary), "summary"),
        *replayed,
        *history.fillers(orphans),
        *fresh,
        *marked(
            restored_from_messages(
                history.replay(rows), replayed, selected, options.restore_chars
            ),
            "restored",
        ),
    ]


async def advance(
    deps: AdvanceDeps,
    *,
    chat_session_id: uuid.UUID,
    payload: AdvanceInput,
) -> AsyncIterator[TurnEvent | title_service.SessionTitled | CitationsFound]:
    """推进、持久化并依次返回引用、标题和回合终态。"""
    selected = (deps.skills or default_catalog()).select(codes=deps.codes)
    loaded, messages = await _opened(deps, chat_session_id, payload, selected)
    # ⚠ 注册表按这一轮读到的范围现造：范围改了下一轮就跟着改，不留隔夜的那份
    ledger = Ledger()
    registry = deps.tools(loaded.scope, ledger)
    specs = _turn_specs(registry.specs, payload.client_tools)
    turn = _turn_deps(deps, loaded, selected, registry, specs)
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


def _turn_deps(
    deps: AdvanceDeps,
    loaded: LoadedContext,
    selected: tuple[SkillManifest, ...],
    registry: ToolRegistry,
    specs: tuple[ToolSpec, ...],
) -> TurnDeps:
    """把业务范围、当次工具预算和模型输入投影装配在同一个回合。"""
    return TurnDeps(
        model=deps.model,
        specs=specs,
        run_tool=ToolExecutor(
            specs,
            selected,
            scoped_runner(registry),
            describe=describe_tool,
            max_skill_chars=deps.tool_result_chars,
            result_reserve_chars=400 if deps.context_chars > 0 else 0,
        ),
        choice=ModelChoice(),
        max_context_chars=deps.context_chars,
        max_tool_result_chars=deps.tool_result_chars,
        prepare_messages=ContextProjection(
            deps.context_chars,
            len(
                json.dumps(
                    [openai_schema(one) for one in specs], ensure_ascii=False
                )
            ),
            selected,
            history.replay(loaded.rows),
            _restore_budget(deps),
        ),
    )


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

    ⚠ 标题必须先于 outcome：前端收到 turn.done 后会立即关闭流。

    Args: deps, chat_session_id, payload, cited（已落库的那几条）, outcome。
    """
    if cited:
        yield CitationsFound(items=tuple(cited))
    named = await _named(deps, chat_session_id, payload, outcome)
    if named is not None:
        yield named
    yield outcome


async def _named(
    deps: AdvanceDeps,
    chat_session_id: uuid.UUID,
    payload: AdvanceInput,
    outcome: TurnOutcome,
) -> title_service.SessionTitled | None:
    """这一轮之后，会话还没有标题就给它起一个。

    首轮进入客户端工具时也按用户问题命名，工具回填不重复起名。
    待续时不把工具执行前的说明当作答案。

    Args: deps, chat_session_id, payload, outcome。
    """
    if payload.user_text is None:
        return None
    return await title_service.autotitle(
        deps.sessions,
        deps.model,
        chat_session_id,
        (payload.user_text, "" if outcome.is_waiting else outcome.reply),
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
    wanted.update(
        one.name
        for one in specs
        if one.runs_on == "client" and one.name in client_tools
    )
    return specs_named(specs, frozenset(wanted))


async def _opened(
    deps: AdvanceDeps,
    chat_session_id: uuid.UUID,
    payload: AdvanceInput,
    selected: tuple[SkillManifest, ...],
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
        options=ContextOptions(
            0 if deps.context_chars > 0 else deps.history_chars,
            selected,
            _restore_budget(deps),
        ),
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


def _turn_specs(
    specs: tuple[ToolSpec, ...], client_tools: tuple[str, ...]
) -> tuple[ToolSpec, ...]:
    return tuple(
        with_guides(one)
        for one in (*_offered(specs, client_tools), *METADATA_SPECS)
    )


def _restore_budget(deps: AdvanceDeps) -> int:
    return (
        min(MAX_SKILL_RESTORE_CHARS, deps.context_chars // 8)
        if deps.context_chars > 0
        else MAX_SKILL_RESTORE_CHARS
    )
