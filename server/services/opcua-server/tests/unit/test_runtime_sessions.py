"""会话注册表：登记、注销、per-instance 隔离。"""

from datetime import UTC, datetime

from lib.testing import FrozenClock
from opcua_server.apps.instance.runtime.sessions import (
    SessionRegistry,
    format_peer,
)


def test_tuple_peer_is_formatted_as_host_port() -> None:
    assert format_peer(("10.0.0.2", 51234)) == "10.0.0.2:51234"


def test_list_peer_is_formatted_as_host_port() -> None:
    assert format_peer(["10.0.0.2", 51234]) == "10.0.0.2:51234"


def test_string_peer_passes_through() -> None:
    assert format_peer("10.0.0.2:51234") == "10.0.0.2:51234"


def test_none_peer_does_not_crash() -> None:
    assert format_peer(None) == "None"


def test_activated_session_is_listed() -> None:
    registry = SessionRegistry(clock=FrozenClock())
    registry.activated("s1", ("10.0.0.2", 1), "scada")
    assert [record.session_id for record in registry.records()] == ["s1"]


def test_activated_session_carries_peer_and_username() -> None:
    registry = SessionRegistry(clock=FrozenClock())
    registry.activated("s1", ("10.0.0.2", 1), "scada")
    record = registry.records()[0]
    assert (record.peer, record.username) == ("10.0.0.2:1", "scada")


def test_anonymous_session_has_no_username() -> None:
    registry = SessionRegistry(clock=FrozenClock())
    registry.activated("s1", ("10.0.0.2", 1), None)
    assert registry.records()[0].username is None


def test_connected_at_comes_from_the_injected_clock() -> None:
    clock = FrozenClock(current=datetime(2026, 8, 12, tzinfo=UTC))
    registry = SessionRegistry(clock=clock)
    registry.activated("s1", ("10.0.0.2", 1), None)
    assert registry.records()[0].connected_at == clock.current


def test_closed_session_disappears() -> None:
    registry = SessionRegistry(clock=FrozenClock())
    registry.activated("s1", ("10.0.0.2", 1), None)
    registry.closed("s1")
    assert registry.records() == []


def test_closing_an_unknown_session_is_a_no_op() -> None:
    registry = SessionRegistry(clock=FrozenClock())
    registry.closed("nope")
    assert registry.count() == 0


def test_records_are_ordered_by_connection_time() -> None:
    clock = FrozenClock()
    registry = SessionRegistry(clock=clock)
    registry.activated("first", ("10.0.0.2", 1), None)
    clock.advance(5)
    registry.activated("second", ("10.0.0.3", 2), None)
    assert [record.session_id for record in registry.records()] == [
        "first",
        "second",
    ]


def test_reactivating_the_same_id_replaces_the_record() -> None:
    registry = SessionRegistry(clock=FrozenClock())
    registry.activated("s1", ("10.0.0.2", 1), "old")
    registry.activated("s1", ("10.0.0.9", 9), "new")
    assert registry.count() == 1
    assert registry.records()[0].username == "new"


def test_registries_do_not_share_state_across_instances() -> None:
    """⚠ 这条守的是 CONTEXT §4：连接数绝不能跨实例相加。"""
    one = SessionRegistry(clock=FrozenClock())
    other = SessionRegistry(clock=FrozenClock())
    one.activated("s1", ("10.0.0.2", 1), None)
    assert (one.count(), other.count()) == (1, 0)
