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
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.crud import session_crud
from ai_assistant.apps.chat.models import ChatMessage, ChatSession, ChatStep
from ai_assistant.apps.chat.services.intent import select as tool_select
from ai_assistant.apps.chat.services.memory import (
    history,
    state_block,
    summarize,
)
from ai_assistant.apps.chat.services.memory.ports import Summarizer, Summary
from ai_assistant.apps.chat.services.memory.prompt import build_system_prompt
from ai_assistant.apps.chat.services.perception import vision
from ai_assistant.apps.chat.services.planning import plan as plan_service
from ai_assistant.apps.chat.services.planning.turn import (
    ServerToolRunner,
    TurnDeps,
    TurnEvent,
    stream_turn,
)
from ai_assistant.apps.chat.services.planning.turn_types import (
    TurnOutcome,
    TurnStep,
)
from ai_assistant.apps.chat.services.tools.registry import build_registry
from ai_assistant.container import Container
from ai_assistant.llm import (
    DEFAULT_PROFILE,
    GuardedModel,
    ModelChoice,
    ModelDisabled,
    ModelKind,
)
from ai_assistant.settings import MAX_HISTORY_MESSAGES
from lib.logging import get_logger

_logger = get_logger("assistant.advance")

# 开一个数据库会话。⚠ 留成可注入的：流式响应的生成器跑在路由函数返回之后，
# 拿请求作用域那个会话会碰上一个已经收摊的依赖；而用例要把它换成自己那条
# 回滚连接，否则跑一遍回合就在库里留下真数据
SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# 按会话的档位造一个折叠器。⚠ 是工厂不是单例：折叠要跟着这个会话选的那一路走，
# 否则一个只登录了订阅账号的部署永远折不出摘要（`memory/summarize.py`）
SummarizerFactory = Callable[[str], Summarizer]


@dataclass(frozen=True)
class AdvanceDeps:
    """推进一个回合要的那几样。"""

    sessions: SessionFactory
    model: GuardedModel
    server_tools: ServerToolRunner
    summarizer: SummarizerFactory


def deps_of(container: Container, headers: dict[str, str]) -> AdvanceDeps:
    """从容器取出这几样；没接模型就抛。

    ⚠ `headers` 是这一次调用要转发给 platform 的身份头，**每请求一份**。
    做成进程级的话，两个用户的请求会互相借用对方的身份。

    Args: container, headers。
    """
    if container.model is None:
        raise ModelDisabled("本部署没有接模型")
    model = container.model
    return AdvanceDeps(
        sessions=container.database.session,
        model=model,
        summarizer=_summarizer_factory(model),
        # ⚠ 走注册表而不是直接造 `ServerTools`：客户端那一路的名字也在表里，
        # 于是「本该交给浏览器的工具走到了服务端」会得到一句说得清的错
        # （`RunsElsewhere`），而不是与「模型编了个工具名」混成同一档
        server_tools=build_registry(
            platform=container.platform, headers=headers
        ).run,
    )


def _summarizer_factory(model: GuardedModel) -> SummarizerFactory:
    """按档位造折叠器的那个口子。

    Args: model（带断路器的模型调用面）。
    """

    def make(profile: str) -> Summarizer:
        return summarize.ModelSummarizer(model=model, profile=profile)

    return make


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
    # 这一屏此刻的摘要。⚠ **每一次推进都带最新的一份**，不只在用户发话那次：
    # 提示词每一轮现拼，只在第一轮带的话，助手动了两下之后看到的就是一屏
    # 它自己都不知道改成什么样了的画布
    surface_context: dict[str, Any] | None = None
    # 这一页实现了哪些客户端工具（前端自报）。None = 老前端，退回技能声明推导
    client_tools: list[str] | None = None


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


def assemble(
    *,
    payload: AdvanceInput,
    rows: list[ChatMessage],
    plan: dict[str, Any] | None,
    summary: Summary | None = None,
) -> list[BaseMessage]:
    """把这一轮喂给模型的消息列表拼出来。

    ⚠ 顺序就是上下文的分层，从最稳到每轮都变：常驻提示词 → 历史 → 这一次的
    输入 → **末尾的状态块**。易变的东西一旦挪到前面去，它后面的工具声明与整段
    历史会跟着一起丢掉端点的前缀缓存（`memory/prompt.py`
    与 `memory/state_block.py` 文件头）。

    ⚠ 状态块**不落库**：`_persist` 落的是 `incoming_messages` 与本回合新增的
    那几条，而它两者都不是。

    ⚠ 历史只带最近的一截，且截断点不许把工具调用与它的回应切开
    （`history.window`）。全带的话，一个跑了几十轮的会话会把上下文占满。

    ⚠ 摘要排在历史**之前**、常驻提示词**之后**：它代表的就是更早的那一截。
    它与历史窗口锚在同一个台阶上，同一个台阶内两者都逐字不变——挪到别处或者
    每轮现折，它就成了第五个前缀断点（`memory/summarize.py`）。

    ⚠ 尾部**没等到回执的调用要就地补一条失败回执**：上一轮被掐掉、页面被关掉、
    回执整批被判不合法，都会留下这样一批孤儿，而端点对「有调用没回应」的一段
    历史一律判 400——不补的话这个会话从此一句都发不出去（`history` 文件头）。
    补在历史与这一次的输入**之间**：这一次带回来的回执要先认，剩下的才算孤儿。

    Args: payload, rows（这个会话的全部消息）, plan（会话上的当前计划）。
    """
    recent = history.window(rows, MAX_HISTORY_MESSAGES)
    system = SystemMessage(
        content=build_system_prompt(
            payload.surface_kind, surface_label=payload.surface_label
        )
    )
    past = history.replay(recent)
    incoming = incoming_messages(payload)
    orphans = history.unanswered([*past, *incoming])
    return [
        system,
        *summarize.messages_of(summary),
        *past,
        *history.fillers(orphans),
        *incoming,
        *state_block.messages_of(payload.surface_context, plan),
    ]


@dataclass(frozen=True)
class LoadedContext:
    """一次读库拿到的原料。折叠与拼装都在事务之外用它。"""

    rows: list[ChatMessage]
    plan: dict[str, Any] | None
    summary: Summary | None
    choice: ModelChoice


async def load_context(
    session: AsyncSession,
    *,
    chat_session_id: uuid.UUID,
    payload: AdvanceInput,
) -> LoadedContext:
    """读出这个会话的历史、计划、已有摘要与模型选择。

    ⚠ 只读不拼：拼装要等折叠的结果，而折叠是一次模型调用，不能在这个事务里跑
    （database-standard：事务里禁止外部 IO）。

    Args: session, chat_session_id, payload。
    """
    rows = await session_crud.messages_of(session, chat_session_id)
    row = await session.get(ChatSession, chat_session_id)
    return LoadedContext(
        rows=rows,
        plan=row.plan_json if row is not None else None,
        summary=(
            summarize.stored_of(row.summary_json) if row is not None else None
        ),
        choice=_choice_of(row, payload),
    )


# 一次推进往外吐的东西：回合事件，外加计划快照
AdvanceEvent = TurnEvent | plan_service.PlanUpdate


async def advance(
    deps: AdvanceDeps,
    *,
    chat_session_id: uuid.UUID,
    payload: AdvanceInput,
) -> AsyncIterator[AdvanceEvent]:
    """推进一个回合，边跑边吐，最后落库。

    ⚠ 增量**不进落库那一摞**：回合结束时落的是攒齐的那条助手消息，增量只是
    它的碎片。都留下的话，同一段话在库里会有两份，而重放时模型看到自己把
    同一件事说了两遍。

    Args: deps, chat_session_id, payload。
    """
    messages, choice = await _opened(deps, chat_session_id, payload)
    plans = plan_service.PlanTools(
        sessions=deps.sessions, chat_session_id=chat_session_id
    )
    turn = TurnDeps(
        model=deps.model,
        specs=tool_select.specs_for(payload.surface_kind, payload.client_tools),
        run_tool=_with_plan_tools(plans, deps.server_tools),
        choice=choice,
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
        # 计划刚写完的那一步后面紧跟一帧快照：前端的清单与步骤同步长
        if _wrote_plan(item) and plans.latest is not None:
            yield plan_service.PlanUpdate(plan=plans.latest)
    if outcome is not None:
        await _persist(
            deps,
            chat_session_id=chat_session_id,
            payload=payload,
            outcome=outcome,
            steps=produced,
        )
        yield outcome


async def _opened(
    deps: AdvanceDeps, chat_session_id: uuid.UUID, payload: AdvanceInput
) -> tuple[list[BaseMessage], ModelChoice]:
    """读原料 → 折叠 → 拼上下文。

    ⚠ 原料一次会话里读完：分两次开的话，中途改过模型的那一轮会读到两份不一致
    的状态（提示词按旧的拼、模型按新的取）。

    ⚠ 折叠**在事务之外**：那是一次模型调用，耗时不可控，放在事务里会把数据库
    连接与锁一起长期占住（database-standard）。所以是「短事务读 → 调用 →
    短事务写」，不是「一个事务包住全程」。

    Args: deps, chat_session_id, payload。
    """
    async with deps.sessions() as session:
        loaded = await load_context(
            session, chat_session_id=chat_session_id, payload=payload
        )
    summary = await _summary_of(deps, chat_session_id, loaded)
    messages = assemble(
        payload=payload,
        rows=loaded.rows,
        plan=loaded.plan,
        summary=summary,
    )
    return messages, loaded.choice


async def _summary_of(
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
    dropped, kept = history.split(loaded.rows, MAX_HISTORY_MESSAGES)
    if not dropped:
        return None
    through = kept[0].seq if kept else dropped[-1].seq + 1
    stored = loaded.summary
    stamp = summarize.stamp_of(
        ModelChoice(kind="summary", profile=loaded.choice.profile)
    )
    kept_as_is = summarize.reuse(stored, through, stamp)
    if kept_as_is is not None:
        return kept_as_is
    folded = await deps.summarizer(loaded.choice.profile).fold(
        dropped, through, stored
    )
    if folded is None:
        return stored
    await _save_summary(deps, chat_session_id, folded)
    return folded


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


def _choice_of(row: ChatSession | None, payload: AdvanceInput) -> ModelChoice:
    """这一轮用哪一路模型、哪一档。

    ⚠ 带图的这一轮走视觉档。不能整个会话都走：视觉模型的单价与延迟都高得多，
    一次截图之后每一句闲聊都按视觉计费。

    ⚠ 档位从**会话行**上取而不是从请求上取：换模型是会话级的选择，
    每次推进都由前端重报的话，工具回填那几次会漏带（那时前端手上没有它）。

    ⚠ 行上是空的只可能是**建行时还没盖默认的旧行**（见
    `session_service.create_session`）。那时退按量而不是退部署默认：这一层
    看不见订阅那一路登没登录，按配置退的话，配了却没登录的部署会让每一条
    旧会话都发不出回合。

    Args: row, payload。
    """
    kind: ModelKind = "vision" if has_image(payload) else "chat"
    if row is None:
        return ModelChoice(kind=kind)
    return ModelChoice(
        kind=kind,
        profile=row.model_profile or DEFAULT_PROFILE,
        effort=row.reasoning_effort,
    )


def _wrote_plan(item: AdvanceEvent) -> bool:
    """这一件产出是不是一次成功的计划写入。

    Args: item。
    """
    return (
        isinstance(item, TurnStep)
        and plan_service.is_plan_tool(item.name)
        and item.state == "succeeded"
    )


def _with_plan_tools(
    plans: plan_service.PlanTools, base: ServerToolRunner
) -> ServerToolRunner:
    """计划工具就地拦下，其余交给原来的执行面。

    ⚠ 不并进 `ServerTools`：计划写的是本服务自己的库，那一包按「转发身份头
    打 platform」组织，混在一起两种失败就分不开档了。

    Args: plans, base。
    """

    async def run(name: str, arguments: dict[str, Any]) -> Any:
        if plan_service.is_plan_tool(name):
            return await plans.run(name, arguments)
        return await base(name, arguments)

    return run


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
