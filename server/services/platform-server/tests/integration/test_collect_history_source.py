"""归档库的只读连接：它真的只读，且驱动异常收敛成 503。

守的是 ADR-0003 的「写独占读放行」——平台侧对 `collect` schema 只有读权限，
这条由连接自己的只读事务保证，不靠「大家记得别写」。
"""

import logging

import pytest

from platform_server.apps.collect.errors import HistoryUnavailable
from platform_server.apps.collect.services import ReadOnlyHistorySource

pytestmark = pytest.mark.requires_postgres


async def test_a_select_comes_back_mapped_by_column_name(
    history_source: ReadOnlyHistorySource,
) -> None:
    rows = await history_source.fetch_all("SELECT 1 AS probe", {})
    assert rows == [{"probe": 1}]


async def test_values_travel_as_bound_parameters(
    history_source: ReadOnlyHistorySource,
) -> None:
    rows = await history_source.fetch_all(
        "SELECT :given AS echoed", {"given": "outlet_temp"}
    )
    assert rows == [{"echoed": "outlet_temp"}]


async def test_the_connection_refuses_to_write(
    history_source: ReadOnlyHistorySource,
) -> None:
    # ⚠ 这是本文件的要害：写独占靠的是这条事务真的只读，不是靠约定
    with pytest.raises(HistoryUnavailable):
        await history_source.fetch_all(
            "CREATE TEMP TABLE should_not_exist (id int)", {}
        )


async def test_a_broken_statement_becomes_a_dependency_error(
    history_source: ReadOnlyHistorySource,
) -> None:
    with pytest.raises(HistoryUnavailable) as raised:
        await history_source.fetch_all("SELECT FROM nowhere", {})
    assert raised.value.http_status == 503
    assert raised.value.is_retryable is True


async def test_the_log_names_the_driver_error_not_just_the_wrapper(
    history_source: ReadOnlyHistorySource, caplog: pytest.LogCaptureFixture
) -> None:
    # ⚠ 对外一律 503「请稍后重试」，故「重试有没有用」只能从日志里看出来：
    # 少了这两格，一个参数绑错类型的必死查询与一次库抖动一模一样
    with (
        caplog.at_level(logging.ERROR, logger="platform.collect.history"),
        pytest.raises(HistoryUnavailable),
    ):
        await history_source.fetch_all(
            "SELECT :moment > now()", {"moment": "2026-08-01T00:00:00Z"}
        )
    payload = caplog.records[-1].payload  # pyright: ignore[reportAny]
    assert payload["driver_error"] == "DataError"
    assert payload["sqlstate"] == "22000"


async def test_a_failure_with_no_driver_cause_still_logs_cleanly(
    history_source: ReadOnlyHistorySource, caplog: pytest.LogCaptureFixture
) -> None:
    # ⚠ 有些失败压根没走到驱动（这条是少给了一个绑定参数）：那时不许硬编一个
    # 假的驱动错误名出来，宁可这两格不写
    with (
        caplog.at_level(logging.ERROR, logger="platform.collect.history"),
        pytest.raises(HistoryUnavailable),
    ):
        await history_source.fetch_all("SELECT :missing", {})
    payload = caplog.records[-1].payload  # pyright: ignore[reportAny]
    assert "driver_error" not in payload
    assert payload["error_type"] == "StatementError"
