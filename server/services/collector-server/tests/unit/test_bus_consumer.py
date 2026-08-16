"""守命令总线：四个动作各自的应答、超期直接丢、失败也要回一条。

⚠ 失败不回应答的话，发起方只能等到自己超时，而「超时」与「这个点位不存在」
在页面上长得一模一样。
"""

from typing import Any
from uuid import UUID, uuid4

from collector_server.apps.collect.bus.consumer import CommandConsumer
from collector_server.apps.collect.drivers.base import (
    BrowseItem,
    DriverCapabilities,
)
from collectwire import (
    ACTION_BROWSE,
    ACTION_BROWSE_SUBTREE,
    ACTION_READ,
    ACTION_WRITE,
    STATUS_ERROR,
    STATUS_OK,
)

NOW_MS = 1_767_323_045_000
LATER_MS = NOW_MS + 10_000
SOURCE_ID = UUID("0192f000-0000-7000-8000-000000000001")


class FakeTransport:
    """一条请求进、应答记在手上的假总线。"""

    def __init__(self, requests: list[dict[str, Any]] | None = None) -> None:
        self.requests = requests or []
        self.replies: list[tuple[str, dict[str, Any]]] = []
        self.blocked_s: list[float] = []
        self.ttls_s: list[int] = []

    async def take(self, *, block_s: float) -> dict[str, Any] | None:
        self.blocked_s.append(block_s)
        if not self.requests:
            return None
        return self.requests.pop(0)

    async def reply(self, request_id: str, payload: Any, *, ttl_s: int) -> None:
        self.ttls_s.append(ttl_s)
        self.replies.append((request_id, dict(payload)))

    async def close(self) -> None:
        return None


class FakeLocator:
    """按 id 给会话的假定位器。"""

    def __init__(self, sessions: dict[UUID, Any]) -> None:
        self.sessions = sessions

    def session_of(self, source_id: UUID) -> Any:
        return self.sessions.get(source_id)


class FakeSession:
    def __init__(self, driver: Any, *, is_online: bool = True) -> None:
        self.driver = driver
        self.is_online = is_online


def _consumer(transport: FakeTransport, sessions: dict[UUID, Any]) -> Any:
    return CommandConsumer(
        transport=transport,
        locator=FakeLocator(sessions),
        block_s=0.01,
        reply_ttl_s=60,
        clock=lambda: NOW_MS,
    )


def _request(action: str, **extra: Any) -> dict[str, Any]:
    envelope: dict[str, Any] = {
        "request_id": "req-1",
        "action": action,
        "source_id": str(SOURCE_ID),
        "deadline_ms": LATER_MS,
    }
    envelope.update(extra)
    return envelope


async def test_browse_returns_the_address_space_items(driver: Any) -> None:
    driver.items = [
        BrowseItem(
            address="ns=2;s=Dev",
            name="Dev",
            has_children=True,
            is_variable=False,
        )
    ]
    transport = FakeTransport([_request(ACTION_BROWSE)])
    consumer = _consumer(transport, {SOURCE_ID: FakeSession(driver)})
    assert await consumer.handle_once() is True
    _, payload = transport.replies[0]
    assert payload["status"] == STATUS_OK
    assert payload["data"]["items"][0]["address"] == "ns=2;s=Dev"


async def test_browse_subtree_replies_flat_items_that_know_their_parent(
    driver: Any,
) -> None:
    # ⚠ 平铺回来的结果必须带 parent，否则界面拼不回层级，只剩一张长清单
    driver.items = [
        BrowseItem(
            address="ns=2;s=Dev",
            name="Dev",
            has_children=True,
            is_variable=False,
        ),
        BrowseItem(
            address="ns=2;s=Dev.Temp",
            name="Temp",
            has_children=False,
            is_variable=True,
        ),
    ]
    transport = FakeTransport(
        [_request(ACTION_BROWSE_SUBTREE, parent="ns=2;s=Ch")]
    )
    consumer = _consumer(transport, {SOURCE_ID: FakeSession(driver)})
    await consumer.handle_once()
    data = transport.replies[0][1]["data"]
    assert [(one["parent"], one["address"]) for one in data["items"]] == [
        ("ns=2;s=Ch", "ns=2;s=Dev"),
        ("ns=2;s=Ch", "ns=2;s=Dev.Temp"),
    ]
    assert data["is_truncated"] is False


async def test_read_replies_one_sample_per_requested_point(driver: Any) -> None:
    driver.samples = [(21.5, NOW_MS, "good")]
    transport = FakeTransport(
        [_request(ACTION_READ, point_codes=["outlet_temp"])]
    )
    consumer = _consumer(transport, {SOURCE_ID: FakeSession(driver)})
    await consumer.handle_once()
    assert transport.replies[0][1]["data"]["samples"] == [
        {
            "point_code": "outlet_temp",
            "value": 21.5,
            "ts_ms": NOW_MS,
            "quality": "good",
        }
    ]


async def test_write_reaches_the_driver(driver: Any) -> None:
    transport = FakeTransport(
        [_request(ACTION_WRITE, point_code="setpoint", value=22)]
    )
    consumer = _consumer(transport, {SOURCE_ID: FakeSession(driver)})
    await consumer.handle_once()
    assert driver.writes == [("setpoint", 22)]
    assert transport.replies[0][1]["status"] == STATUS_OK


async def test_write_without_a_point_code_is_refused(driver: Any) -> None:
    transport = FakeTransport([_request(ACTION_WRITE, value=22)])
    consumer = _consumer(transport, {SOURCE_ID: FakeSession(driver)})
    await consumer.handle_once()
    assert transport.replies[0][1]["reason"] == "missing_point_code"


async def test_an_unknown_action_is_refused_by_name(driver: Any) -> None:
    transport = FakeTransport([_request("teleport")])
    consumer = _consumer(transport, {SOURCE_ID: FakeSession(driver)})
    await consumer.handle_once()
    assert transport.replies[0][1]["reason"] == "unknown_action"


async def test_a_source_without_a_session_answers_offline() -> None:
    transport = FakeTransport([_request(ACTION_BROWSE)])
    consumer = _consumer(transport, {})
    await consumer.handle_once()
    payload = transport.replies[0][1]
    assert payload["status"] == STATUS_ERROR
    assert payload["reason"] == "source_offline"


async def test_a_session_that_is_not_connected_answers_offline(
    driver: Any,
) -> None:
    transport = FakeTransport([_request(ACTION_BROWSE)])
    consumer = _consumer(
        transport, {SOURCE_ID: FakeSession(driver, is_online=False)}
    )
    await consumer.handle_once()
    assert transport.replies[0][1]["reason"] == "source_offline"


async def test_a_protocol_without_browse_says_so_instead_of_answering_empty(
    build_driver: Any,
) -> None:
    driver = build_driver(
        capabilities=DriverCapabilities(
            is_subscribe_supported=True,
            is_browse_supported=False,
            is_write_supported=False,
        )
    )
    transport = FakeTransport([_request(ACTION_BROWSE)])
    consumer = _consumer(transport, {SOURCE_ID: FakeSession(driver)})
    await consumer.handle_once()
    payload = transport.replies[0][1]
    assert payload["status"] == STATUS_ERROR
    assert payload["reason"] == "browse_unsupported"


async def test_an_expired_request_is_dropped_without_an_answer(
    driver: Any,
) -> None:
    transport = FakeTransport([_request(ACTION_BROWSE, deadline_ms=NOW_MS - 1)])
    consumer = _consumer(transport, {SOURCE_ID: FakeSession(driver)})
    await consumer.handle_once()
    assert transport.replies == []


async def test_a_malformed_envelope_is_dropped(driver: Any) -> None:
    transport = FakeTransport([{"action": "browse"}])
    consumer = _consumer(transport, {SOURCE_ID: FakeSession(driver)})
    assert await consumer.handle_once() is False
    assert transport.replies == []


async def test_an_idle_bus_reports_no_work() -> None:
    transport = FakeTransport([])
    consumer = _consumer(transport, {})
    assert await consumer.handle_once() is False


async def test_a_driver_failure_is_answered_with_a_reason(
    build_driver: Any,
) -> None:
    driver = build_driver()

    async def boom(_parent: str | None) -> list[BrowseItem]:
        raise RuntimeError("现场炸了")

    driver.browse = boom
    transport = FakeTransport([_request(ACTION_BROWSE)])
    consumer = _consumer(
        transport, {uuid4(): None, SOURCE_ID: FakeSession(driver)}
    )
    await consumer.handle_once()
    assert transport.replies[0][1]["reason"] == "driver_failed"
