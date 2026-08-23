"""参数目录的自洽性：键、访问器、范围与写权限码必须两两对得上。

⚠ 目录写歪不会有任何报错：`read` 指到另一个字段上时，界面照样显示一个数，
只是那个数与它旁边的说明毫无关系，而运维会照着说明去调它。
"""

from typing import Any

import pytest
from pydantic import SecretStr, ValidationError

from platform_server.apps.collect.catalog import (
    COLLECT_MANAGE,
    COLLECT_VIEW,
)
from platform_server.apps.dashboard.catalog import (
    DASHBOARD_EDIT,
    DASHBOARD_VIEW,
)
from platform_server.apps.dataset.catalog import (
    DATASET_MANAGE,
    DATASET_VIEW,
)
from platform_server.apps.runtime_params import catalog
from platform_server.apps.runtime_params.catalog import env_name_of
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
        "collect_credential_secret": SecretStr("c" * 32),
        "objectstore_endpoint": "http://placeholder:9000",
        "objectstore_bucket": PLACEHOLDER,
        "objectstore_access_key": SecretStr(PLACEHOLDER),
        "objectstore_secret_key": SecretStr("z" * 12),
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


def test_the_restated_collect_codes_match_the_collect_module() -> None:
    assert catalog.COLLECT_MANAGE == COLLECT_MANAGE
    assert catalog.COLLECT_VIEW == COLLECT_VIEW


def test_the_collect_scope_is_written_with_the_collect_manage_code() -> None:
    # ⚠ 写码已不止一个，路由按 scope 拆开；分组配错码 = 拿大屏的码改采集参数
    for name in catalog.COLLECT_SCOPE:
        assert catalog.SECTION_WRITE_CODES[name] == COLLECT_MANAGE


def test_the_scopes_partition_the_catalog() -> None:
    # 一个分组恰好落在一条路由上：落两条是双份写码，落零条是永远改不了
    scoped = [
        *catalog.DASHBOARD_SCOPE,
        *catalog.COLLECT_SCOPE,
        *catalog.DATASET_SCOPE,
    ]
    assert sorted(scoped) == sorted(catalog.sections())
    assert len(scoped) == len(set(scoped))


def test_the_restated_dataset_codes_match_the_dataset_module() -> None:
    assert catalog.DATASET_MANAGE == DATASET_MANAGE
    assert catalog.DATASET_VIEW == DATASET_VIEW


def test_the_dataset_scope_is_written_with_the_dataset_manage_code() -> None:
    for name in catalog.DATASET_SCOPE:
        assert catalog.SECTION_WRITE_CODES[name] == DATASET_MANAGE


def test_every_dataset_spec_reads_the_field_that_its_key_names() -> None:
    # ⚠ 台账组的消费者**在本进程**（worker 的采集循环），故 `read` 必须真指到
    # 配置对象上的同名字段：指歪了界面照样显示一个数，只是那个数与它旁边的
    # 说明毫无关系，而采集器跑的是另一个
    settings = build_settings()
    mismatched = [
        spec.key
        for name in catalog.DATASET_SCOPE
        for spec in catalog.specs_of(name) or ()
        if spec.read(settings) != getattr(settings, spec.key)
    ]
    assert mismatched == []


def test_the_dataset_switch_is_dangerous_in_the_off_direction() -> None:
    # ⚠ 危险方向是**关**：关掉之后水位停在原地、完全没有报错，而那段时间的桶
    # 不会自己补回来
    spec = catalog.spec_of(catalog.SECTION_DATASET, "dataset_enabled")
    assert spec is not None
    assert spec.danger == catalog.DANGER_OFF
    assert spec.kind == catalog.SWITCH_KIND


def test_the_retention_switch_is_dangerous_in_the_on_direction() -> None:
    # ⚠ 与采集开关**方向相反**：那一项关掉才危险，这一项**打开**才危险——打开
    # 之后开始按保留天数真实删除，删掉的行找不回来。照抄另一个开关的取值等于
    # 把二次确认弹在安全的那一侧
    spec = catalog.spec_of(catalog.SECTION_DATASET, "dataset_retention_enabled")
    assert spec is not None
    assert spec.danger == catalog.DANGER_ON
    assert spec.kind == catalog.SWITCH_KIND
    other = catalog.spec_of(catalog.SECTION_DATASET, "dataset_enabled")
    assert other is not None
    assert other.danger != spec.danger


def test_the_retention_period_stays_inside_what_its_lease_can_outlive() -> None:
    # ⚠ 租约只在每一趟醒来时续期：周期上限超过 TTL 就是每一趟都先丢租约
    spec = catalog.spec_of(
        catalog.SECTION_DATASET, "dataset_retention_interval_s"
    )
    assert spec is not None
    assert spec.maximum < build_settings().dataset_retention_lease_ttl_s


def test_the_dataset_env_names_are_the_ones_the_design_doc_lists() -> None:
    # 界面上给运维看的变量名要与 .env 里那几行逐字相同
    names = {
        env_name_of(spec)
        for spec in catalog.specs_of(catalog.SECTION_DATASET) or ()
    }
    assert names == {
        "PLATFORM_DATASET_ENABLED",
        "PLATFORM_DATASET_INTERVAL_S",
        "PLATFORM_DATASET_RECOMPUTE_TAIL_BUCKETS",
        "PLATFORM_DATASET_MAX_BUCKETS_PER_TICK",
        "PLATFORM_DATASET_TABLE_TIMEOUT_S",
        "PLATFORM_DATASET_RETENTION_ENABLED",
        "PLATFORM_DATASET_RETENTION_INTERVAL_S",
        "PLATFORM_DATASET_RETENTION_MAX_ROWS_PER_RUN",
        "PLATFORM_DATASET_RETENTION_TABLE_TIMEOUT_S",
    }


def test_every_section_has_a_write_code() -> None:
    missing = [
        name
        for name in catalog.sections()
        if name not in catalog.SECTION_WRITE_CODES
    ]
    assert missing == []


def test_every_dashboard_spec_reads_the_field_that_its_key_names() -> None:
    # 采集/归档分组不在此列：它们的消费者在 collector-server，`read` 回的是
    # 出厂值常量，对应字段根本不在本进程的 Settings 上
    settings = build_settings()
    mismatched = [
        spec.key
        for name in catalog.DASHBOARD_SCOPE
        for spec in catalog.specs_of(name) or ()
        if spec.read(settings) != getattr(settings, spec.key)
    ]
    assert mismatched == []


def test_every_collect_spec_names_the_collector_env_var() -> None:
    # 采集/归档的键住在 collector-server 上：环境变量名必须显式给出
    # （COLLECT_*），否则界面会指着不存在的 PLATFORM_* 变量让运维去对 .env
    unnamed = [
        spec.key
        for name in catalog.COLLECT_SCOPE
        for spec in catalog.specs_of(name) or ()
        if spec.env_override is None
        or not spec.env_override.startswith("COLLECT_")
    ]
    assert unnamed == []


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
