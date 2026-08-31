"""计划子系统：入参校验、纪律扶正、渲染与「当前项点名」。

这一层守的是 ADR-0024 的三件事：整份重写要收得住模型的坏输入、
渲染时当前项必须单独点名、完结的计划不再占提示词。
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.services.planning import plan as plan_service
from ai_assistant.apps.chat.services.planning.plan import (
    MAX_PLAN_ITEMS,
    PlanInvalid,
    is_plan_tool,
    plan_of,
    render,
)


def test_only_plan_write_belongs_to_the_plan_subsystem() -> None:
    assert is_plan_tool("plan.write")
    assert not is_plan_tool("points.search")


def test_a_minimal_plan_gets_defaults_filled() -> None:
    plan = plan_of({"items": [{"title": "绑温度槽"}]})
    assert plan["state"] == "active"
    assert plan["items"] == [
        {"title": "绑温度槽", "status": "pending", "note": ""}
    ]


def test_items_must_be_a_nonempty_list() -> None:
    with pytest.raises(PlanInvalid):
        plan_of({"items": []})
    with pytest.raises(PlanInvalid):
        plan_of({"items": "绑点"})


def test_an_item_without_title_is_rejected() -> None:
    with pytest.raises(PlanInvalid):
        plan_of({"items": [{"status": "pending"}]})


def test_an_unknown_status_is_rejected() -> None:
    with pytest.raises(PlanInvalid):
        plan_of({"items": [{"title": "a", "status": "doing"}]})


def test_an_oversized_plan_is_rejected() -> None:
    items = [{"title": f"第 {i} 步"} for i in range(MAX_PLAN_ITEMS + 1)]
    with pytest.raises(PlanInvalid):
        plan_of({"items": items})


def test_only_the_first_in_progress_survives() -> None:
    """纪律问题就地扶正，不值得为它多一次往返。"""
    plan = plan_of(
        {
            "items": [
                {"title": "a", "status": "in_progress"},
                {"title": "b", "status": "in_progress"},
            ]
        }
    )
    statuses = [one["status"] for one in plan["items"]]
    assert statuses == ["in_progress", "pending"]


def test_a_fully_terminal_plan_is_done() -> None:
    plan = plan_of(
        {
            "items": [
                {"title": "a", "status": "done"},
                {"title": "b", "status": "skipped"},
                {"title": "c", "status": "failed"},
            ]
        }
    )
    assert plan["state"] == "done"


def test_render_names_the_in_progress_item() -> None:
    """当前项必须单独点名——埋在清单里模型会接着做别的项。"""
    plan = plan_of(
        {
            "title": "绑完整屏",
            "items": [
                {"title": "读画布", "status": "done"},
                {"title": "绑温度槽", "status": "in_progress"},
                {"title": "截图自检"},
            ],
        }
    )
    body = render(plan)
    assert "你正在做第 2 项：**绑温度槽**" in body
    assert "[x] 读画布" in body
    assert "[>] 绑温度槽" in body
    assert "[ ] 截图自检" in body


def test_render_points_to_the_next_pending_item_when_idle() -> None:
    plan = plan_of(
        {
            "items": [
                {"title": "读画布", "status": "done"},
                {"title": "绑温度槽"},
            ]
        }
    )
    assert "下一项是第 2 项：**绑温度槽**" in render(plan)


def test_a_done_plan_renders_to_nothing() -> None:
    """完结的计划不再占提示词的一个字。"""
    plan = plan_of({"items": [{"title": "a", "status": "done"}]})
    assert render(plan) == ""
    assert render(None) == ""


def test_notes_survive_into_the_rendering() -> None:
    plan = plan_of(
        {"items": [{"title": "a", "status": "failed", "note": "点位不存在"}]}
    )
    plan["items"].append({"title": "b", "status": "pending", "note": ""})
    plan["state"] = "active"
    assert "（点位不存在）" in render(plan)


async def test_plan_tools_reject_unknown_names() -> None:
    tools = plan_service.PlanTools(
        sessions=_refuse_sessions, chat_session_id=uuid.uuid4()
    )
    with pytest.raises(PlanInvalid):
        await tools.run("plan.explode", {})


def _refuse_sessions() -> "_NeverOpen":
    return _NeverOpen()


class _NeverOpen:
    """开库即失败的口子：这些用例根本不该碰库。"""

    async def __aenter__(self) -> AsyncSession:
        raise AssertionError("这个用例不该开数据库会话")

    async def __aexit__(self, *args: object) -> None:
        return None
