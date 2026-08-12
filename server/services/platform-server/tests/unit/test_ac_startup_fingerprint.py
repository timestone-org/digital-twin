"""抽取参数的校验与指纹用例。

指纹是「这份数据按哪套规则算的」的唯一凭据：它该动而不动，页面就不会提醒
重算，而库里那批事件已经不是当前规则的产物了。
"""

import pytest

from platform_server.apps.hvac.services import ac_startup_rules
from platform_server.apps.hvac.services.ac_startup_rules import ExtractionRules

DEFAULTS = ExtractionRules()


@pytest.mark.parametrize(
    "field",
    [
        "cold_off_minutes",
        "combination_window_minutes",
        "compliance_frames",
        "compliance_cap_minutes",
        "max_gap_minutes",
    ],
)
def test_rules_reject_a_non_positive_value(field: str) -> None:
    """每个分钟数参数都必须是正整数，0 与负数直接拒绝。"""
    with pytest.raises(ValueError, match=field):
        ExtractionRules(**{field: 0})


def test_the_cold_start_switch_is_not_a_minute_count() -> None:
    """开关不参与正整数校验，关掉它不该被当成非法取值。"""
    assert ExtractionRules(require_cold_start=False).cold_off_minutes == 30


def test_the_default_fingerprint_is_pinned() -> None:
    """默认规则 + `LOGIC_VERSION` 的指纹钉成字面量：它一变就该全量重算。"""
    assert DEFAULTS.fingerprint() == (
        "0724ac972a5c2b8ebd6c7d6f4723ea28" "011b63d6ddd07ce7a2a62046a3bdddef"
    )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("cold_off_minutes", 31),
        ("combination_window_minutes", 11),
        ("compliance_frames", 2),
        ("compliance_cap_minutes", 120),
        ("max_gap_minutes", 4),
        ("require_cold_start", False),
    ],
)
def test_the_fingerprint_changes_with_every_rule_value(
    field: str, value: int | bool
) -> None:
    """任何一个参数改了取值，指纹都必须变——不然页面不会提醒重算。"""
    assert ExtractionRules(**{field: value}).fingerprint() != (
        DEFAULTS.fingerprint()
    )


def test_the_fingerprint_changes_with_the_logic_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """抽取逻辑改了、参数没改时，靠 `LOGIC_VERSION` 让指纹动起来。"""
    before = ExtractionRules().fingerprint()
    monkeypatch.setattr(ac_startup_rules, "LOGIC_VERSION", 2)
    assert ExtractionRules().fingerprint() != before


def test_the_fingerprint_is_stable_for_the_same_rules() -> None:
    """同一套取值永远算出同一个指纹，否则每次启动都提醒重算。"""
    assert ExtractionRules(cold_off_minutes=45).fingerprint() == (
        ExtractionRules(cold_off_minutes=45).fingerprint()
    )
