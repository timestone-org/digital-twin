"""`/verify` 的库往返预算。

边缘对**每一个**请求都要打一次这个端点，它多一次查询就是全站多一次——
所以往返次数在这里被钉死，改装配时能立刻看见代价。

⚠ 两条预算都要钉：**回源**那一趟仍然只许两条 SELECT（身份缓存不许把回源
路径上的退化盖住），**命中**那一趟一条都不许有。
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine

from auth_server.container import Container
from auth_server.settings import API_PREFIX, INTERNAL_PREFIX

pytestmark = pytest.mark.requires_postgres

VERIFY = f"{INTERNAL_PREFIX}/verify"
SEED_PASSWORD = "Admin123456"
# 认证一次要的两条：取用户（连角色一次 JOIN 回来）+ 取三个码集
EXPECTED_SELECTS = 2


async def admin_token(client: httpx.AsyncClient) -> str:
    response = await client.post(
        f"{API_PREFIX}/sessions",
        json={"username": "admin", "password": SEED_PASSWORD},
    )
    return response.json()["data"]["token"]["access_token"]


@contextmanager
def counted_selects() -> Iterator[list[str]]:
    """收集这段时间里发出的全部 SELECT 语句。"""
    seen: list[str] = []

    def record(
        _connection: Any,
        _cursor: Any,
        statement: str,
        _parameters: Any,
        _context: Any,
        _is_executemany: object,
    ) -> None:
        if statement.lstrip().upper().startswith("SELECT"):
            seen.append(statement)

    event.listen(Engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(Engine, "before_cursor_execute", record)


async def _warm_headers(client: httpx.AsyncClient) -> dict[str, str]:
    """登录并打一发，把路由规则缓存焐热；规则回源不算进预算。

    Args: client。
    """
    token = await admin_token(client)
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Original-URI": f"{API_PREFIX}/users",
        "X-Original-Method": "GET",
    }
    assert (await client.get(VERIFY, headers=headers)).status_code == 200
    return headers


async def test_verify_stays_within_its_select_budget(
    app_client: httpx.AsyncClient, app_container: Container
) -> None:
    """回源那一趟的预算。

    Args: app_client, app_container。
    """
    headers = await _warm_headers(app_client)
    # 只清身份缓存：量的就是「这个账号第一次被看见」那一趟
    app_container.identities.invalidate_all()

    with counted_selects() as statements:
        response = await app_client.get(VERIFY, headers=headers)

    assert response.status_code == 200
    assert len(statements) == EXPECTED_SELECTS, statements


async def test_a_warm_identity_costs_no_query_at_all(
    app_client: httpx.AsyncClient, app_container: Container
) -> None:
    """命中那一趟的预算——这就是身份缓存的全部收益。

    ⚠ 也是它的全部代价：这一趟不回源，所以停用与降权要靠写路径失效
    （同副本即时）或 TTL（跨副本）才看得见，见 `IdentityCache`。

    Args: app_client, app_container。
    """
    headers = await _warm_headers(app_client)
    assert app_container.identities is not None

    with counted_selects() as statements:
        response = await app_client.get(VERIFY, headers=headers)

    assert response.status_code == 200
    assert statements == []
