"""技能清单的形状。

这一层守的是「清单写歪了不会有任何运行期迹象」这类静默故障：
工作面写错的技能永远不出现、指令正文缺失的技能会被选中然后不带约束地乱做、
声明了不存在的工具会让模型调一个永远失败的名字。
"""

from ai_assistant.apps.chat.enums import SURFACE_KINDS
from ai_assistant.apps.chat.services import skill_catalog
from ai_assistant.apps.chat.services.plan import is_plan_tool
from ai_assistant.apps.chat.services.server_tools import ServerTools
from ai_assistant.apps.chat.services.tool_select import specs_for
from ai_assistant.apps.chat.services.tool_specs import TOOL_SPECS
from ai_assistant.apps.chat.skills import list_skills

# 登记名直接取自工具规格真源。⚠ 不许手抄一份：手抄的名单会让「技能声明了、
# 规格里没有」的幽灵工具在这道闸下安然过关
KNOWN_SERVER_TOOLS = frozenset(
    spec.name for spec in TOOL_SPECS if spec.runs_on == "server"
)

# 客户端工具由浏览器执行，前端的工作面必须实现同名的那一份
KNOWN_CLIENT_TOOLS = frozenset(
    spec.name for spec in TOOL_SPECS if spec.runs_on == "client"
)

# 2D 孪生工作面。⚠ 它的舞台是 SVG/DOM，截图那条链路只在大屏与 3D 替身上验过
TWIN_2D = "twin2d-editor"


def test_the_registry_is_not_empty() -> None:
    # 扫不到就等于下面每一条断言都恒真
    assert len(list_skills()) > 0


def test_every_skill_targets_only_registered_surfaces() -> None:
    unknown = {
        (skill.name, surface)
        for skill in list_skills()
        for surface in skill.surface_kinds
        if surface not in SURFACE_KINDS
    }
    assert unknown == set()


def test_every_skill_targets_at_least_one_surface() -> None:
    homeless = {
        skill.name for skill in list_skills() if not skill.surface_kinds
    }
    assert homeless == set()


def test_every_skill_declares_only_known_tools() -> None:
    unknown = {
        (skill.name, tool)
        for skill in list_skills()
        for tool in skill.server_tools
        if tool not in KNOWN_SERVER_TOOLS
    } | {
        (skill.name, tool)
        for skill in list_skills()
        for tool in skill.client_tools
        if tool not in KNOWN_CLIENT_TOOLS
    }
    assert unknown == set()


def test_every_skill_has_readable_instructions() -> None:
    empty = {
        skill.name
        for skill in list_skills()
        if not skill.instructions().strip()
    }
    assert empty == set()


def test_every_skill_summary_is_distinctive_enough_to_choose_by() -> None:
    # 简介是模型选技能时看到的**全部**信息，太短就等于让它瞎猜
    too_short = {
        skill.name for skill in list_skills() if len(skill.summary) < 12
    }
    assert too_short == set()


def test_the_catalog_never_leaks_instruction_bodies() -> None:
    fields = {name for entry in skill_catalog() for name in entry.model_dump()}
    assert "instructions" not in fields


def test_the_catalog_is_ordered_by_name() -> None:
    names = [entry.name for entry in skill_catalog()]
    assert names == sorted(names)


def _implemented() -> set[str]:
    """服务端工具的两个实现家：工具分派表，与计划子系统自己收走的那一个。"""
    return {
        *ServerTools()._handlers(),
        *(name for name in KNOWN_SERVER_TOOLS if is_plan_tool(name)),
    }


def test_every_server_tool_has_an_implementation_behind_it() -> None:
    """规格里有、没人实现的工具，模型看得见却每次调都失败。"""
    assert KNOWN_SERVER_TOOLS - _implemented() == set()


def test_the_dispatch_table_never_grows_a_tool_nobody_declared() -> None:
    # 反过来也守：实现了却没进规格的工具，模型永远看不见它
    assert set(ServerTools()._handlers()) - KNOWN_SERVER_TOOLS == set()


def test_the_2d_twin_surface_is_offered_the_binding_loop() -> None:
    offered = {spec.name for spec in specs_for(TWIN_2D, None)}
    assert {
        "dashboard.read_bindings",
        "dashboard.write_binding",
        "dashboard.copy_bindings",
        "dashboard.read_values",
        "dashboard.save",
        "points.resolve",
    } <= offered


def test_the_2d_twin_surface_is_never_offered_a_screenshot() -> None:
    """没验过的工具摆出来就是每次调都失败（AI_ASSISTANT_V3_PLAN §2.7）。"""
    offered = {spec.name for spec in specs_for(TWIN_2D, None)}
    assert "dashboard.capture" not in offered
