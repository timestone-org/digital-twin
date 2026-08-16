"""守命令总线的信封：键名、动作字面量、应答形状与 traceparent。

⚠ 队列/总线不会自动传播链路：信封里漏了 `traceparent`，链路就在这一跳齐断
（observability §4.2）。
"""

from typing import Any
from uuid import UUID

from collector_server.apps.collect.bus.consumer import (
    SUPPORTED_ACTIONS,
    CommandConsumer,
    CommandRequest,
)
from collectwire import (
    ACTION_VALIDATE,
    ACTIONS,
    REPLY_PREFIX,
    REQUEST_KEY,
    STATUS_ERROR,
    STATUS_OK,
    TRACEPARENT_KEY,
    reply_key,
)
from lib.logging import current_traceparent

SOURCE_ID = UUID("0192f000-0000-7000-8000-000000000001")
NOW_MS = 1_767_323_045_000
# W3C traceparent：`00-<32 位>-<16 位>-01`
TRACEPARENT_PARTS = 4


class CapturingTransport:
    """把应答原样记下来的假总线。"""

    def __init__(self, requests: list[dict[str, Any]]) -> None:
        self.requests = requests
        self.replies: list[dict[str, Any]] = []
        self.blocked_s: list[float] = []
        self.ttls_s: list[int] = []

    async def take(self, *, block_s: float) -> dict[str, Any] | None:
        self.blocked_s.append(block_s)
        return self.requests.pop(0) if self.requests else None

    async def reply(self, request_id: str, payload: Any, *, ttl_s: int) -> None:
        self.ttls_s.append(ttl_s)
        # 真实现会在这里补上 traceparent，契约由 test_reply_carries_trace 守
        self.replies.append({"request_id": request_id, **dict(payload)})

    async def close(self) -> None:
        return None


class OfflineLocator:
    """永远说「这个数据源没有会话」的定位器。"""

    def __init__(self) -> None:
        self.asked: list[UUID] = []

    def session_of(self, source_id: UUID) -> None:
        self.asked.append(source_id)


def test_bus_keys_are_namespaced_by_the_owning_context() -> None:
    assert (REQUEST_KEY, REPLY_PREFIX) == (
        "collect:cmd:req",
        "collect:cmd:reply",
    )


def test_reply_key_is_per_request() -> None:
    assert reply_key("req-9") == "collect:cmd:reply:req-9"


def test_the_implemented_actions_are_a_subset_of_the_wire() -> None:
    """⚠ 线上存在但本服务没实现的动作要回 `unknown_action`，不能假装支持。"""
    assert set(SUPPORTED_ACTIONS) < set(ACTIONS)
    assert SUPPORTED_ACTIONS == ("browse", "browse_subtree", "read", "write")


def test_validate_is_on_the_wire_but_not_implemented_here_yet() -> None:
    """一期没实现它，发起方据此把结论记成「未校验」而不是「通过」。"""
    assert ACTION_VALIDATE in ACTIONS
    assert ACTION_VALIDATE not in SUPPORTED_ACTIONS


def test_request_needs_an_absolute_deadline() -> None:
    request = CommandRequest.model_validate(
        {
            "request_id": "req-1",
            "action": "browse",
            "source_id": str(SOURCE_ID),
            "deadline_ms": NOW_MS,
        }
    )
    assert request.deadline_ms == NOW_MS


def test_unknown_fields_from_platform_do_not_break_parsing() -> None:
    request = CommandRequest.model_validate(
        {
            "request_id": "req-1",
            "action": "browse",
            "source_id": str(SOURCE_ID),
            "deadline_ms": NOW_MS,
            "invented_later": True,
        }
    )
    assert request.action == "browse"


async def test_failure_reply_carries_status_and_a_stable_reason() -> None:
    transport = CapturingTransport(
        [
            {
                "request_id": "req-1",
                "action": "browse",
                "source_id": str(SOURCE_ID),
                "deadline_ms": NOW_MS + 1000,
            }
        ]
    )
    consumer = CommandConsumer(
        transport=transport,
        locator=OfflineLocator(),
        block_s=0.01,
        reply_ttl_s=60,
        clock=lambda: NOW_MS,
    )
    await consumer.handle_once()
    assert transport.replies[0]["status"] == STATUS_ERROR
    assert transport.replies[0]["reason"] == "source_offline"


def test_success_and_failure_use_two_stable_status_words() -> None:
    assert (STATUS_OK, STATUS_ERROR) == ("ok", "error")


def test_traceparent_is_well_formed_even_without_a_request_context() -> None:
    parts = current_traceparent().split("-")
    assert len(parts) == TRACEPARENT_PARTS
    assert (parts[0], parts[3]) == ("00", "01")


def test_the_envelope_key_for_the_trace_is_the_w3c_name() -> None:
    assert TRACEPARENT_KEY == "traceparent"
