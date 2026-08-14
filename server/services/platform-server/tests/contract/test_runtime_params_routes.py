"""运行参数三条路由的形状与闸 2 声明。

⚠ 双口径漂移完全静默：边缘的规则说要 `dashboard:view`、端点上写的是别的码，
两边都不会报错，只会在某个账号身上表现为「按钮亮着但点了 403」或反过来。

⚠ 闸 1 的规则表在 **auth-server**，服务之间不许互相 import，故这里只能把那套
口径复述成 `EXPECTED`。改了那边就要改这里。
"""

from typing import Any

import pytest
from fastapi.routing import APIRoute

from platform_server.apps.dashboard.catalog import (
    DASHBOARD_EDIT,
    DASHBOARD_VIEW,
)
from platform_server.apps.runtime_params.api import ROUTERS
from platform_server.apps.runtime_params.deps import (
    REQUIRED_CODES_ATTR,
    REQUIRED_MODE_ATTR,
)
from platform_server.settings import API_PREFIX

RUNTIME_PARAMS = f"{API_PREFIX}/runtime-params"
SECTION = f"{RUNTIME_PARAMS}/{{section}}"

# 与 auth-server catalog 里 runtime-params 那几条窄规则逐字对应
EXPECTED: dict[tuple[str, str], frozenset[str]] = {
    (RUNTIME_PARAMS, "GET"): frozenset({DASHBOARD_VIEW}),
    (SECTION, "PUT"): frozenset({DASHBOARD_EDIT}),
    (f"{SECTION}:reset", "POST"): frozenset({DASHBOARD_EDIT}),
}


def routes() -> list[APIRoute]:
    """本模块登记的全部路由。"""
    return [
        route
        for router in ROUTERS
        for route in router.routes
        if isinstance(route, APIRoute)
    ]


def route_cases() -> list[tuple[str, str]]:
    """全部 (路径, 方法)。"""
    return [
        (route.path, method)
        for route in routes()
        for method in sorted(route.methods or set())
        if method not in {"HEAD", "OPTIONS"}
    ]


def gate_two_requirement(route: APIRoute) -> tuple[frozenset[str], str]:
    """端点自己声明的权限码与判定模式。

    Args: route。
    """
    codes: set[str] = set()
    mode = "all"
    pending: list[Any] = list(route.dependant.dependencies)
    while pending:
        dependency = pending.pop()
        declared = getattr(dependency.call, REQUIRED_CODES_ATTR, None)
        if declared is not None:
            codes |= set(declared)
            mode = getattr(dependency.call, REQUIRED_MODE_ATTR, "all")
        pending.extend(dependency.dependencies)
    return frozenset(codes), mode


CASES = route_cases()


def test_the_route_table_was_actually_scanned() -> None:
    # ⚠ 扫不到路由等于下面那些断言没跑，而空参数化在 pytest 里是 skip 不是红
    assert len(CASES) == len(EXPECTED)


def test_the_registered_routes_are_exactly_the_contracted_ones() -> None:
    assert sorted(CASES) == sorted(EXPECTED)


def test_every_route_lives_under_the_service_prefix() -> None:
    stray = [path for path, _ in CASES if not path.startswith(API_PREFIX)]
    assert stray == []


@pytest.mark.parametrize(
    ("path", "method"),
    CASES,
    ids=[f"{method} {path}" for path, method in CASES],
)
def test_gate_two_requires_the_code_gate_one_requires(
    path: str, method: str
) -> None:
    route = next(
        item
        for item in routes()
        if item.path == path and method in (item.methods or set())
    )
    codes, mode = gate_two_requirement(route)
    assert (codes, mode) == (EXPECTED[path, method], "all")


def test_the_action_endpoint_answers_only_post() -> None:
    # 动作端点一律 POST（api-contract §2），别的方法挂上去闸门会红
    actions = {method for path, method in CASES if path.endswith(":reset")}
    assert actions == {"POST"}
