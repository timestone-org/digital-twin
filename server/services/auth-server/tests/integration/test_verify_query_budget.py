"""`/verify` 的库往返预算。

边缘对**每一个**请求都要打一次这个端点，它多一次查询就是全站多一次——
所以往返次数在这里被钉死，改装配时能立刻看见代价。
"""

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine

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


async def test_verify_stays_within_its_select_budget(
    app_client: httpx.AsyncClient,
) -> None:
    token = await admin_token(app_client)
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Original-URI": f"{API_PREFIX}/users",
        "X-Original-Method": "GET",
    }
    # 先打一发把路由规则缓存焐热，规则回源不算进这次预算
    assert (await app_client.get(VERIFY, headers=headers)).status_code == 200

    with counted_selects() as statements:
        response = await app_client.get(VERIFY, headers=headers)

    assert response.status_code == 200
    assert len(statements) == EXPECTED_SELECTS, statements
