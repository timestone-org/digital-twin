"""参数目录的自洽性：键、访问器、范围与写权限码必须两两对得上。

⚠ 目录写歪不会有任何报错：`read` 指到另一个字段上时，界面照样显示一个数，
只是那个数与它旁边的说明毫无关系，而运维会照着说明去调它。
"""

from typing import Any

import pytest
from pydantic import SecretStr, ValidationError

from platform_server.apps.dashboard.catalog import (
    DASHBOARD_EDIT,
    DASHBOARD_VIEW,
)
from platform_server.apps.runtime_params import catalog
from platform_server.settings import PUBLISH_MAX_ITEMS_CEILING, Settings

PLACEHOLDER = "catalog-test"


def base_fields() -> dict[str, Any]:
    """一份能构造出配置的最小字段集，不连任何依赖。"""
    return {
        "postgres_host": PLACEHOLDER,
        "postgres_user": PLACEHOLDER,
        "postgres_password": SecretStr(PLACEHOLDER),
        "postgres_db": PLACEHOLDER,
        "sqlserver_host": PLACEHOLDER,
        "sqlserver_user": PLACEHOLDER,
        "sqlserver_password": SecretStr(PLACEHOLDER),
        "sqlserver_database": PLACEHOLDER,
        "redis_host": PLACEHOLDER,
        "edge_signing_secret": SecretStr("x" * 32),
        "edge_service_key": SecretStr("y" * 32),
    }


def build_settings(**overrides: Any) -> Settings:
    """一份能构造出来的配置，可按需覆盖个别字段。

    Args: overrides。
    """
    return Settings(**{**base_fields(), **overrides})


def test_the_dashboard_section_is_written_with_the_dashboard_edit_code() -> (
    None
):
    written = catalog.SECTION_WRITE_CODES[catalog.SECTION_DASHBOARD]
    assert written == DASHBOARD_EDIT


def test_the_restated_view_code_matches_the_dashboard_module() -> None:
    assert catalog.DASHBOARD_VIEW == DASHBOARD_VIEW


def test_all_sections_still_share_a_single_write_code() -> None:
    # 出现第二个写码时写面必须按分组拆路由：闸 2 的声明是路由上的静态属性，
    # 它看不见路径参数里的分组名，一条路由声明不出两个码
    assert len(set(catalog.SECTION_WRITE_CODES.values())) == 1


def test_every_section_has_a_write_code() -> None:
    missing = [
        name
        for name in catalog.sections()
        if name not in catalog.SECTION_WRITE_CODES
    ]
    assert missing == []


def test_every_spec_reads_the_field_that_its_key_names() -> None:
    settings = build_settings()
    mismatched = [
        spec.key
        for spec in _all_specs()
        if spec.read(settings) != getattr(settings, spec.key)
    ]
    assert mismatched == []


def test_every_default_sits_inside_the_declared_range() -> None:
    settings = build_settings()
    outside = [
        spec.key
        for spec in _all_specs()
        if not spec.minimum <= spec.read(settings) <= spec.maximum
    ]
    assert outside == []


def test_every_spec_declares_a_usable_range() -> None:
    inverted = [
        spec.key for spec in _all_specs() if spec.minimum >= spec.maximum
    ]
    assert inverted == []


def test_every_spec_names_the_section_that_holds_it() -> None:
    stray = [
        spec.key
        for name in catalog.sections()
        for spec in catalog.specs_of(name) or ()
        if spec.section != name
    ]
    assert stray == []


def test_the_env_name_carries_the_service_prefix() -> None:
    spec = catalog.spec_of(catalog.SECTION_DASHBOARD, "publish_window_ms")
    assert spec is not None
    assert catalog.env_name_of(spec) == "PLATFORM_PUBLISH_WINDOW_MS"


def test_a_secret_field_is_not_in_the_catalog() -> None:
    # 没登记的键既不可读也不可写，密钥因此天然被排除，不需要另写排除逻辑
    found = catalog.spec_of(catalog.SECTION_DASHBOARD, "edge_signing_secret")
    assert found is None


def test_an_unregistered_section_has_no_specs() -> None:
    assert catalog.specs_of("opcua") is None


def _all_specs() -> list[catalog.ParamSpec]:
    """目录里的全部登记项。"""
    return [
        spec
        for name in catalog.sections()
        for spec in catalog.specs_of(name) or ()
    ]


def test_the_frame_size_ceiling_is_refused_at_startup() -> None:
    # ⚠ 只在 hint 里写一句「别超过 hub」不算校验：超了是 hub 那边 413 丢整批，
    # 现场表现成「大屏少了一半点位」，排查要一路走到 realtime-hub 里去
    with pytest.raises(ValidationError):
        build_settings(publish_max_items=PUBLISH_MAX_ITEMS_CEILING + 1)


def test_a_frame_size_at_the_ceiling_still_starts() -> None:
    settings = build_settings(publish_max_items=PUBLISH_MAX_ITEMS_CEILING)
    assert settings.publish_max_items == PUBLISH_MAX_ITEMS_CEILING


def test_the_frame_size_ceiling_matches_the_catalog_bound() -> None:
    # 两处各写死一个数就会漂：界面放行的值会被启动校验挡在门外
    spec = catalog.spec_of(catalog.SECTION_DASHBOARD, "publish_max_items")
    assert spec is not None
    assert spec.maximum == PUBLISH_MAX_ITEMS_CEILING
