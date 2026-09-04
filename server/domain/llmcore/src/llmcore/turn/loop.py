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
from langchain_core.messages.tool import ToolCall
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages

from lib.logging import get_logger
from llmcore import (
    DeltaChannel,
    DeltaSink,
    ModelChoice,
)
from llmcore.deltas import text_of
from llmcore.memory.history import sized
from llmcore.textcalls import salvage
from llmcore.tools.shapes import (
    ToolSpec,
    openai_schema,
)
from llmcore.turn.ports import Responder
from llmcore.turn.types import (
    ClientToolCall,
    TurnDelta,
    TurnOutcome,
    TurnStep,
)

# 一个回合最多走几步。⚠ 24 是助手上跑出来的经验值：够一次「查—改—核对」的
# 完整来回，又不至于让模型与工具互相喂到把上下文填满
DEFAULT_MAX_STEPS = 24
# 单个工具产出的字数上限。⚠ 不设上限的话，一次超大结果能把整个上下文挤掉
DEFAULT_MAX_TOOL_RESULT_CHARS = 20_000
# 再挤也要给工具产出留这么多字。⚠ 回一个空壳会被模型读成「查过了，没有」，
# 而那与「这个库里确实没这句话」分辨不出来
MIN_TOOL_RESULT_CHARS = 400

# ⚠ 记作 `chat.turn` 而不是 `assistant.turn`：这一份被两个服务共用，写死某一家
# 的名字会让另一家的日志谎报出处。哪个服务发的由日志信封里的 `service` 字段答
_logger = get_logger("chat.turn")

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

    model: Responder
    specs: tuple[ToolSpec, ...]
    run_tool: ServerToolRunner
    # 这一轮用哪一路模型、哪一档。⚠ 每一轮现取而不是造图时定死：同一个会话
    # 里带图的那一轮要临时切到视觉档
    choice: ModelChoice = field(default_factory=ModelChoice)
    # 模型逐字吐出来的东西交给谁。⚠ 不给 = 不走流式：`run_turn` 那条路不需要
    # 增量，而流式会让每次作答多几百次回调
    on_delta: DeltaSink | None = None
    # 一个回合最多走几步。⚠ 没有上限时，模型与工具可以互相喂到把整个上下文
    # 填满，而每一步都在花钱
    max_steps: int = DEFAULT_MAX_STEPS
    # 整段上下文的字数预算；0 = 不知道模型的窗口，一格都不收紧。⚠ 与上面那格
    # 是两条判据：那一格管「一次产出别太大」，这一格管「这一**轮**加起来别顶穿
    # 窗口」。只有前者的表现是——一个回合里连查三次的那种问题每次都在同一步
    # 400，而单看每一次产出都在上限之内（实测 n_ctx=6656 的本地端点）
    max_context_chars: int = 0
    # 单个工具产出的字数上限，超了截断并说出来（见 `_clamped`）
    max_tool_result_chars: int = DEFAULT_MAX_TOOL_RESULT_CHARS


async def run_turn(deps: TurnDeps, messages: list[BaseMessage]) -> TurnOutcome:
    """跑一个回合。停在等浏览器时 `pending` 非空。

    Args: deps, messages。
    """
    graph = _build_graph(deps)
    seed: TurnState = {"messages": messages, "steps": [], "pending": ()}
    final = await graph.ainvoke(seed, {"recursion_limit": deps.max_steps})
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
        seed, {"recursion_limit": deps.max_steps}, stream_mode="values"
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
    overhead = _overhead(schemas)
    offered = frozenset(spec.name for spec in deps.specs)

    async def think(state: TurnState) -> TurnUpdate:
        used = _used(state["messages"], overhead)
        answered = await deps.model.respond(
            choice=deps.choice,
            messages=list(state["messages"]),
            tools=schemas if _has_room(deps, used) else [],
            on_delta=deps.on_delta,
        )
        reply = _salvaged(answered, offered)
        pending = _client_calls(reply, client_names)
        return {
            "messages": [reply],
            "steps": [_model_step(reply)],
            "pending": pending,
        }

    return think


def _salvaged(reply: AIMessage, offered: frozenset[str]) -> AIMessage:
    """模型把调用写成正文时，把它捡回成真的 `tool_calls`。

    ⚠ 只在**一个原生调用都没有**时才捡：有原生调用还去翻正文的话，模型在
    正文里复述自己刚发的那次调用会被执行两遍。

    ⚠ 捡回来的调用照常走注册表、照常记步骤——这里只换一条消息的形状，不执行
    任何东西（`textcalls` 文件头）。

    Args: reply, offered（这一轮真发下去过的工具名）。
    """
    if reply.tool_calls:
        return reply
    made = salvage(text_of(reply), offered)
    if not made.calls:
        return reply
    # ⚠ 响亮记一条：端点没解析出 tool_calls 是它那一侧的毛病，而捡回来之后
    # 一切看着都正常——不记的话，这套部署会一直靠兜底跑着，没人知道
    _logger.warning(
        "tool_call_salvaged",
        "模型把工具调用写进了正文，已捡回",
        tools=",".join(one.name for one in made.calls),
    )
    # ⚠ 用量与端点元数据要原样带过去：换一条消息不该顺手把这一次调用的账
    # 也丢掉（`guard.usage_of` 读的就是这几格）
    return AIMessage(
        content=made.text,
        tool_calls=[
            ToolCall(id=f"salvaged-{at}", name=one.name, args=one.arguments)
            for at, one in enumerate(made.calls, start=1)
        ],
        additional_kwargs=reply.additional_kwargs,
        response_metadata=reply.response_metadata,
        usage_metadata=reply.usage_metadata,
    )


def _tool_step(
    deps: TurnDeps,
) -> Callable[[TurnState], Awaitable[TurnUpdate]]:
    """造出「跑服务端工具」这个节点。

    Args: deps。
    """
    client_names = frozenset(
        spec.name for spec in deps.specs if spec.runs_on == "client"
    )
    overhead = _overhead([openai_schema(spec) for spec in deps.specs])

    async def use_tools(state: TurnState) -> TurnUpdate:
        asked = _tool_calls(state["messages"])
        outputs: list[BaseMessage] = []
        steps: list[TurnStep] = []
        used = _used(state["messages"], overhead)
        for call in asked:
            if call.name in client_names:
                continue
            message, step = await _run_one(
                deps.run_tool, call, _room(deps, used)
            )
            outputs.append(message)
            steps.append(step)
            used += sized(message)
        # ⚠ 不回 `pending`：上一步定下来的待办要原样留着
        return {"messages": outputs, "steps": steps}

    return use_tools


async def _run_one(
    run_tool: ServerToolRunner, call: ClientToolCall, max_chars: int
) -> tuple[ToolMessage, TurnStep]:
    """跑一个服务端工具，成功失败都产出一条工具消息。

    Args: run_tool, call, max_chars。
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
    body = _clamped(
        json.dumps(result, ensure_ascii=False, default=str), max_chars
    )
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


def _overhead(schemas: Sequence[dict[str, Any]]) -> int:
    """工具声明本身占多少字。

    ⚠ 每一次调用都要**连工具声明一起**发出去，而它不在消息列表里。不算进去的
    表现是：预算算得比真实宽出一大截，于是「按剩余地方收紧」这条闸看着在起
    作用、实际每一轮都往上飘，最后还是 400（实测那台端点上，声明加提示词的
    固定前缀就将近 2000 token）。

    Args: schemas。
    """
    return len(json.dumps(schemas, ensure_ascii=False))


def _used(messages: Sequence[BaseMessage], overhead: int) -> int:
    """这一轮到此刻占了多少字，连工具声明一起。

    Args: messages, overhead。
    """
    return overhead + sum(sized(one) for one in messages)


def _has_room(deps: TurnDeps, used: int) -> bool:
    """还有地方再查一次吗。

    ⚠ 没地方了就**不再下发工具**，让模型拿现有资料作答。继续下发的表现是它
    接着查、每次只拿得到几百字、而上下文仍在往上飘——最后整个回合以一句
    「模型端点认为请求不合法」告终，用户一个字都拿不到。少答几条总比不答好。

    Args: deps, used。
    """
    if deps.max_context_chars <= 0:
        return True
    return used + MIN_TOOL_RESULT_CHARS < deps.max_context_chars


def _room(deps: TurnDeps, used: int) -> int:
    """这一次的工具产出还剩多少地方。

    ⚠ 一个回合里连查三次是常事，而每一次都在单次上限之内——顶穿窗口的是**它们
    加起来**。按剩余地方逐次收紧之后，后面几次拿到的越来越少，模型据此收手，
    而不是整个回合以一句「模型端点认为请求不合法」告终。

    ⚠ 地方不够时也留 `MIN_TOOL_RESULT_CHARS`：回一个空壳与回一句「已截断」在
    模型眼里是两件事，前者会被读成「查过了，没有」。

    Args: deps, used（这一轮已经占掉多少字）。
    """
    if deps.max_context_chars <= 0:
        return deps.max_tool_result_chars
    left = deps.max_context_chars - used
    return max(MIN_TOOL_RESULT_CHARS, min(deps.max_tool_result_chars, left))


def _clamped(body: str, max_chars: int) -> str:
    """把工具产出钳在上限内，截断要**说出来**。

    ⚠ 不设上限的话，一次超大结果能把整个上下文挤掉，被挤走的正是常驻提示词
    与技能正文；静默截断则会让模型把半份结果当成全部。

    Args: body, max_chars。
    """
    if len(body) <= max_chars:
        return body
    kept = body[:max_chars]
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
    made = TurnOutcome(
        messages=messages[seeded:],
        steps=list(final.get("steps") or []),
        pending=pending,
        reply=_last_text(messages),
    )
    if not made.reply and not made.is_waiting:
        # ⚠ 响亮记一条：回合正常结束、每一步都成功，而模型一个字都没说。
        # 实测小模型会把话全说进思考那一路然后收嘴，界面上是一片空白——不记的
        # 话，这一类「问完之后什么也没发生」在日志里查不出任何异常。
        # ⚠ 记在这里而不是某一条路上：`run_turn` 与 `stream_turn` 都从这里出结果
        _logger.warning(
            "turn_said_nothing",
            "回合结束了，模型一个字都没说",
            steps=len(made.steps),
        )
    return made


def _last_text(messages: Sequence[BaseMessage]) -> str:
    """最后一条助手消息的文本。

    ⚠ `content` 可能是**一串块**而不是一个字符串：带思考摘要的那几路
    （Responses 方言）把摘要与正文分别放进 `reasoning` 与 `text` 块里。当成
    字符串取的表现极难认——回合看着答完了，答案也确实流到了界面上（增量是
    另一条路），只有**依赖 `reply` 的东西**静默失灵：知识库那边靠它扫角标出
    引用，于是引用一条都不出，而日志里没有任何异常。

    Args: messages。
    """
    for message in reversed(messages):
        if isinstance(message, AIMessage):
            return text_of(message)
    return ""
