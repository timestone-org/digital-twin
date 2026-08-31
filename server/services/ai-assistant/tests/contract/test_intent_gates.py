"""层 2 的收窄：每一道都只许把集合变小。

放宽的那一道会把前面几道的判断一笔勾销，而顺序一换结果就变——那时
「为什么这个工具有时在有时不在」没人答得上来。

⚠ 这一层**不是权限边界**，只是省一次往返。工具最终调 platform，由那边按端点
判权限（`CONTEXT.md` §2）。这里的用例只能证明「模型少看见了几个」，
证明不了「这个人拿不到那份数据」。
"""

import pytest

from ai_assistant.apps.chat.services.intent import (
    GATES,
    Allowed,
    Gate,
    PermissionGate,
    TurnContext,
    narrow_all,
    specs_for,
)

# 一个持全码的调用者。⚠ 用真实技能声明过的码，编的码证明不了这道闸真的在读它们
ALL_CODES = frozenset({"dashboard:edit", "collect:view", "dataset:manage"})


def _context(codes: frozenset[str] | None) -> TurnContext:
    return TurnContext(
        surface_kind="dashboard-editor", client_tools=None, codes=codes
    )


def _everything() -> Allowed:
    return Allowed(
        tools=frozenset({"a", "b"}),
        skills=frozenset(
            {
                "dashboard-binding",
                "dashboard-compose",
                "dashboard-interact",
                "dashboard-review",
            }
        ),
    )


@pytest.mark.parametrize("gate", GATES, ids=lambda one: one.name)
@pytest.mark.parametrize("codes", [None, frozenset(), ALL_CODES])
def test_a_gate_only_ever_shrinks(
    gate: Gate, codes: frozenset[str] | None
) -> None:
    """产出必须是入参的子集，一道都不许放宽。"""
    start = _everything()
    got = gate.narrow(_context(codes), start)
    assert got.tools <= start.tools
    assert got.skills <= start.skills


def test_no_codes_given_means_no_narrowing_at_all() -> None:
    """`None` 是「调用方没给权限信息」，不是「一个码都没有」。

    混成一个的话，忘了传的调用点会把所有技能静默藏光，
    而现象是「助手忽然什么都不会了」。
    """
    start = _everything()
    assert narrow_all(_context(None), start) == start


def test_an_empty_code_set_drops_the_skills_that_need_codes() -> None:
    """空集是真的一个码都没有，该收窄的一个不留。"""
    got = narrow_all(_context(frozenset()), _everything())
    assert got.skills == frozenset()


def test_holding_every_code_keeps_every_skill() -> None:
    """持全码的人看得见这一页上的全部技能。"""
    start = _everything()
    assert narrow_all(_context(ALL_CODES), start).skills == start.skills


def test_a_partial_code_set_keeps_only_what_it_covers() -> None:
    """只持 `dashboard:edit` 时，还要 `collect:view` 的那个技能进不来。"""
    got = PermissionGate().narrow(
        _context(frozenset({"dashboard:edit"})), _everything()
    )
    # 绑点技能要 dashboard:edit + collect:view 两个码
    assert "dashboard-binding" not in got.skills
    assert "dashboard-compose" in got.skills


def test_an_unknown_skill_name_is_let_through() -> None:
    """认不出的名字放行：那多半是这一层与注册表漂开了，藏掉更难查。"""
    got = PermissionGate().narrow(
        _context(frozenset()),
        Allowed(tools=frozenset(), skills=frozenset({"no-such-skill"})),
    )
    assert got.skills == frozenset({"no-such-skill"})


def test_dropping_a_skill_also_drops_the_tools_only_it_declared() -> None:
    """收窄先跑、再由活下来的技能推工具。

    反过来的话，被拦掉的技能贡献的那几个服务端工具还留在表上，模型照样看得见、
    照样调一次被 platform 拒——这道闸就白设了。
    """
    with_codes = {one.name for one in specs_for("dataset-table", [], ALL_CODES)}
    without = {one.name for one in specs_for("dataset-table", [], frozenset())}
    # 写公式技能要 dataset:manage，它带来的服务端工具跟着它一起走
    assert "formula.validate" in with_codes
    assert "formula.validate" not in without


def test_the_core_tools_survive_even_with_no_codes_at_all() -> None:
    """核心档不归任何技能，收窄不该把它们带走——带走了助手连技能都拉不动。"""
    names = {one.name for one in specs_for("dashboard-editor", [], frozenset())}
    assert {"skills.load", "plan.write"} <= names
