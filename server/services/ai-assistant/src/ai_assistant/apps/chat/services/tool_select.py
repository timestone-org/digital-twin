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

from ai_assistant.apps.chat.services.tool_shapes import ToolSpec
from ai_assistant.apps.chat.services.tool_specs import TOOL_SPECS
from ai_assistant.apps.chat.skills import skills_for

# 哪个工作面都有的服务端工具：拉技能正文、写执行计划
CORE_SERVER_TOOLS = ("skills.load", "plan.write")

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
)


def specs_for(
    surface_kind: str, client_tools: Sequence[str] | None
) -> tuple[ToolSpec, ...]:
    """这一轮下发给模型的工具集，保持 `TOOL_SPECS` 的原序。

    Args: surface_kind, client_tools（前端自报的客户端工具名；None = 老前端，
        退回技能声明推导）。
    """
    skills = skills_for(surface_kind)
    server_allowed = {
        *CORE_SERVER_TOOLS,
        *CROSS_MODULE_READ_TOOLS,
        *(name for skill in skills for name in skill.server_tools),
    }
    client_allowed = (
        set(client_tools)
        if client_tools is not None
        else {name for skill in skills for name in skill.client_tools}
    )
    return tuple(
        spec
        for spec in TOOL_SPECS
        if spec.name
        in (server_allowed if spec.runs_on == "server" else client_allowed)
    )
