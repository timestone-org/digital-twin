"""订阅表的只读连接：它真的只读，且读不到时响亮失败。

守的是 ADR-0003 的「写独占读放行」——`realtime` schema 归 realtime-hub 写独占，
平台侧只有读。这条由连接自己的只读事务保证，不靠「大家记得别写」。
"""

import pytest

from lib.errors import DependencyUnavailable
from platform_server.apps.dashboard.services import ReadOnlyViewerSource

pytestmark = pytest.mark.requires_postgres


async def test_a_select_comes_back_mapped_by_column_name(
    viewer_source: ReadOnlyViewerSource,
) -> None:
    rows = await viewer_source.fetch_all("SELECT 1 AS probe", {})
    assert rows == [{"probe": 1}]


async def test_values_travel_as_bound_parameters(
    viewer_source: ReadOnlyViewerSource,
) -> None:
    rows = await viewer_source.fetch_all(
        "SELECT :given AS echoed", {"given": "dashboard:%"}
    )
    assert rows == [{"echoed": "dashboard:%"}]


async def test_the_connection_refuses_to_write(
    viewer_source: ReadOnlyViewerSource,
) -> None:
    # ⚠ 这是本文件的要害：写独占靠的是这条事务真的只读，不是靠约定
    with pytest.raises(DependencyUnavailable):
        await viewer_source.fetch_all(
            "CREATE TEMP TABLE should_not_exist (id int)", {}
        )


async def test_a_missing_table_fails_loudly_instead_of_reading_empty(
    viewer_source: ReadOnlyViewerSource,
) -> None:
    # 表名完全限定：配错时要的是「表不存在」，不是静默命中本服务的同名表
    with pytest.raises(DependencyUnavailable) as raised:
        await viewer_source.fetch_all("SELECT 1 FROM realtime.nowhere", {})
    assert raised.value.http_status == 503
