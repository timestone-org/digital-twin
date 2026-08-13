"""钉死 asyncua 的两个子类扩展点。

⚠ 这一层守的是**升级时静默失效**：`asyncua` 不承诺这两处的稳定性，一旦上游
改了签名或把同步方法改成协程，会话追踪会安静地不再登记任何东西——页面上
「在线客户端 0」，而实际连着一片。CONTEXT.md §5 承诺的「响亮失败」就靠这里。

版本钉死在 pyproject（`asyncua==1.1.8`）；升级时本文件必须一起过。
"""

import inspect
from importlib.metadata import version

from asyncua import Server, ua
from asyncua.common import manage_nodes
from asyncua.common.node import Node
from asyncua.server.internal_server import InternalServer
from asyncua.server.internal_session import InternalSession
from asyncua.server.uaprocessor import UaProcessor

from opcua_server.apps.instance.runtime.sessions import (
    SessionRegistry,
    TrackedSession,
    TrackingInternalServer,
)

PINNED_VERSION = "1.1.8"


def test_pinned_version_is_the_one_installed() -> None:
    """签名断言只对这个版本成立；换了版本就得重新核对本文件。"""
    assert version("asyncua") == PINNED_VERSION


def test_server_accepts_an_injected_internal_server() -> None:
    """`Server(iserver=...)` 是注入点。没有它就只剩 monkey-patch 一条路。"""
    parameters = inspect.signature(Server.__init__).parameters
    assert "iserver" in parameters


def test_create_session_keeps_its_three_parameters() -> None:
    """`name` 承载对端地址；少了它就无从知道是谁连上来的。"""
    parameters = inspect.signature(InternalServer.create_session).parameters
    assert list(parameters) == ["self", "name", "user", "external"]


def test_create_session_is_not_a_coroutine() -> None:
    """改成协程会让我们的同步覆盖变成「返回协程对象」，且不报错。"""
    assert not inspect.iscoroutinefunction(InternalServer.create_session)


def test_activate_session_keeps_its_two_parameters() -> None:
    parameters = inspect.signature(InternalSession.activate_session).parameters
    assert list(parameters) == ["self", "params", "peer_certificate"]


def test_activate_session_is_synchronous() -> None:
    """⚠ 它是同步的。改成协程时我们的覆盖必须一起改，否则登记全部丢失。"""
    assert not inspect.iscoroutinefunction(InternalSession.activate_session)


def test_close_session_is_a_coroutine_with_delete_subs() -> None:
    parameters = inspect.signature(InternalSession.close_session).parameters
    assert list(parameters) == ["self", "delete_subs"]
    assert inspect.iscoroutinefunction(InternalSession.close_session)


def test_connection_count_is_a_class_attribute_and_stays_unused() -> None:
    """⚠ 它是类属性，跨实例相加。断言它仍是类属性，提醒别去用它。"""
    assert "_current_connections" in vars(InternalSession)


def test_uaprocessor_takes_the_peer_name_from_the_transport() -> None:
    """对端地址的来源：`UaProcessor` 把 peername 传给 `create_session`。"""
    source = inspect.getsource(UaProcessor.__init__)
    assert 'get_extra_info("peername")' in source


def test_uaprocessor_passes_its_name_into_create_session() -> None:
    source = inspect.getsource(UaProcessor)
    assert "self.iserver.create_session(self.name" in source


def test_our_server_subclass_produces_tracked_sessions() -> None:
    """注入点真的接上了：造出来的会话是我们的子类，且带着注册表。"""
    registry = SessionRegistry()
    server = TrackingInternalServer(registry)
    session = server.create_session(("10.0.0.2", 51234))
    assert isinstance(session, TrackedSession)
    assert session.registry is registry


def test_our_session_is_still_an_internal_session() -> None:
    """asyncua 内部按 InternalSession 使用它，继承链断了会到处出错。"""
    registry = SessionRegistry()
    session = TrackingInternalServer(registry).create_session("peer")
    assert isinstance(session, InternalSession)


def test_close_session_keeps_the_upstream_parameter_name() -> None:
    """我们的覆盖沿用上游形参名 `delete_subs`，不能各叫各的。

    ⚠ 上游一旦改名，我们的覆盖就与基类不兼容（pyright 判 LSP 违规），
    而按关键字调用时还会直接 TypeError——这条测试让它在升级时先红。
    """
    signature = inspect.signature(InternalSession.close_session)
    assert list(signature.parameters) == ["self", "delete_subs"]


def test_create_session_is_called_with_the_external_keyword() -> None:
    """⚠ `external` 的形参名不能改：上游按关键字传它。

    本仓的布尔命名规范要求 `is_`/`has_`/`should_` 前缀，这里做不到——
    形参名由第三方的调用点决定。相关豁免见 pyproject 的闸门配置。
    """
    source = inspect.getsource(UaProcessor)
    assert "create_session(self.name, external=True)" in source


def test_delete_nodes_reports_failure_in_its_return_value() -> None:
    """⚠ `delete_nodes` 删不掉时**不抛异常**，失败写在返回的状态码里。

    我们靠查状态码来「删不掉就抛」。上游哪天改成抛异常、或改了返回形状，
    这条会红——否则我们会退化成参考实现那样静默半成功。
    """
    signature = inspect.signature(Server.delete_nodes)
    assert list(signature.parameters) == ["self", "nodes", "recursive"]
    source = inspect.getsource(manage_nodes.delete_nodes)
    assert "return list(nodes), await session.delete_nodes(params)" in source


def test_status_code_exposes_is_good() -> None:
    """状态码的判定 API 是 `is_good()`；改名会让失败检查静默失效。"""
    assert ua.StatusCode().is_good()
    assert not ua.StatusCode(ua.StatusCodes.BadNodeIdUnknown).is_good()


def test_set_writable_toggles_current_write_on_both_access_attributes() -> None:
    """⚠ 热改可写位靠 `set_writable`：它必须同时置/清 AccessLevel 与
    UserAccessLevel 的 CurrentWrite 位——服务端对外部会话的写值把这两位
    **都**校验，上游只动其一时热改会静默失效为「管理面以为改了」。
    """
    source = inspect.getsource(Node.set_writable)
    for attribute in ("AccessLevel", "UserAccessLevel"):
        bit = f"ua.AttributeIds.{attribute}, ua.AccessLevel.CurrentWrite"
        assert f"set_attr_bit({bit})" in source
        assert f"unset_attr_bit({bit})" in source
