"""二维孪生工具按页面能力与权限下发，不泄漏到其它工作面。"""

from ai_assistant.apps.chat.services.intent.select import specs_for
from ai_assistant.apps.chat.skills import find_skill

TOOLS = {"twin2d.read_config", "twin2d.patch_config", "twin2d.diagnose"}


def test_twin2d_tools_require_the_current_page_report_and_edit_permission() -> (
    None
):
    offered = specs_for(
        "twin2d-editor", sorted(TOOLS), codes=frozenset({"dashboard:edit"})
    )
    assert {spec.name for spec in offered} >= TOOLS
    for surface, report, codes in (
        ("twin2d-editor", [], frozenset({"dashboard:edit"})),
        ("twin2d-editor", sorted(TOOLS), frozenset()),
        ("twin-editor", sorted(TOOLS), frozenset({"dashboard:edit"})),
        ("twin2d-editor", None, frozenset({"dashboard:edit"})),
    ):
        assert not TOOLS & {
            spec.name for spec in specs_for(surface, report, codes=codes)
        }


def test_twin2d_skill_preserves_the_draft_and_real_execution_contract() -> None:
    skill = find_skill("twin2d-configure")
    assert skill is not None
    assert skill.required_codes == ("dashboard:edit",)
    assert set(skill.client_tools) >= TOOLS
    assert "dashboard.save" not in skill.client_tools
    assert "草稿" in skill.instructions()
    assert "诊断" in skill.instructions()
