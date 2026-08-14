"""闸 1 与闸 2 的口径必须一致。

⚠ 双口径漂移是本设计最大的长期风险，且完全静默：路由规则说要 `user:view`、
端点上写的是 `user:manage`，两边都不会报错，只会在某个账号身上表现为
「按钮亮着但点了 403」或反过来「本该拦住的没拦」。这条用例遍历真实路由表钉死它。
"""

import re
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute

from auth_server.apps.auth.api import ROUTERS
from auth_server.apps.auth.deps import (
    REQUIRED_CODES_ATTR,
    REQUIRED_MODE_ATTR,
)
from auth_server.apps.auth.services.matching import find_rule
from auth_server.settings import API_PREFIX, INTERNAL_PREFIX
from contract.rule_views import catalog_rule_views

SAMPLE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
_PARAM = re.compile(r"\{[^}]+\}")


def build_app() -> FastAPI:
    app = FastAPI()
    for router in ROUTERS:
        app.include_router(router)
    return app


def iter_routes(app: FastAPI) -> Iterator[APIRoute]:
    """遍历应用里全部的 APIRoute，含被 include 进来的子路由。

    ⚠ 不能只顺着 `.routes` 走：`include_router` 挂进来的是一个
    `_IncludedRouter` 包装对象，真正的路由挂在它的 `original_router` 上。
    只走 `.routes` 会一条路由都取不到，参数化列表因此为空——而 pytest 把
    空参数化标成 skip，本文件那两条契约用例于是双双**空跑**且全绿。
    Args: app。
    """
    stack: list[Any] = list(app.routes)
    while stack:
        item = stack.pop()
        if isinstance(item, APIRoute):
            yield item
        for attribute in ("routes", "original_router"):
            nested = getattr(item, attribute, None)
            if nested is None:
                continue
            stack.extend(nested if isinstance(nested, list) else [nested])


def gate_two_requirement(route: APIRoute) -> tuple[frozenset[str], str]:
    """端点自己声明的权限码与判定模式。"""
    codes: set[str] = set()
    mode = "all"
    pending = list(route.dependant.dependencies)
    while pending:
        dependency = pending.pop()
        declared = getattr(dependency.call, REQUIRED_CODES_ATTR, None)
        if declared is not None:
            codes |= set(declared)
            mode = getattr(dependency.call, REQUIRED_MODE_ATTR, "all")
        pending.extend(dependency.dependencies)
    return frozenset(codes), mode


def public_routes() -> list[tuple[str, str]]:
    app = build_app()
    result: list[tuple[str, str]] = []
    for route in iter_routes(app):
        if not route.path.startswith(API_PREFIX):
            continue
        if route.path.startswith(INTERNAL_PREFIX):
            continue
        for method in sorted(route.methods or set()):
            if method in {"HEAD", "OPTIONS"}:
                continue
            result.append((route.path, method))
    return result


ROUTE_CASES = public_routes()


def test_the_route_table_was_actually_scanned() -> None:
    # ⚠ 扫不到路由就等于下面两条契约没跑，而空参数化在 pytest 里是 skip 不是红
    assert len(ROUTE_CASES) > 0


def test_every_public_route_has_a_seeded_rule() -> None:
    rules = catalog_rule_views()
    missing = [
        f"{method} {path}"
        for path, method in ROUTE_CASES
        if find_rule(rules, path=_PARAM.sub(SAMPLE_ID, path), method=method)
        is None
    ]
    assert missing == []


@pytest.mark.parametrize(
    ("path", "method"),
    ROUTE_CASES,
    ids=[f"{method} {path}" for path, method in ROUTE_CASES],
)
def test_gate_one_and_gate_two_require_the_same_codes(
    path: str, method: str
) -> None:
    route = next(
        item
        for item in iter_routes(build_app())
        if item.path == path and method in (item.methods or set())
    )
    endpoint_codes, endpoint_mode = gate_two_requirement(route)
    matched = find_rule(
        catalog_rule_views(), path=_PARAM.sub(SAMPLE_ID, path), method=method
    )
    assert matched is not None
    assert matched.permission_codes == endpoint_codes
    if endpoint_codes:
        assert matched.match_mode == endpoint_mode


def test_internal_routes_have_no_seeded_rule() -> None:
    rules = catalog_rule_views()
    assert (
        find_rule(rules, path=f"{INTERNAL_PREFIX}/verify", method="GET") is None
    )
