"""数据源出参里的采集运行态与实时值上限。

⚠ 「配置说它该采」（`is_enabled`）与「它此刻真在采」（`runtime.state`）是两件
事，接口必须同时回，界面才分得开。
⚠ 运行态来自另一个服务写的表，读不到时**降级为 unknown**，绝不让整页 503：
collector 没起来时配置本身照样要能看、能改。
"""

import httpx
import pytest
from conftest import CollectFakes

from integration.collect_helpers import (
    SOURCES,
    create_source,
    payload,
)
from platform_server.apps.collect.errors import HistoryUnavailable

pytestmark = pytest.mark.requires_postgres


def state_row(source_id: str, **overrides: object) -> dict[str, object]:
    """一行运行态，列名与只读查询选出的一致。

    Args: source_id, overrides。
    """
    row: dict[str, object] = {
        "source_id": source_id,
        "state": "online",
        "point_count": 4,
        "error_category": None,
        "error_detail": None,
        "leader_instance": "collector-1",
        "updated_at": None,
    }
    row.update(overrides)
    return row


async def test_a_source_the_collector_never_took_reads_as_unknown(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 不是 offline：「采集器压根没接手过它」多半是 collector 没起来
    created = await create_source(app_client)
    assert created["runtime"]["state"] == "unknown"


async def test_the_runtime_comes_back_on_the_detail(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    created = await create_source(app_client)
    collect_fakes.history.rows = [state_row(created["id"])]

    response = await app_client.get(f"{SOURCES}/{created['id']}")

    assert response.status_code == 200
    runtime = payload(response)["runtime"]
    assert (runtime["state"], runtime["point_count"]) == ("online", 4)


async def test_the_runtime_comes_back_on_every_row_of_the_list(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    created = await create_source(app_client)
    collect_fakes.history.rows = [
        state_row(created["id"], state="offline", error_category="auth")
    ]

    response = await app_client.get(SOURCES)

    assert response.status_code == 200
    row = payload(response)["items"][0]
    assert (row["runtime"]["state"], row["runtime"]["error_category"]) == (
        "offline",
        "auth",
    )


async def test_an_unreadable_runtime_degrades_instead_of_failing(
    app_client: httpx.AsyncClient, collect_fakes: CollectFakes
) -> None:
    # collector 那边的库读不了，不该把配置页整页打挂
    await create_source(app_client)
    collect_fakes.history.failure = HistoryUnavailable("库读不了")

    response = await app_client.get(SOURCES)

    assert response.status_code == 200
    assert payload(response)["items"][0]["runtime"]["state"] == "unknown"


async def test_the_live_point_limit_comes_from_the_server(
    app_client: httpx.AsyncClient,
) -> None:
    # ⚠ 前端不许另存一份：两处各写一个数字，调大配置之后界面还按旧数字提示
    created = await create_source(app_client)
    assert created["live_point_limit"] > 0
