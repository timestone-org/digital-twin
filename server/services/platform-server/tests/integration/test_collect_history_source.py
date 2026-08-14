"""归档库的只读连接：它真的只读，且驱动异常收敛成 503。

守的是 ADR-0003 的「写独占读放行」——平台侧对 `collect` schema 只有读权限，
这条由连接自己的只读事务保证，不靠「大家记得别写」。
"""

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
