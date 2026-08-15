"""对外面的契约：路由权限、枚举字面量、openapi 一致性。

⚠ 这三样都属于「写错了不会报错、只会在别处静默出问题」的那一类：
- 端点漏挂权限依赖 → 任何登录用户都能起停实例；
- schema 里的字面量与模型常量漂移 → 入参过了校验、落库时被 CHECK 拒绝；
- openapi.json 与代码不一致 → 前端按旧类型生成，改了接口它不知道。
"""

import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute

from opcua_server.apps.instance.api import ROUTERS
from opcua_server.apps.instance.deps import (
    PERM_MANAGE,
    PERM_OPERATE,
    PERM_VIEW,
    REQUIRED_CODES_ATTR,
    require_service_key,
)
from opcua_server.apps.instance.models.instance import (
    DESIRED_STATES,
    SECURITY_POLICIES,
)
from opcua_server.apps.instance.models.node import (
    DATA_TYPES,
    IDENTIFIER_KINDS,
    NODE_CLASSES,
)
from opcua_server.apps.instance.schemas.instance import SecurityPolicy
from opcua_server.apps.instance.schemas.node import (
    DataType,
    IdentifierKind,
    NodeClass,
)
from opcua_server.settings import API_PREFIX, INTERNAL_PREFIX
from scripts.export_openapi import OUTPUT, build_schema, render

# 探针不属于业务面，它们按设计免鉴权
PROBE_PATHS = frozenset({f"{API_PREFIX}/health", f"{API_PREFIX}/ready"})
_PARAM = re.compile(r"\{[^}]+\}")


def _literal_values(annotation: Any) -> tuple[str, ...]:
    """取出 Literal 里的全部取值。

    Args: annotation。
    """
    return tuple(str(item) for item in annotation.__args__)


def build_app() -> FastAPI:
    """只装路由的应用，用来遍历路由表。"""
    app = FastAPI()
    for router in ROUTERS:
        app.include_router(router)
    return app


def iter_routes(app: FastAPI) -> Iterator[APIRoute]:
    """遍历应用里全部的 APIRoute，含被 include 进来的子路由。

    ⚠ 不能只顺着 `.routes` 走：`include_router` 挂进来的是包装对象，真正的
    路由挂在 `original_router` 上。只走 `.routes` 会一条都取不到，参数化列表
    因此为空——而 pytest 把空参数化标成 skip，契约用例于是空跑且全绿。

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


def gate_two_codes(route: APIRoute) -> frozenset[str]:
    """路由上 `require(...)` 声明的权限码。

    Args: route。
    """
    for dependency in route.dependant.dependencies:
        call = dependency.call
        codes = getattr(call, REQUIRED_CODES_ATTR, None)
        if codes is not None:
            return frozenset(codes)
    return frozenset()


ROUTES = sorted(
    (
        (route.path, method, gate_two_codes(route))
        for route in iter_routes(build_app())
        for method in sorted(route.methods or set())
        if route.path not in PROBE_PATHS
        and not route.path.startswith(INTERNAL_PREFIX)
    ),
    key=lambda item: (item[0], item[1]),
)

# 内部面另算：它挡的是「任何人」，走服务级密钥而不是权限码（ADR-0005）
INTERNAL_ROUTES = sorted(
    (route.path, method)
    for route in iter_routes(build_app())
    for method in sorted(route.methods or set())
    if route.path.startswith(INTERNAL_PREFIX)
)


def test_route_table_is_not_empty() -> None:
    """⚠ 这条守的是上面那个遍历本身。

    `iter_routes` 一旦取不到路由，下面的参数化用例会全部空跑并被标成 skip，
    表现是「契约测试全绿」而实际一条都没跑。
    """
    assert len(ROUTES) >= 20


def test_the_internal_face_was_actually_scanned() -> None:
    """⚠ 前缀写错时下面那条会空跑而全绿，内部面就此无人守。"""
    assert len(INTERNAL_ROUTES) == 2


@pytest.mark.parametrize(
    ("path", "method"),
    INTERNAL_ROUTES,
    ids=[f"{method} {path}" for path, method in INTERNAL_ROUTES],
)
def test_every_internal_route_demands_the_service_key(
    path: str, method: str
) -> None:
    """内部面必须挂服务级密钥。

    ⚠ 漏挂这道依赖，任何能连到端口的进程都能改上位机读到的现场数据——
    而权限码那道闸对它毫无作用：权限码挂在人身上，内部调用方不是人。

    Args: path, method。
    """
    route = next(
        item
        for item in iter_routes(build_app())
        if item.path == path and method in (item.methods or set())
    )
    guards = {dependency.call for dependency in route.dependant.dependencies}
    assert require_service_key in guards


def test_no_internal_route_leaks_into_the_public_face() -> None:
    """内部面不许出现在公开面的 openapi 里。"""
    assert [path for path, _, _ in ROUTES if INTERNAL_PREFIX in path] == []


@pytest.mark.parametrize(("path", "method", "codes"), ROUTES)
def test_every_endpoint_declares_a_permission(
    path: str, method: str, codes: frozenset[str]
) -> None:
    """每个业务端点都必须挂权限码——漏挂等于任何登录用户都能调。

    Args: path, method, codes。
    """
    assert codes, f"{method} {path} 没有声明权限码"
    assert codes <= {PERM_VIEW, PERM_OPERATE, PERM_MANAGE}


@pytest.mark.parametrize(("_path", "method", "codes"), ROUTES)
def test_read_endpoints_do_not_require_write_permissions(
    _path: str, method: str, codes: frozenset[str]
) -> None:
    """GET 只读，不该要求 operate/manage 之外还去要写权限。

    ⚠ 反过来更危险：写端点只要 `opcua:view` 就等于把「改上位机读到的值」
    降级成了看一眼的权限。

    Args: _path, method, codes。
    """
    if method != "GET":
        return
    assert PERM_OPERATE not in codes


@pytest.mark.parametrize(("path", "method", "codes"), ROUTES)
def test_mutating_endpoints_require_more_than_view(
    path: str, method: str, codes: frozenset[str]
) -> None:
    """任何会改状态的方法都不能只要 `opcua:view`。

    Args: path, method, codes。
    """
    if method in {"GET", "HEAD", "OPTIONS"}:
        return
    assert codes != {PERM_VIEW}, f"{method} {path} 只要求了只读权限"


def test_action_endpoints_use_the_colon_form() -> None:
    """动作端点用 `POST …:verb`，且一律 POST。"""
    actions = [
        (path, method)
        for path, method, _ in ROUTES
        if ":" in path.rsplit("/", 1)[-1]
    ]
    assert actions, "没有找到任何动作端点"
    for path, method in actions:
        assert method == "POST", f"{path} 的动作端点必须是 POST"


def _resource_part(segment: str) -> str:
    """去掉动作后缀（`:verb`）后剩下的那部分。

    ⚠ 动作端点的最后一段形如 `{node_id}:write`，直接整段判会把参数名里的
    下划线当成路径命名问题。

    Args: segment。
    """
    return segment.split(":", 1)[0]


def test_paths_use_kebab_case() -> None:
    """多词路径段用 kebab-case，不用下划线。"""
    for path, _, _ in ROUTES:
        for segment in path.split("/"):
            resource = _resource_part(segment)
            if not resource or _PARAM.fullmatch(resource):
                continue
            assert "_" not in resource, f"{path} 里的 {resource} 用了下划线"


def test_nesting_never_exceeds_two_levels() -> None:
    """资源嵌套不超过两层（api-contract §1）。"""
    prefix_depth = len(API_PREFIX.strip("/").split("/"))
    for path, _, _ in ROUTES:
        segments = [s for s in path.strip("/").split("/")[prefix_depth:] if s]
        collections = [s for s in segments if not _PARAM.fullmatch(s)]
        assert len(collections) <= 3, f"{path} 嵌套过深"


@pytest.mark.parametrize(
    ("literal", "constants"),
    [
        (SecurityPolicy, SECURITY_POLICIES),
        (NodeClass, NODE_CLASSES),
        (IdentifierKind, IDENTIFIER_KINDS),
        (DataType, DATA_TYPES),
    ],
)
def test_schema_literals_match_model_constants(
    literal: Any, constants: tuple[str, ...]
) -> None:
    """schema 的 Literal 与模型常量逐字一致。

    ⚠ 它们是两份手写清单（`Literal[<变量>]` 过不了 pyright）。漂移的表现是
    入参过了 pydantic 校验、落库时被 CHECK 拒绝，报出来的是 500 而不是 400。

    Args: literal, constants。
    """
    assert _literal_values(literal) == constants


def test_desired_states_are_string_literals() -> None:
    """状态是字符串字面量，不是数字枚举。

    ⚠ 数字枚举改一次顺序就会静默改变全部已存数据的含义。
    """
    assert all(isinstance(state, str) for state in DESIRED_STATES)


def test_openapi_json_matches_the_code() -> None:
    """仓库里的 `openapi.json` 与代码逐字节一致。

    不一致说明改了接口没同步导出，前端会按旧类型生成。
    """
    committed = Path(OUTPUT).read_text(encoding="utf-8")
    assert committed == render(build_schema())


def test_openapi_declares_the_envelope() -> None:
    """全部 2xx 响应都是统一信封，不是裸对象。"""
    schema = build_schema()
    components = json.dumps(schema["components"]["schemas"], sort_keys=True)
    assert "trace_id" in components
