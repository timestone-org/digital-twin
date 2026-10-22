"""浏览分页的有界请求、续页标记与失效游标契约。"""

import pytest
from pydantic import ValidationError

from lib.errors import AppError
from platform_server.apps.collect.schemas.source import BrowseIn
from unit.collect_fakes import (
    ACTION_BROWSE,
    ACTION_BROWSE_SUBTREE,
    FakeCommandTransport,
)
from unit.test_collect_command_bus import SOURCE_ID, build_bus


def test_browse_defaults_to_a_bounded_page() -> None:
    request = BrowseIn()
    assert request.limit == 200
    assert request.continuation_token is None


@pytest.mark.parametrize("limit", [0, 501], ids=["zero", "over-limit"])
def test_browse_rejects_an_unbounded_page(limit: int) -> None:
    with pytest.raises(ValidationError):
        BrowseIn.model_validate({"limit": limit})


def test_browse_accepts_the_largest_page_and_a_cursor() -> None:
    request = BrowseIn.model_validate(
        {"limit": 500, "continuation_token": "next-page"}
    )
    assert request.limit == 500
    assert request.continuation_token == "next-page"


def test_browse_rejects_an_oversized_cursor() -> None:
    with pytest.raises(ValidationError):
        BrowseIn.model_validate({"continuation_token": "x" * 257})


def test_browse_rejects_an_empty_cursor() -> None:
    with pytest.raises(ValidationError):
        BrowseIn.model_validate({"continuation_token": ""})


async def test_browse_forwards_the_page_budget_and_cursor() -> None:
    transport = FakeCommandTransport(
        replies={ACTION_BROWSE: {"status": "ok", "data": {"items": []}}}
    )
    await build_bus(transport).browse(
        SOURCE_ID, "ns=2;s=Folder", limit=100, continuation_token="previous"
    )
    sent = transport.envelopes_of(ACTION_BROWSE)[0]
    assert sent["limit"] == 100
    assert sent["continuation_token"] == "previous"


async def test_legacy_browse_requests_do_not_advertise_paging_support() -> None:
    transport = FakeCommandTransport(
        replies={ACTION_BROWSE: {"status": "ok", "data": {"items": []}}}
    )
    await build_bus(transport).browse(SOURCE_ID, None, limit=None)
    sent = transport.envelopes_of(ACTION_BROWSE)[0]
    assert "limit" not in sent
    assert "continuation_token" not in sent


@pytest.mark.parametrize(
    "with_items", [False, True], ids=["cursor", "oversized"]
)
async def test_a_legacy_browse_response_never_silently_hides_additional_nodes(
    with_items: bool,
) -> None:
    data: dict[str, object] = {"items": []}
    if with_items:
        data["items"] = [{"address": "ns=2;s=Temp"}] * 201
    else:
        data["continuation_token"] = "next"
    transport = FakeCommandTransport(
        replies={ACTION_BROWSE: {"status": "ok", "data": data}}
    )
    with pytest.raises(AppError, match="刷新页面") as raised:
        await build_bus(transport).browse(SOURCE_ID, None, limit=None)
    assert raised.value.http_status == 400


async def test_a_large_legacy_folder_requires_a_browser_upgrade() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE: {
                "status": "error",
                "reason": "browse_page_too_large",
            }
        }
    )
    with pytest.raises(AppError, match="升级浏览客户端"):
        await build_bus(transport).browse(SOURCE_ID, None, limit=None)


@pytest.mark.parametrize("token", [None, "next-page"], ids=["last", "more"])
async def test_browse_preserves_the_cursor_and_derives_has_more(
    token: str | None,
) -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE: {
                "status": "ok",
                "data": {"items": [], "continuation_token": token},
            }
        }
    )
    outcome = await build_bus(transport).browse(SOURCE_ID, None)
    assert outcome.continuation_token == token
    assert outcome.has_more is (token is not None)


async def test_an_invalid_cursor_tells_the_user_to_refresh_the_folder() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE: {
                "status": "error",
                "reason": "browse_continuation_invalid",
            }
        }
    )
    with pytest.raises(AppError) as raised:
        await build_bus(transport).browse(SOURCE_ID, None)
    assert raised.value.http_status == 409
    assert "重新浏览" in str(raised.value)


@pytest.mark.parametrize(
    "token", ["", "x" * 257, 3], ids=["empty", "long", "number"]
)
async def test_a_malformed_cursor_is_not_reported_as_a_complete_folder(
    token: object,
) -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE: {
                "status": "ok",
                "data": {"items": [], "continuation_token": token},
            }
        }
    )
    with pytest.raises(AppError, match="续页无效"):
        await build_bus(transport).browse(SOURCE_ID, None)


async def test_an_old_collector_cannot_return_an_unbounded_folder() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE: {
                "status": "ok",
                "data": {"items": [{"address": "ns=2;s=A"}] * 201},
            }
        }
    )
    with pytest.raises(AppError, match="分页预算"):
        await build_bus(transport).browse(SOURCE_ID, None)


async def test_an_oversized_device_response_offers_alternatives() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE: {
                "status": "error",
                "reason": "browse_page_too_large",
            }
        }
    )
    with pytest.raises(AppError, match="导入点表") as raised:
        await build_bus(transport).browse(SOURCE_ID, None)
    assert raised.value.http_status == 400


async def test_an_old_collector_cannot_return_an_unbounded_subtree() -> None:
    transport = FakeCommandTransport(
        replies={
            ACTION_BROWSE_SUBTREE: {
                "status": "ok",
                "data": {
                    "items": [{"address": "ns=2;s=A"}] * 2001,
                    "is_truncated": False,
                },
            }
        }
    )
    with pytest.raises(AppError, match="子树节点预算") as raised:
        await build_bus(transport).browse_subtree(SOURCE_ID, None)
    assert raised.value.http_status == 502
