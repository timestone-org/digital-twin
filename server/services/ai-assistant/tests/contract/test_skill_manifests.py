"""技能清单的形状。

这一层守的是「清单写歪了不会有任何运行期迹象」这类静默故障：
工作面写错的技能永远不出现、指令正文缺失的技能会被选中然后不带约束地乱做、
声明了不存在的工具会让模型调一个永远失败的名字。
"""

from ai_assistant.apps.chat.enums import SURFACE_KINDS
from ai_assistant.apps.chat.services import skill_catalog
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
