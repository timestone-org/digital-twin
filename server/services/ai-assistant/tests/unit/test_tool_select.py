"""工具下发过滤：模型只该看见这一页用得上、且这一页真实现了的工具。

这一层守的是一期那个「24 个工具全量下发」的回归：台账工具出现在大屏页上，
模型会先试一次、失败、再换路——三次往返换一个本可以不发生的错误。
"""

from ai_assistant.apps.chat.enums import SURFACE_KINDS
from ai_assistant.apps.chat.services.tool_select import (
    CORE_SERVER_TOOLS,
    CROSS_MODULE_READ_TOOLS,
    specs_for,
)
from ai_assistant.apps.chat.services.tool_specs import TOOL_SPECS

# 内建客户端工具：任何工作面上都该有，前提是这一页报了它
ASK = "user.ask"


def _names(surface: str, client_tools: list[str] | None) -> set[str]:
    return {spec.name for spec in specs_for(surface, client_tools)}


def test_core_tools_are_present_on_every_surface() -> None:
    for surface in ("dashboard-editor", "dataset-table", "collect-source"):
        names = _names(surface, [])
        assert set(CORE_SERVER_TOOLS) <= names


def test_dataset_tools_do_not_leak_onto_the_dashboard_surface() -> None:
    names = _names("dashboard-editor", None)
    assert "formula.validate" not in names
    assert "dataset.propose_formula" not in names


def test_interaction_tools_do_not_leak_onto_the_twin_surfaces() -> None:
    """联动规则与整屏外观住在大屏级 chromeJson，孪生舞台没有这一层。"""
    for surface in ("twin-editor", "twin2d-editor"):
        names = _names(surface, None)
        assert "dashboard.write_interaction" not in names
        assert "dashboard.set_page_style" not in names


def test_client_tools_follow_the_pages_own_report() -> None:
    names = _names("dashboard-editor", ["dashboard.read_canvas"])
    assert "dashboard.read_canvas" in names
    # 页面没报的客户端工具不下发——模型看得见也调不动
    assert "dashboard.write_binding" not in names


def test_an_empty_report_means_no_client_tools_at_all() -> None:
    names = _names("dashboard-editor", [])
    client = {spec.name for spec in TOOL_SPECS if spec.runs_on == "client"}
    assert names & client == set()


def test_without_a_report_the_skill_declarations_decide() -> None:
    """老前端不带 client_tools 时退回技能声明——宁可多见几个也不藏能用的。"""
    names = _names("dashboard-editor", None)
    assert "dashboard.write_binding" in names
    assert "dashboard.capture" in names


def test_unknown_reported_names_are_ignored() -> None:
    names = _names("dashboard-editor", ["dashboard.paint_it_gold"])
    assert "dashboard.paint_it_gold" not in names


def test_the_original_spec_order_is_kept() -> None:
    """顺序也是契约：工具在提示词里的先后影响模型的第一反应。"""
    picked = [spec.name for spec in specs_for("dashboard-editor", None)]
    reference = [spec.name for spec in TOOL_SPECS if spec.name in set(picked)]
    assert picked == reference


def test_the_ask_tool_is_offered_on_every_surface_that_reports_it() -> None:
    """`user.ask` 不归任何技能：报了就有，与在哪一页、装了哪些技能无关。"""
    for surface in SURFACE_KINDS:
        assert ASK in _names(surface, [ASK])


def test_the_ask_tool_is_not_offered_to_a_page_that_never_reported_it() -> None:
    """老前端不认识它，下发了模型就会调一个每次都失败的工具。

    两条路都要守：明说自己没有（空表），与压根不带这一格（None，退回技能
    声明推导——而没有任何技能声明它）。
    """
    for surface in SURFACE_KINDS:
        assert ASK not in _names(surface, [])
        assert ASK not in _names(surface, None)


def test_cross_module_read_tools_are_visible_on_every_surface() -> None:
    """跨模块读档在任何工作面都可见。

    这条也顺带守住「名单里的名字必须有对应规格」：`specs_for` 按
    `TOOL_SPECS` 过滤，规格缺席的名字在这里会以缺席暴露出来。
    """
    for surface in SURFACE_KINDS:
        names = _names(surface, [])
        assert set(CROSS_MODULE_READ_TOOLS) <= names
