"""路由规则写路径：缓存失效必须等事务落地。

⚠ 提交前失效时，并发的 /verify 回源读到的仍是旧行，却打上新时间戳缓存一个 TTL。
"""

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import cast

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.crud import route_rule_crud
from auth_server.apps.auth.models import RouteRule, User
from auth_server.apps.auth.schemas import (
    RouteRuleCreateIn,
    RouteRuleUpdateIn,
)
from auth_server.apps.auth.services import route_rule_service as rules_module
from auth_server.apps.auth.services.identity import Identity, Operation
from auth_server.apps.auth.services.route_rule_service import (
    RouteRuleCache,
    create_rule,
    delete_rule,
    update_rule,
)
from lib.db import run_after_commit_hooks
from lib.testing import FrozenClock

NOW = datetime(2026, 8, 14, 9, 0, tzinfo=UTC)
RULE_ID = uuid.UUID("00000000-0000-4000-8000-000000000002")
OPERATION = Operation(
    operator=Identity(
        user=User(id=uuid.UUID(int=1), username="admin"),
        role_codes=frozenset(),
        direct_codes=frozenset(),
        builtin_codes=frozenset(),
    )
)


class FakeSession:
    """只留写路径会碰的表面：登记表与挂载。"""

    def __init__(self) -> None:
        self.info: dict[str, object] = {}

    def add(self, row: object) -> None:
        if isinstance(row, RouteRule):
            row.id = RULE_ID

    async def flush(self) -> None:
        return None


def stored_rule() -> RouteRule:
    return RouteRule(
        id=RULE_ID,
        path_pattern="/api/v1/platform/things*",
        http_method="GET",
        permission_codes=["user:view"],
        match_mode="all",
        priority=100,
        is_enabled=True,
    )


class Reads:
    """数回源次数：缓存没失效时读路径不会碰库。"""

    def __init__(self) -> None:
        self.count = 0

    async def list_enabled(self, _session: AsyncSession) -> list[RouteRule]:
        self.count += 1
        return []


@pytest.fixture
def reads(monkeypatch: pytest.MonkeyPatch) -> Reads:
    tracker = Reads()

    async def get(_session: AsyncSession, _rule_id: uuid.UUID) -> RouteRule:
        return stored_rule()

    async def delete(_session: AsyncSession, _rule: RouteRule) -> None:
        return None

    async def resolve(_session: AsyncSession, _codes: frozenset[str]) -> None:
        return None

    def present(rule: RouteRule) -> RouteRule:
        return rule

    monkeypatch.setattr(route_rule_crud, "list_enabled", tracker.list_enabled)
    monkeypatch.setattr(route_rule_crud, "get", get)
    monkeypatch.setattr(route_rule_crud, "delete", delete)
    monkeypatch.setattr(rules_module, "resolve_permission_ids", resolve)
    monkeypatch.setattr(rules_module, "to_route_rule_out", present)
    return tracker


Write = Callable[[AsyncSession, RouteRuleCache], Awaitable[object]]


async def write_create(session: AsyncSession, cache: RouteRuleCache) -> object:
    payload = RouteRuleCreateIn(
        path_pattern="/api/v1/platform/things*",
        http_method="GET",
        permission_codes=["user:view"],
        priority=100,
    )
    return await create_rule(session, OPERATION, payload=payload, cache=cache)


async def write_update(session: AsyncSession, cache: RouteRuleCache) -> object:
    return await update_rule(
        session,
        OPERATION,
        rule_id=RULE_ID,
        payload=RouteRuleUpdateIn(priority=120),
        cache=cache,
    )


async def write_delete(session: AsyncSession, cache: RouteRuleCache) -> object:
    return await delete_rule(session, OPERATION, rule_id=RULE_ID, cache=cache)


WRITES = [write_create, write_update, write_delete]


@pytest.mark.parametrize("write", WRITES)
async def test_a_read_before_commit_does_not_reload_and_recache(
    write: Write, reads: Reads
) -> None:
    session = cast("AsyncSession", FakeSession())
    cache = RouteRuleCache(clock=FrozenClock(NOW))
    await cache.rules(session)
    await write(session, cache)
    await cache.rules(session)
    assert reads.count == 1


@pytest.mark.parametrize("write", WRITES)
async def test_the_next_read_after_commit_reloads(
    write: Write, reads: Reads
) -> None:
    session = cast("AsyncSession", FakeSession())
    cache = RouteRuleCache(clock=FrozenClock(NOW))
    await cache.rules(session)
    await write(session, cache)
    await run_after_commit_hooks(session)
    await cache.rules(session)
    assert reads.count == 2
