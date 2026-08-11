"""每条对外路由都必须自己声明权限码，且声明的是闸 1 那套里同一个码。

⚠ 双口径漂移完全静默：边缘的规则说要 `ac:view`、端点上写的是 `ac:manage`，
两边都不会报错，只会在某个账号身上表现为「按钮亮着但点了 403」或反过来。

⚠ 闸 1 的规则表在 **auth-server** 的 `apps/auth/catalog.py`，服务之间不许互相
import，故这里只能把那套口径复述成 `EXPECTED`。改了那边就要改这里——这是本
分支唯一一处没有机器把两侧钉在一起的地方。
"""

import re
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute

from platform_server.apps.hvac.api import ROUTERS
from platform_server.apps.hvac.catalog import AC_MANAGE, AC_VIEW
from platform_server.apps.hvac.deps import (
    REQUIRED_CODES_ATTR,
    REQUIRED_MODE_ATTR,
)
from platform_server.settings import API_PREFIX

SAMPLE_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
_PARAM = re.compile(r"\{[^}]+\}")

# 与 auth-server catalog 里 `/api/v1/platform/*` 那四条规则逐字对应
EXPECTED: dict[str, frozenset[str]] = {
    "GET": frozenset({AC_VIEW}),
    "POST": frozenset({AC_MANAGE}),
    "PATCH": frozenset({AC_MANAGE}),
    "DELETE": frozenset({AC_MANAGE}),
}
# 探针与文档不吃身份头，它们在边缘走免认证 location
UNGUARDED = frozenset(
    {
        f"{API_PREFIX}/health",
        f"{API_PREFIX}/ready",
        f"{API_PREFIX}/docs",
        f"{API_PREFIX}/redoc",
        f"{API_PREFIX}/openapi.json",
    }
)


def build_app() -> FastAPI:
    """只装路由，不连任何依赖。"""
    app = FastAPI()
    for router in ROUTERS:
        app.include_router(router)
    return app


def iter_routes(app: FastAPI) -> Iterator[APIRoute]:
    """遍历应用里全部的 APIRoute，含被 include 进来的子路由。

    ⚠ 不能只顺着 `.routes` 走：`include_router` 挂进来的是一个包装对象，
    真正的路由挂在它的 `original_router` 上。只走 `.routes` 会一条都取不到，
    参数化列表因此为空——而 pytest 把空参数化标成 skip，用例于是空跑且全绿。
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
    """端点自己声明的权限码与判定模式。

    Args: route。
    """
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
    """对外面的全部 (路径, 方法)。"""
    result: list[tuple[str, str]] = []
    for route in iter_routes(build_app()):
        if route.path in UNGUARDED:
            continue
        for method in sorted(route.methods or set()):
            if method in {"HEAD", "OPTIONS"}:
                continue
            result.append((route.path, method))
    return result


ROUTE_CASES = public_routes()


def test_the_route_table_was_actually_scanned() -> None:
    # ⚠ 扫不到路由就等于下面那条契约没跑，而空参数化在 pytest 里是 skip 不是红
    assert len(ROUTE_CASES) > 0


def test_every_public_route_lives_under_the_service_prefix() -> None:
    stray = [path for path, _ in ROUTE_CASES if not path.startswith(API_PREFIX)]
    assert stray == []


@pytest.mark.parametrize(
    ("path", "method"),
    ROUTE_CASES,
    ids=[f"{method} {path}" for path, method in ROUTE_CASES],
)
def test_gate_two_requires_the_code_gate_one_requires(
    path: str, method: str
) -> None:
    route = next(
        item
        for item in iter_routes(build_app())
        if item.path == path and method in (item.methods or set())
    )
    codes, mode = gate_two_requirement(route)
    assert codes == EXPECTED[method]
    assert mode == "all"


def test_no_public_route_is_left_unguarded() -> None:
    unguarded = [
        f"{method} {path}"
        for path, method in ROUTE_CASES
        if not gate_two_requirement(
            next(
                item
                for item in iter_routes(build_app())
                if item.path == path and method in (item.methods or set())
            )
        )[0]
    ]
    assert unguarded == []


def test_action_endpoints_are_post_only() -> None:
    # GET 带副作用会被各级缓存与预取毁掉
    wrong = [
        f"{method} {path}"
        for path, method in ROUTE_CASES
        if ":" in path.rsplit("/", maxsplit=1)[-1] and method != "POST"
    ]
    assert wrong == []


def test_path_parameters_are_substitutable_identifiers() -> None:
    # 路径参数只放标识，其它一切走 query 或 body
    for path, _ in ROUTE_CASES:
        assert "{" not in _PARAM.sub(SAMPLE_ID, path)
