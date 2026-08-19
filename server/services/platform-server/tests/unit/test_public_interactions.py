"""公开面的联动规则改写。

⚠ 守两件事：内部大屏 id 一个字都不出门（ADR-0014），以及**跳不到的规则整条
不下发**——留着规则，源控件仍摆出可点击外观、点下去什么也不发生，正是本仓
一路在躲的那种「点了没反应」（DASHBOARD_NAV_DESIGN §4）。
"""

import json
import uuid
from typing import Any

from platform_server.apps.dashboard.services.public_interactions import (
    navigate_target_ids,
    public_chrome,
)

TARGET = uuid.UUID("0198f0c0-0000-7000-8000-0000000000c2")
OTHER = uuid.UUID("0198f0c0-0000-7000-8000-0000000000c3")
TOKENS = {TARGET: "tok-target"}


def _rule(action: dict[str, Any], rule_id: str = "r-1") -> dict[str, Any]:
    return {
        "id": rule_id,
        "source": {"nodeId": "n-1", "event": "click"},
        "action": action,
    }


def _chrome(*rules: dict[str, Any]) -> dict[str, Any]:
    return {"card": {"radius": 8}, "interactions": list(rules)}


def test_a_navigate_target_becomes_the_targets_token() -> None:
    chrome = _chrome(_rule({"type": "navigate", "target": str(TARGET)}))

    rules = public_chrome(chrome, tokens=TOKENS)["interactions"]

    assert rules[0]["action"]["target"] == "tok-target"
    # 规则的其余部分原样：源控件与事件名是渲染要用的
    assert rules[0]["source"] == {"nodeId": "n-1", "event": "click"}


def test_an_unpublished_target_takes_the_whole_rule_away() -> None:
    chrome = _chrome(_rule({"type": "navigate", "target": str(OTHER)}))

    assert "interactions" not in public_chrome(chrome, tokens=TOKENS)


def test_an_empty_target_takes_the_rule_away_too() -> None:
    # 空串是「还没挑目标」，在公开面上与「跳不到」是同一件事
    chrome = _chrome(_rule({"type": "navigate", "target": ""}))

    assert "interactions" not in public_chrome(chrome, tokens=TOKENS)


def test_value_routes_keep_only_the_reachable_ones() -> None:
    chrome = _chrome(
        _rule(
            {
                "type": "navigateByValue",
                "routes": [
                    {"value": "a", "target": str(TARGET)},
                    {"value": "b", "target": str(OTHER)},
                ],
            }
        )
    )

    rules = public_chrome(chrome, tokens=TOKENS)["interactions"]

    assert rules[0]["action"]["routes"] == [
        {"value": "a", "target": "tok-target"}
    ]


def test_value_routes_with_nothing_reachable_take_the_rule_away() -> None:
    chrome = _chrome(
        _rule(
            {
                "type": "navigateByValue",
                "routes": [{"value": "b", "target": str(OTHER)}],
            }
        )
    )

    assert "interactions" not in public_chrome(chrome, tokens=TOKENS)


def test_in_screen_actions_pass_through_untouched() -> None:
    # ⚠ 显隐/互斥/弹窗都在本屏内改易失态，与公开态无关。丢掉它们会让公开页
    # 与登录态的联动行为悄悄不一致
    chrome = _chrome(
        _rule({"type": "show", "targets": ["n-2"]}, rule_id="r-show"),
        _rule({"type": "openModal", "target": "n-3"}, rule_id="r-modal"),
    )

    rules = public_chrome(chrome, tokens={})["interactions"]

    assert [item["id"] for item in rules] == ["r-show", "r-modal"]


def test_a_rule_without_an_action_is_left_alone() -> None:
    # JSONB 是无类型的：认不出的形状原样透传，由前端那条解析丢弃
    chrome = _chrome({"id": "r-broken", "source": {"nodeId": "n-1"}})

    rules = public_chrome(chrome, tokens={})["interactions"]

    assert rules == [{"id": "r-broken", "source": {"nodeId": "n-1"}}]


def test_a_malformed_interactions_bag_is_simply_dropped() -> None:
    assert public_chrome({"interactions": "坏形状"}, tokens={}) == {}


def test_the_rest_of_the_chrome_bag_is_untouched() -> None:
    chrome = {"card": {"radius": 8}, "editor": {"grid": 8}}

    assert public_chrome(chrome, tokens={}) == chrome


def test_no_internal_identifier_survives_the_rewrite() -> None:
    chrome = _chrome(
        _rule({"type": "navigate", "target": str(TARGET)}, rule_id="r-1"),
        _rule({"type": "navigate", "target": str(OTHER)}, rule_id="r-2"),
    )

    payload = json.dumps(public_chrome(chrome, tokens=TOKENS))

    assert str(TARGET) not in payload
    assert str(OTHER) not in payload


def test_the_targets_are_collected_for_the_lookup() -> None:
    chrome = _chrome(
        _rule({"type": "navigate", "target": str(TARGET)}, rule_id="r-1"),
        _rule(
            {
                "type": "navigateByValue",
                "routes": [{"value": "b", "target": str(OTHER)}],
            },
            rule_id="r-2",
        ),
        _rule({"type": "show", "targets": ["n-2"]}, rule_id="r-3"),
    )

    assert navigate_target_ids(chrome) == {TARGET, OTHER}


def test_a_handle_that_is_not_an_identifier_is_ignored() -> None:
    # 脏规则不该让整段改写失败
    chrome = _chrome(_rule({"type": "navigate", "target": "不是 uuid"}))

    assert navigate_target_ids(chrome) == set()
