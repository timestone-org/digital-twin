"""按工作面与页面自报，挑出这一轮模型看得见的工具。

⚠ 一期是 24 个工具全量下发，不管用户在哪一页。台账工具在大屏页是纯噪声——
模型会先试一次、失败、再换路，三次往返换一个本可以不发生的错误。

分档规则：

- **服务端工具** = 核心档（哪个工作面都在）+ 这一面技能声明过的 + 跨模块只读档。
- **客户端工具**按前端自报过滤：页面把自己实现了哪些工具随每轮上报
  （`AdvanceIn.client_tools`），没实现的模型看不见。老前端不带这一格时退回
  技能声明推导——宁可多见几个也不许把能用的藏掉。

⚠ `user.ask` 是**内建**客户端工具：它不归任何技能，靠的正是上面那条自报过滤
——报了就下发，与在哪一页、装了哪些技能无关。**不要把它写进某个技能的
`client_tools`**：那样一来老前端那条退回推导也会把它发出去，而老前端不认识它，
模型就会调一个每次都失败的工具。
"""

from collections.abc import Sequence

from ai_assistant.apps.chat.services.intent.registry import narrow_all
from ai_assistant.apps.chat.services.tools.specs import TOOL_SPECS
from ai_assistant.apps.chat.skills import skills_for
from llmcore.intent.ports import Allowed, TurnContext
from llmcore.tools.selection import specs_named
from llmcore.tools.shapes import ToolSpec

# 哪个工作面都有的服务端工具：拉技能正文、写执行计划
CORE_SERVER_TOOLS = ("skills.load", "plan.write")

# 长期记忆档：助手自己的记忆，不碰任何业务数据，故不受工作面约束
# （ADR-0030）。⚠ `memory.remember` 是写动作却进了这一档——它写的是助手自己
# schema 里那张表、按签名身份隔离，与「替用户改业务数据」不是一回事；
# 跟着工作面走反而会让「在台账页交代的口径，回大屏页就查不到」
CROSS_MODULE_MEMORY_TOOLS: tuple[str, ...] = (
    "memory.remember",
    "memory.search",
)

# 跨模块只读档：任何工作面都能查的东西（V2_PLAN §3 的读侧）。
# ⚠ 只进只读工具。写动作跟着它的工作面与确认界面走，不进这一档
CROSS_MODULE_READ_TOOLS: tuple[str, ...] = (
    "points.list_sources",
    "points.search",
    "points.detail",
    "points.resolve",
    "dashboards.list",
    "datasets.list_tables",
    "datasets.read_columns",
    "assets.search",
    # 知识库的读侧。⚠ 与点位、大屏那几个同一档：问一句资料这件事与用户站在
    # 哪一页无关，跟着工作面走反而会让「在大屏页问得到的，回台账页就问不到」
    "knowledge.list_bases",
    "knowledge.search",
)


def allowed_for(context: TurnContext) -> Allowed:
    """这一轮准许出现的**名字集合**，工具与技能各一份。

    ⚠ 收窄先跑、再由活下来的技能推工具：反过来的话，被权限拦掉的技能贡献的
    那几个服务端工具还留在表上，模型照样看得见、照样调一次被 platform 拒。

    ⚠ 两侧的名字合成一个集合是安全的：一个工具名只属于一路 provider，
    重名在装配期就被 `tools/registry.py` 的 `DuplicateTool` 拦掉了。

    Args: context。
    """
    on_surface = skills_for(context.surface_kind)
    gated = narrow_all(
        context,
        Allowed(
            tools=frozenset(spec.name for spec in TOOL_SPECS),
            skills=frozenset(skill.name for skill in on_surface),
        ),
    )
    kept = tuple(one for one in on_surface if one.name in gated.skills)
    server_allowed = {
        *CORE_SERVER_TOOLS,
        *CROSS_MODULE_MEMORY_TOOLS,
        *CROSS_MODULE_READ_TOOLS,
        *(name for skill in kept for name in skill.server_tools),
    }
    client_allowed = (
        set(context.client_tools)
        if context.client_tools is not None
        else {name for skill in kept for name in skill.client_tools}
    )
    named = {
        spec.name
        for spec in TOOL_SPECS
        if spec.name
        in (server_allowed if spec.runs_on == "server" else client_allowed)
    }
    return Allowed(tools=frozenset(named) & gated.tools, skills=gated.skills)


def specs_for(
    surface_kind: str,
    client_tools: Sequence[str] | None,
    codes: frozenset[str] | None = None,
    extra: Sequence[ToolSpec] = (),
) -> tuple[ToolSpec, ...]:
    """这一轮下发给模型的工具集，保持 `TOOL_SPECS` 的原序。

    这是两层的合成口：层 2 出名字（`allowed_for`），层 5 按名字取规格
    （`tools/selection.py`）。合成口留着是因为调用方只关心「这一轮发哪些」。

    ⚠ `extra` 是**逐轮才知道**的那几个（眼下只有 MCP：某一路连不上时它的工具
    这一轮就不在），一律放在末尾且不过技能过滤——它们是部署方显式装上的，
    不归任何技能，与 `user.ask` 那条「报了就下发」同一个道理。

    ⚠ 放末尾不是审美：工具声明属于前缀缓存唯一能命中的那一段（ADR-0025 的
    B 层），把逐轮可变的那几个排在前面，会让后面所有内建工具的声明整体位移。

    Args: surface_kind, client_tools（前端自报的客户端工具名；None = 老前端，
        退回技能声明推导）, codes（调用者持有的权限码；None = 没给，不按权限
        收窄）, extra（这一轮额外可用的工具规格）。
    """
    allowed = allowed_for(
        TurnContext(
            surface_kind=surface_kind,
            client_tools=None if client_tools is None else tuple(client_tools),
            codes=codes,
        )
    )
    return specs_named(TOOL_SPECS, allowed.tools) + tuple(extra)
