"""取值闸与「默认值叠加覆盖行」的合并口径。

⚠ 合并写错是静默的：把没有覆盖行的项标成「已覆盖」，界面会显示一个改不回去
的取值；把覆盖行读成默认值，运维改完刷新一看又变回去了，两边都不报错。
"""

from datetime import UTC, datetime
from typing import Any

import pytest

from lib.errors import ValidationFailed
from platform_server.apps.runtime_params import catalog
from platform_server.apps.runtime_params.errors import RuntimeParamUnknown
from platform_server.apps.runtime_params.models import RuntimeParamOverride
from platform_server.apps.runtime_params.services import param_service
from unit.test_runtime_params_catalog import build_settings

CHANGED_AT = datetime(2026, 8, 14, 3, 0, tzinfo=UTC)
WINDOW_KEY = "publish_window_ms"
RECONCILE_KEY = "publish_reconcile_interval_s"


def spec_of(key: str) -> catalog.ParamSpec:
    """取一项登记信息，取不到就让用例直接失败。

    Args: key。
    """
    spec = catalog.spec_of(catalog.SECTION_DASHBOARD, key)
    assert spec is not None
    return spec


def row_of(key: str, value: Any, previous: Any = None) -> RuntimeParamOverride:
    """造一行覆盖，不挂会话。

    Args: key, value, previous。
    """
    return RuntimeParamOverride(
        section=catalog.SECTION_DASHBOARD,
        key=key,
        value_json=value,
        previous_value_json=previous,
        updated_by="操作员",
        updated_at=CHANGED_AT,
    )


def test_an_integer_knob_takes_an_integer() -> None:
    assert param_service.validated(spec_of(WINDOW_KEY), 2000) == 2000


def test_an_integer_knob_rejects_a_decimal() -> None:
    with pytest.raises(ValidationFailed):
        param_service.validated(spec_of(WINDOW_KEY), 2000.5)


def test_a_decimal_knob_takes_a_decimal() -> None:
    assert param_service.validated(spec_of(RECONCILE_KEY), 7.5) == 7.5


def test_a_boolean_is_not_a_number() -> None:
    # ⚠ 布尔在 Python 里是 int 的子类，不单独挡掉就会让 `true` 悄悄变成 1
    with pytest.raises(ValidationFailed):
        param_service.validated(spec_of(WINDOW_KEY), True)


def test_a_value_below_the_minimum_is_turned_away() -> None:
    with pytest.raises(ValidationFailed):
        param_service.validated(spec_of(WINDOW_KEY), 1)


def test_a_value_above_the_maximum_is_turned_away() -> None:
    with pytest.raises(ValidationFailed):
        param_service.validated(spec_of(WINDOW_KEY), 10_000_000)


def test_the_boundaries_themselves_are_accepted() -> None:
    spec = spec_of(WINDOW_KEY)
    assert param_service.validated(spec, spec.minimum) == spec.minimum
    assert param_service.validated(spec, spec.maximum) == spec.maximum


def test_a_stored_boolean_is_not_read_back_as_a_number() -> None:
    assert param_service.stored_number(True) is None


def test_a_stored_string_is_not_read_back_as_a_number() -> None:
    assert param_service.stored_number("2000") is None


def test_a_stored_integer_survives_the_round_trip() -> None:
    assert param_service.stored_number(2000) == 2000


def test_without_an_override_the_environment_default_wins() -> None:
    settings = build_settings()
    current = param_service.effective_of(
        spec_of(WINDOW_KEY), settings=settings, row=None
    )
    assert current.value == settings.publish_window_ms
    assert current.updated_at is None


def test_an_override_row_wins_over_the_environment_default() -> None:
    settings = build_settings()
    current = param_service.effective_of(
        spec_of(WINDOW_KEY), settings=settings, row=row_of(WINDOW_KEY, 2500)
    )
    assert current.value == 2500
    assert current.updated_at == CHANGED_AT
    assert current.updated_by == "操作员"


def test_an_unreadable_override_falls_back_to_the_default() -> None:
    # 手改过 SQL 之后形状不是数：按未覆盖处理并留一条 WARN，而不是整组 500
    settings = build_settings()
    current = param_service.effective_of(
        spec_of(WINDOW_KEY),
        settings=settings,
        row=row_of(WINDOW_KEY, "很快"),
    )
    assert current.value == settings.publish_window_ms
    assert current.updated_at is None


def test_the_descriptor_shows_both_the_effective_value_and_the_default() -> (
    None
):
    settings = build_settings()
    item = param_service.to_param_out(
        spec_of(WINDOW_KEY), settings=settings, row=row_of(WINDOW_KEY, 2500)
    )
    assert item.value == 2500
    assert item.default_value == settings.publish_window_ms
    assert item.is_overridden
    assert item.env_name == "PLATFORM_PUBLISH_WINDOW_MS"


def test_an_untouched_item_is_not_marked_as_overridden() -> None:
    item = param_service.to_param_out(
        spec_of(WINDOW_KEY), settings=build_settings(), row=None
    )
    assert not item.is_overridden
    assert item.updated_by is None


def test_an_unknown_section_is_turned_away() -> None:
    with pytest.raises(RuntimeParamUnknown):
        param_service.require_specs("opcua")


def test_an_unknown_key_is_turned_away() -> None:
    with pytest.raises(RuntimeParamUnknown):
        param_service.require_spec(catalog.SECTION_DASHBOARD, "postgres_host")


def test_the_descriptor_shows_what_the_value_was_before() -> None:
    # 复盘要看得出「从多少改到多少」，只留现值等于没留
    item = param_service.to_param_out(
        spec_of(WINDOW_KEY),
        settings=build_settings(),
        row=row_of(WINDOW_KEY, 2500, 1000),
    )
    assert item.previous_value == 1000


def test_an_untouched_item_has_no_value_from_before() -> None:
    item = param_service.to_param_out(
        spec_of(WINDOW_KEY), settings=build_settings(), row=None
    )
    assert item.previous_value is None


def test_every_item_carries_the_code_needed_to_write_it() -> None:
    item = param_service.to_param_out(
        spec_of(WINDOW_KEY), settings=build_settings(), row=None
    )
    assert item.write_code == "dashboard:edit"


def test_the_bounds_travel_with_the_value() -> None:
    # 界面自己写一份范围时，前端放行的值会被服务端 422 挡回来
    spec = spec_of(WINDOW_KEY)
    item = param_service.to_param_out(spec, settings=build_settings(), row=None)
    assert (item.minimum, item.maximum) == (spec.minimum, spec.maximum)
