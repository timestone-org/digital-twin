"""技能注册表的查找口径。

守的是「工作面一换，可用技能集跟着变」：漏了这条，助手会在台账页上摆出
大屏组态的技能，而那些技能的工具在那一页一个都执行不了。
"""

from pathlib import Path

import pytest

from ai_assistant.apps.chat.services import skills_of_surface
from ai_assistant.apps.chat.services.tools.specs import TOOL_SPECS
from ai_assistant.apps.chat.skills import (
    SkillInstructionsMissing,
    SkillManifest,
    find_skill,
    list_skills,
    skills_for,
)


def test_every_registered_skill_has_a_unique_name() -> None:
    names = [skill.name for skill in list_skills()]
    assert len(names) == len(set(names))


def test_find_skill_returns_none_for_an_unknown_name() -> None:
    assert find_skill("no-such-skill") is None


def test_find_skill_returns_the_manifest_for_a_known_name() -> None:
    skill = find_skill("dashboard-binding")
    assert skill is not None
    assert skill.title == "批量绑点"


def test_dataset_surface_only_offers_the_formula_skill() -> None:
    names = {skill.name for skill in skills_for("dataset-table")}
    assert names == {"formula-author"}


def test_dashboard_editor_offers_every_dashboard_skill() -> None:
    names = {skill.name for skill in skills_for("dashboard-editor")}
    assert names == {
        "dashboard-binding",
        "dashboard-compose",
        "dashboard-interact",
        "dashboard-review",
    }


def test_twin_editor_offers_binding_and_review() -> None:
    # 看图技能也在列：孪生视口的截图走「先画一帧再拷」的替身，3D 画面截得到
    names = {skill.name for skill in skills_for("twin-editor")}
    assert names == {"dashboard-binding", "dashboard-review"}


def test_an_unknown_surface_offers_nothing() -> None:
    assert skills_for("no-such-surface") == ()


def test_surface_listing_carries_the_same_names_as_the_registry() -> None:
    listed = {entry.name for entry in skills_of_surface("twin-editor")}
    registered = {skill.name for skill in skills_for("twin-editor")}
    assert listed == registered


def test_instructions_missing_is_reported_loudly() -> None:
    # 空指令的技能仍会被模型选中，然后不带任何约束地乱做——比「不存在」难查
    orphan = SkillManifest(
        name="orphan",
        title="无正文",
        summary="指令正文缺失的技能",
        surface_kinds=("dashboard-editor",),
        directory=Path("/no/such/skill/directory"),
    )
    with pytest.raises(SkillInstructionsMissing):
        orphan.instructions()


def test_every_tool_a_skill_names_really_exists() -> None:
    """技能点名的工具都在总表里。

    ⚠ 写错一个字的表现不是报错，而是模型看得见那个工具、每次调用都失败——
    与「这一页没实现它」一模一样，只能靠这条兜。
    """
    known = {spec.name for spec in TOOL_SPECS}
    named = {
        name
        for skill in list_skills()
        for name in (*skill.server_tools, *skill.client_tools)
    }

    assert sorted(named - known) == []


def test_skills_do_not_mix_up_the_two_sides() -> None:
    """服务端工具不许出现在 `client_tools` 里，反之亦然。

    ⚠ 摆错一侧同样静默：客户端那批要靠页面报了才下发，把一个服务端工具写进
    `client_tools`，它就只在恰好报了同名的页面上出现。
    """
    side = {spec.name: spec.runs_on for spec in TOOL_SPECS}
    offenders = [
        f"{skill.name}.{name}({side.get(name)})"
        for skill in list_skills()
        for name, want in (
            *((one, "server") for one in skill.server_tools),
            *((one, "client") for one in skill.client_tools),
        )
        if side.get(name) != want
    ]

    assert offenders == []
