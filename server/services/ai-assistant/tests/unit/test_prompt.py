"""常驻提示词：只放名字与简介，正文按需拉。

守的是上下文工程的主轴。四份技能正文全铺进去会占掉上下文的前三分之一，
而被挤掉的是工作面快照与工具结果——模型真正需要看的那些东西，
且挤掉了哪一段从外面完全看不出来。
"""

from ai_assistant.apps.chat.services.prompt import build_system_prompt
from ai_assistant.apps.chat.skills import find_skill, skills_for

# 常驻部分的字数上限。松一点没关系，它拦的是「有人把整份正文铺进来」
MAX_CHARS = 1500


def test_the_roster_lists_every_skill_of_the_surface() -> None:
    prompt = build_system_prompt("dashboard-editor")
    for skill in skills_for("dashboard-editor"):
        assert skill.name in prompt


def test_the_roster_hides_skills_from_other_surfaces() -> None:
    prompt = build_system_prompt("dashboard-editor")
    # 让模型看见它在这一页根本调不动的技能，只会让它先试一次、失败、再换
    assert "formula-author" not in prompt


def test_a_surface_without_skills_says_so() -> None:
    prompt = build_system_prompt("collect-source")
    assert "没有可用的技能" in prompt


def test_the_resident_prompt_never_carries_a_skill_body() -> None:
    prompt = build_system_prompt("dashboard-editor")
    body = find_skill("dashboard-binding")
    assert body is not None
    # 正文的小标题一个都不该出现在常驻部分里
    assert "## 工作顺序" not in prompt
    assert len(prompt) < MAX_CHARS


def test_the_prompt_tells_the_model_how_to_pull_a_skill() -> None:
    prompt = build_system_prompt("dashboard-editor")
    assert "skills.load" in prompt


def test_the_prompt_spells_out_the_three_kinds_of_node() -> None:
    # 不说清的话模型会把三种「节点」混着叫，而用户读不出它在说哪一个
    prompt = build_system_prompt("dashboard-editor")
    assert "画布节点" in prompt
    assert "地址空间节点" in prompt


def test_the_prompt_says_who_presses_save() -> None:
    prompt = build_system_prompt("dashboard-editor")
    assert "不替他保存" in prompt


def test_an_active_plan_is_rendered_with_the_current_item_named() -> None:
    plan = {
        "title": "绑完整屏",
        "state": "active",
        "items": [
            {"title": "读画布", "status": "done", "note": ""},
            {"title": "绑温度槽", "status": "in_progress", "note": ""},
        ],
    }
    body = build_system_prompt("dashboard-editor", plan=plan)
    assert "## 当前计划" in body
    assert "你正在做第 2 项：**绑温度槽**" in body


def test_a_done_plan_takes_no_space() -> None:
    plan = {
        "title": "",
        "state": "done",
        "items": [{"title": "a", "status": "done", "note": ""}],
    }
    body = build_system_prompt("dashboard-editor", plan=plan)
    assert "## 当前计划" not in body


def test_the_plan_discipline_is_resident() -> None:
    body = build_system_prompt("dashboard-editor")
    assert "plan.write" in body
    assert "截图自检" in body
