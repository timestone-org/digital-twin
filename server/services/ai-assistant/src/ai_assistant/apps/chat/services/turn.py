"""一个回合的编排：模型 ↔ 工具，直到给出答复或停下来等浏览器。

图长这样：

    START → think →（没有工具调用）──────────────────→ END
                  →（有服务端工具）→ use_tools →（还有待办）→ END
                                              →（没有待办）→ think
                  →（只有客户端工具）─────────────────→ END

⚠ **客户端工具不在这里执行**。它们要下发到浏览器、由编辑器改那份本地草稿
（ADR-0023）。走到那一步回合就地结束，待办随 `TurnOutcome.pending` 交出去。

⚠ 服务端与客户端工具混在同一批时，**服务端那几个先就地跑完**再交出去。否则
浏览器回来时模型手上缺半批结果——它看到的是「我问了四件事，回来两件」，
而那通常会让它把没答的重问一遍。

⚠ 服务端工具失败也必须回一条工具消息。不回的话，模型那次调用永远没有答复，
下一轮请求会被端点判成不合法——报出来的是一条与失败原因毫无关系的 400。

⚠ `StateGraph.add_node` / `.add_conditional_edges` / `.compile` 在 langgraph
当前版本上是「部分未知类型」，pyright strict 会红。压制**全部收在
`_build_graph` 这一个函数里**：扩散出去之后，就没人知道到底有多少地方在跟这个
库的类型缝隙打交道了。
"""

import asyncio
import json
import operator
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from dataclasses import dataclass, field, replace
from typing import Annotated, Any, Protocol, TypedDict

from langchain_core.messages import AIMessage, BaseMessage, ToolMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from ai_assistant.apps.chat.services.tool_shapes import (
    ToolSpec,
    openai_schema,
)
from ai_assistant.apps.chat.services.turn_types import (
    ClientToolCall,
    TurnDelta,
    TurnOutcome,
    TurnStep,
)
from ai_assistant.llm import (
    DeltaChannel,
    DeltaSink,
    GuardedModel,
    ModelChoice,
)
from ai_assistant.settings import MAX_STEPS_PER_TURN, MAX_TOOL_RESULT_CHARS
from lib.logging import get_logger

_logger = get_logger("assistant.turn")

_THINK = "think"
_USE_TOOLS = "use_tools"

# 队列里表示「图跑完了」的哨兵。⚠ 不能用 `None`：图的产出里本来就可能有假值
_STOP = object()

# 一个回合往外吐的三种东西
TurnEvent = TurnDelta | TurnStep | TurnOutcome


class TurnState(TypedDict):
    """图里流动的状态。"""

    messages: Annotated[Sequence[BaseMessage], add_messages]
    steps: Annotated[list[TurnStep], operator.add]
    pending: tuple[ClientToolCall, ...]


class TurnUpdate(TypedDict, total=False):
    """节点回给图的**增量**。

    ⚠ 必须是部分更新，不能整份回。`messages` 与 `steps` 有累加规约，
    而 `pending` 没有——整份回的话，跑完服务端工具的那个节点会把上一步刚
    定下来的待办清成空，于是混合批次里的客户端工具**静默丢失**：
    服务端那几个跑了、浏览器什么也没收到、回合却显示正常结束。
    """

    messages: Sequence[BaseMessage]
    steps: list[TurnStep]
    pending: tuple[ClientToolCall, ...]


class ServerToolRunner(Protocol):
    """服务端工具的执行面。测试注一个假的进来。"""

    async def __call__(self, name: str, arguments: dict[str, Any]) -> Any: ...


@dataclass(frozen=True)
class TurnDeps:
    """跑一个回合要的那几样。"""

    model: GuardedModel
    specs: tuple[ToolSpec, ...]
    run_tool: ServerToolRunner
    # 这一轮用哪一路模型、哪一档。⚠ 每一轮现取而不是造图时定死：同一个会话
    # 里带图的那一轮要临时切到视觉档
    choice: ModelChoice = field(default_factory=ModelChoice)
    # 模型逐字吐出来的东西交给谁。⚠ 不给 = 不走流式：`run_turn` 那条路不需要
    # 增量，而流式会让每次作答多几百次回调
    on_delta: DeltaSink | None = None


async def run_turn(deps: TurnDeps, messages: list[BaseMessage]) -> TurnOutcome:
    """跑一个回合。停在等浏览器时 `pending` 非空。

    Args: deps, messages。
    """
    graph = _build_graph(deps)
    seed: TurnState = {"messages": messages, "steps": [], "pending": ()}
    final = await graph.ainvoke(seed, {"recursion_limit": MAX_STEPS_PER_TURN})
    return _outcome(final, len(messages))


async def stream_turn(
    deps: TurnDeps, messages: list[BaseMessage]
) -> AsyncIterator[TurnEvent]:
    """跑一个回合，**边跑边吐**：模型说的每一小块、走完的每一步，最后一个结果。

    ⚠ 存在的理由只有一个：界面要在回合进行中就看见助手在动。等回合整个跑完
    再一次性推，一次绑点要转十几秒的圈——而那期间助手一直在动，只是外面
    看不见（ADR-0023 的第二条决策）。

    ⚠ 增量与步骤走**同一条队列**。各走各的话，两侧的先后就由调度器决定，
    而界面上会出现「先看见结论、再看见推导」这种读起来像是乱序的东西。

    Args: deps, messages。
    """
    queue: asyncio.Queue[TurnEvent | object] = asyncio.Queue()
    worker = asyncio.create_task(
        _pump(replace(deps, on_delta=_pusher(queue)), messages, queue)
    )
    try:
        while True:
            item = await queue.get()
            if item is _STOP:
                break
            if isinstance(item, BaseException):
                raise item
            yield _as_event(item)
    finally:
        # ⚠ 消费方半途撒手（用户按了停）时必须掐掉：不掐的话图会一直跑到自己
        # 结束，而它每一步都在花模型的钱
        worker.cancel()


def _pusher(queue: asyncio.Queue[TurnEvent | object]) -> DeltaSink:
    """把模型增量塞进队列的那个口子。

    Args: queue。
    """

    def push(channel: DeltaChannel, text: str) -> None:
        queue.put_nowait(TurnDelta(channel=channel, text=text))

    return push


async def _pump(
    deps: TurnDeps,
    messages: list[BaseMessage],
    queue: asyncio.Queue[TurnEvent | object],
) -> None:
    """把图的产出灌进队列，失败也灌进去，最后放一个哨兵。

    ⚠ 失败走队列而不是让任务默默死掉：任务里抛出去的异常没人接，表现是
    「流突然停了、没有任何错」。

    Args: deps, messages, queue。
    """
    try:
        async for item in _walk(deps, messages):
            queue.put_nowait(item)
    # ⚠ 接住所有异常是刻意的：这一层只负责把它送到消费方手里，分档在那边做
    except Exception as error:
        queue.put_nowait(error)
    finally:
        queue.put_nowait(_STOP)


async def _walk(
    deps: TurnDeps, messages: list[BaseMessage]
) -> AsyncIterator[TurnStep | TurnOutcome]:
    """把图走一遍，每走完一步吐一步，最后吐一个结果。

    ⚠ 取的是**整份状态**而不是增量：增量要在这里把两个规约（消息追加、
    步骤追加）再实现一遍，而那份实现与图里那份一旦漂开，界面上会少一步或
    多一步，且只在特定的工具组合下才复现。

    Args: deps, messages。
    """
    graph = _build_graph(deps)
    seed: TurnState = {"messages": messages, "steps": [], "pending": ()}
    seen = 0
    latest: dict[str, Any] = {}
    async for state in graph.astream(  # type: ignore[reportUnknownMemberType]  # 理由：见文件头
        seed, {"recursion_limit": MAX_STEPS_PER_TURN}, stream_mode="values"
    ):
        latest = dict(state)
        steps = list(latest.get("steps") or [])
        for step in steps[seen:]:
            yield step
        seen = len(steps)
    yield _outcome(latest, len(messages))


def _as_event(item: TurnEvent | object) -> TurnEvent:
    """队列里取出来的那一格收成事件。

    ⚠ 收不成就抛：能进这条队列的只有三种东西加一个哨兵，多出第四种说明
    上面某处漏了分支，而静默丢弃会让界面少一整段。

    Args: item。
    """
    if isinstance(item, TurnDelta | TurnStep | TurnOutcome):
        return item
    raise TypeError(f"回合里冒出了一个不认识的东西：{type(item).__name__}")


def _build_graph(deps: TurnDeps) -> Any:
    """接线。本函数是与 langgraph 类型缝隙打交道的唯一一处。

    Args: deps。
    """
    graph = StateGraph(TurnState)
    graph.add_node(_THINK, _thinker(deps))  # type: ignore[reportUnknownMemberType]  # 理由：见文件头
    graph.add_node(_USE_TOOLS, _tool_step(deps))  # type: ignore[reportUnknownMemberType]  # 理由：见文件头
    graph.add_edge(START, _THINK)
    graph.add_conditional_edges(  # type: ignore[reportUnknownMemberType]  # 理由：见文件头
        _THINK, _after_think, {_USE_TOOLS: _USE_TOOLS, END: END}
    )
    graph.add_conditional_edges(  # type: ignore[reportUnknownMemberType]  # 理由：见文件头
        _USE_TOOLS, _after_tools, {_THINK: _THINK, END: END}
    )
    return graph.compile()  # type: ignore[reportUnknownMemberType]  # 理由：见文件头


def _thinker(deps: TurnDeps) -> Callable[[TurnState], Awaitable[TurnUpdate]]:
    """造出「问一次模型」这个节点。

    Args: deps。
    """
    client_names = frozenset(
        spec.name for spec in deps.specs if spec.runs_on == "client"
    )
    schemas = [openai_schema(spec) for spec in deps.specs]

    async def think(state: TurnState) -> TurnUpdate:
        reply = await deps.model.respond(
            choice=deps.choice,
            messages=list(state["messages"]),
            tools=schemas,
            on_delta=deps.on_delta,
        )
        pending = _client_calls(reply, client_names)
        return {
            "messages": [reply],
            "steps": [_model_step(reply)],
            "pending": pending,
        }

    return think


def _tool_step(
    deps: TurnDeps,
) -> Callable[[TurnState], Awaitable[TurnUpdate]]:
    """造出「跑服务端工具」这个节点。

    Args: deps。
    """
    client_names = frozenset(
        spec.name for spec in deps.specs if spec.runs_on == "client"
    )

    async def use_tools(state: TurnState) -> TurnUpdate:
        asked = _tool_calls(state["messages"])
        outputs: list[BaseMessage] = []
        steps: list[TurnStep] = []
        for call in asked:
            if call.name in client_names:
                continue
            message, step = await _run_one(deps.run_tool, call)
            outputs.append(message)
            steps.append(step)
        # ⚠ 不回 `pending`：上一步定下来的待办要原样留着
        return {"messages": outputs, "steps": steps}

    return use_tools


async def _run_one(
    run_tool: ServerToolRunner, call: ClientToolCall
) -> tuple[ToolMessage, TurnStep]:
    """跑一个服务端工具，成功失败都产出一条工具消息。

    Args: run_tool, call。
    """
    try:
        result = await run_tool(call.name, call.arguments)
    # ⚠ 接住所有异常是刻意的：一个工具坏掉不该炸掉整个回合，而模型拿到
    # 「这个工具失败了」之后往往能换一条路走
    except Exception as error:
        reason = f"{type(error).__name__}: {error}"
        _logger.warning("server_tool_failed", "服务端工具失败", tool=call.name)
        return (
            ToolMessage(content=f"失败：{reason}", tool_call_id=call.call_id),
            TurnStep(
                kind="server_tool",
                name=call.name,
                state="failed",
                title=f"{call.name} 没跑成",
                input_json=call.arguments,
                error=reason,
            ),
        )
    body = _clamped(json.dumps(result, ensure_ascii=False, default=str))
    return (
        ToolMessage(content=body, tool_call_id=call.call_id),
        TurnStep(
            kind="server_tool",
            name=call.name,
            state="succeeded",
            title=f"{call.name} 跑完了",
            input_json=call.arguments,
            # 落库供排障：工具当时到底回了什么。⚠ 存的是钳过的那份——
            # 原样存的话，一次超大结果每次重放这个会话都要再读一遍
            output_json={"body": body},
        ),
    )


def _clamped(body: str) -> str:
    """把工具产出钳在上限内，截断要**说出来**。

    ⚠ 不设上限的话，一次超大结果能把整个上下文挤掉，被挤走的正是工作面
    快照与技能正文；静默截断则会让模型把半份结果当成全部。

    Args: body。
    """
    if len(body) <= MAX_TOOL_RESULT_CHARS:
        return body
    kept = body[:MAX_TOOL_RESULT_CHARS]
    tail = f"……（产出太大已截断，共 {len(body)} 字。要看后面请缩小范围再调）"
    return f"{kept}\n{tail}"


def _after_think(state: TurnState) -> str:
    """想完之后往哪走：有服务端活先干，否则收工。

    Args: state。
    """
    asked = _tool_calls(state["messages"])
    pending_names = {call.name for call in state["pending"]}
    has_server = any(call.name not in pending_names for call in asked)
    return _USE_TOOLS if has_server else END


def _after_tools(state: TurnState) -> str:
    """服务端活干完之后：还欠浏览器就收工，否则回去接着想。

    Args: state。
    """
    return END if state["pending"] else _THINK


def _tool_calls(messages: Sequence[BaseMessage]) -> list[ClientToolCall]:
    """最后一条助手消息要调的工具。

    Args: messages。
    """
    for message in reversed(messages):
        if isinstance(message, AIMessage):
            return [
                ClientToolCall(
                    call_id=str(call.get("id") or ""),
                    name=str(call.get("name") or ""),
                    arguments=dict(call.get("args") or {}),
                )
                for call in message.tool_calls
            ]
    return []


def _client_calls(
    reply: AIMessage, client_names: frozenset[str]
) -> tuple[ClientToolCall, ...]:
    """这一批里要交给浏览器的那几个。

    Args: reply, client_names。
    """
    return tuple(
        call for call in _tool_calls([reply]) if call.name in client_names
    )


def _model_step(reply: AIMessage) -> TurnStep:
    """把一次模型作答记成一步。

    Args: reply。
    """
    count = len(reply.tool_calls)
    title = f"决定调用 {count} 个工具" if count else "给出答复"
    return TurnStep(kind="model", name="model", state="succeeded", title=title)


def _outcome(final: dict[str, Any], seeded: int) -> TurnOutcome:
    """把图跑完的状态收成回合结果。

    Args: final, seeded（喂进去时已有几条消息，之后的才算本回合新增）。
    """
    messages = list(final.get("messages") or [])
    pending = tuple(final.get("pending") or ())
    return TurnOutcome(
        messages=messages[seeded:],
        steps=list(final.get("steps") or []),
        pending=pending,
        reply=_last_text(messages),
    )


def _last_text(messages: Sequence[BaseMessage]) -> str:
    """最后一条助手消息的文本。

    Args: messages。
    """
    for message in reversed(messages):
        if isinstance(message, AIMessage):
            content = message.content
            return content if isinstance(content, str) else ""
    return ""
