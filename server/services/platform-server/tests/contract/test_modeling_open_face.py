"""对外推理面的契约：这是本仓第二个匿名可达的前缀，形状要钉死。

⚠ 这一组防的是**「漏挂一个依赖 = 那条路径整个匿名开放」**，而它不会报任何错：
路由照常注册、请求照常 200，只是没人问过凭据
（docs/MODELING_PLATFORM_DESIGN.md D14）。
"""

import ast
import inspect
import json
import textwrap
from pathlib import Path

from platform_server.apps.modeling.api import ROUTERS, open_models
from platform_server.apps.modeling.services import open_model_service
from platform_server.apps.modeling.services.open_model_service import (
    INVALID_KEY_MESSAGE,
)

SOURCE = (
    Path(__file__).resolve().parents[2]
    / "src/platform_server/apps/modeling/api/open_models.py"
)
SPEC = Path(__file__).resolve().parents[2] / "openapi.json"
OPEN_PREFIX = "/api/v1/platform/open-models"
# 鉴权就是这个依赖本身。⚠ 名字写死：改名时这一条会红，而那正是要的
CALL_DEPENDENCY = "CallDep"


def _routes() -> list[ast.FunctionDef | ast.AsyncFunctionDef]:
    """本文件里挂了路由装饰器的那些函数。"""
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    return [
        node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.decorator_list
    ]


def _annotations(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    """一个函数每个形参的注解源文本。

    Args: node。
    """
    return [
        ast.unparse(arg.annotation)
        for arg in node.args.args
        if arg.annotation is not None
    ]


def test_every_open_route_carries_the_auth_dependency() -> None:
    """对外面每一个路由函数都挂着那个鉴权依赖。

    ⚠ 漏一个的表现不是报错，是那条路径整个匿名开放。
    """
    missing = [
        node.name
        for node in _routes()
        if CALL_DEPENDENCY not in _annotations(node)
    ]
    assert missing == []


def test_the_open_face_has_exactly_the_two_documented_endpoints() -> None:
    """对外面只有两个端点：读签名与预测。

    ⚠ 这一条钉的是**面的大小**：匿名可达的东西越少越好，多一个端点就要多想
    一遍它会不会漏出内部信息。
    """
    paths = sorted(
        route.path  # pyright: ignore[reportUnknownMemberType]
        for route in open_models.open_models.routes
    )
    assert paths == [
        f"{OPEN_PREFIX}/{{code}}",
        f"{OPEN_PREFIX}/{{code}}:predict",
    ]


def test_the_open_prefix_is_registered_once() -> None:
    """对外面只登记一次，且它确实在服务的路由表里。"""
    prefixes = [
        router.prefix  # pyright: ignore[reportUnknownMemberType]
        for router in ROUTERS
    ]
    assert prefixes.count(OPEN_PREFIX) == 1


def test_the_key_never_travels_in_the_url() -> None:
    """密钥只从头里取，绝不接受查询参数。

    ⚠ URL 会进访问日志、进浏览器历史、进代理的缓存键（防线 ⑪）。
    """
    text = SOURCE.read_text(encoding="utf-8")
    assert 'Header(alias="X-Api-Key")' in text
    assert "Query(" not in text


def test_the_refusal_says_nothing_about_why() -> None:
    """密钥无效时只说这四个字。

    ⚠ 区分「不存在」「已撤销」「已过期」等于送一个枚举接口（防线 ⑪）。
    """
    assert INVALID_KEY_MESSAGE == "密钥无效"


def test_the_open_endpoints_declare_the_key_header() -> None:
    """两个端点在 openapi 上都声明了 `X-Api-Key`，第三方照它对接。"""
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    for path in (f"{OPEN_PREFIX}/{{code}}", f"{OPEN_PREFIX}/{{code}}:predict"):
        operations = spec["paths"][path]
        for operation in operations.values():
            names = [item["name"] for item in operation.get("parameters", [])]
            assert "X-Api-Key" in names


def test_the_call_log_is_written_in_its_own_transaction() -> None:
    """调用记录走**自己的**会话，不借请求那条。

    ⚠ 这一条只能盯源码：用例里 HTTP 那侧与「另一条」会话共用一条连接（回滚
    事务的约束），跨事务这件事在用例里根本演不出来。而借请求那条的后果恰恰是
    「失败那一次」永远记不下来——请求出错时它整个回滚。
    """
    body = _stripped(inspect.getsource(open_model_service._record))
    assert "deps.sessions.session()" in body


def test_a_failed_call_is_recorded_too() -> None:
    """失败那一次也记账：`predict` 抛出来时先记再抛。"""
    body = _stripped(inspect.getsource(open_model_service.predict_and_record))
    assert "except AppError" in body
    assert body.index("_record") < body.index("raise")


def _stripped(source: str) -> str:
    """剥掉注释与文档串之后的源码。

    ⚠ 不剥的话，那几行写着「不许借请求那条」的注释本身就含着要断言的字样。
    Args: source。
    """
    tree = ast.parse(textwrap.dedent(source))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            node.body = [
                item
                for item in node.body
                if not (
                    isinstance(item, ast.Expr)
                    and isinstance(item.value, ast.Constant)
                    and isinstance(item.value.value, str)
                )
            ]
    return ast.unparse(tree)
