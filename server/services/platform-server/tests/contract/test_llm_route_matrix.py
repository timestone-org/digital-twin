"""模型供应商面每条路由声明的闸 2 权限码，与闸 1（auth-server 目录）逐字一致。

⚠ 双口径漂移完全静默：边缘的规则说要 `llm:view`、端点上写的是 `llm:manage`，
两边都不会报错，只会在某个账号身上表现为「按钮亮着但点了 403」或反过来。

⚠ 闸 1 的规则表在 auth-server，服务之间不许互相 import，故这里只能把那套口径
复述成 `EXPECTED`：`llm-*` 的 GET 要 `llm:view`，其余方法要 `llm:manage`。
"""

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute

from platform_server.apps.llm_providers.api import ROUTERS
from platform_server.apps.llm_providers.catalog import LLM_MANAGE, LLM_VIEW
from platform_server.apps.llm_providers.deps import require_service_key
from platform_server.deps import REQUIRED_CODES_ATTR
from platform_server.settings import API_PREFIX, INTERNAL_PREFIX

# 对外端点的条数。写死是为了让「加了端点没加规则」在这里红
PUBLIC_ROUTE_COUNT = 15


def _routes() -> list[APIRoute]:
    app = FastAPI()
    for router in ROUTERS:
        app.include_router(router)
    found: list[APIRoute] = []
    stack: list[Any] = list(app.routes)
    while stack:
        item = stack.pop()
        if isinstance(item, APIRoute):
            found.append(item)
        for attribute in ("routes", "original_router"):
            nested = getattr(item, attribute, None)
            if nested is None:
                continue
            stack.extend(nested if isinstance(nested, list) else [nested])
    return found


def _codes_of(route: APIRoute) -> frozenset[str]:
    codes: set[str] = set()
    for dependency in route.dependant.dependencies:
        declared = getattr(dependency.call, REQUIRED_CODES_ATTR, None)
        if declared:
            codes.update(declared)
        for inner in dependency.dependencies:
            declared = getattr(inner.call, REQUIRED_CODES_ATTR, None)
            if declared:
                codes.update(declared)
    return frozenset(codes)


def _public() -> list[tuple[str, str, frozenset[str]]]:
    return [
        (route.path, method, _codes_of(route))
        for route in _routes()
        if route.path.startswith(API_PREFIX)
        for method in route.methods
    ]


def test_the_public_face_has_the_documented_number_of_routes() -> None:
    assert len(_public()) == PUBLIC_ROUTE_COUNT


@pytest.mark.parametrize(("path", "method", "codes"), _public())
def test_each_public_route_matches_gate_one(
    path: str, method: str, codes: frozenset[str]
) -> None:
    """GET 要 view，其余要 manage——与 auth-server 的 923/924 两条逐字一致。

    Args: path, method, codes。
    """
    expected = (
        frozenset({LLM_VIEW}) if method == "GET" else frozenset({LLM_MANAGE})
    )
    assert codes == expected, f"{method} {path} 声明的是 {sorted(codes)}"


def test_the_internal_face_is_guarded_by_the_service_key_only() -> None:
    """内部两条都带口令等价物（明文密钥、短时令牌）：只认服务级密钥，
    不认任何人的权限码，也一律不进 openapi。"""
    internal = [
        route for route in _routes() if route.path.startswith(INTERNAL_PREFIX)
    ]
    assert sorted(route.path for route in internal) == sorted(
        (
            f"{INTERNAL_PREFIX}/llm-catalog",
            f"{INTERNAL_PREFIX}/llm-credentials/{{provider_id}}:token",
        )
    )
    for route in internal:
        assert _codes_of(route) == frozenset()
        guards = [
            dependency.call for dependency in route.dependant.dependencies
        ]
        assert require_service_key in guards
        assert route.include_in_schema is False
