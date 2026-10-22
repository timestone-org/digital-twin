"""守地址空间分页的条数、续读身份与服务端资源释放。"""

import asyncio

import pytest
from asyncua import ua

from collector_server.apps.collect.drivers.base import (
    BrowseContinuationInvalid,
    BrowsePageTooLarge,
)
from collector_server.apps.collect.drivers.opcua.browse import (
    BROWSE_CURSOR_TTL_MS,
    MAX_BROWSE_CURSORS,
    MAX_BUFFERED_REFERENCES,
)
from unit.test_drivers_opcua_driver import _child, _driver


async def test_large_folder_reads_and_returns_only_the_requested_page() -> None:
    driver, clients = _driver()
    await driver.connect()
    clients[0].nodes.objects.children = [
        _child(f"P{index}", is_variable=True) for index in range(10_000)
    ]
    page = await driver.browse_page(None, limit=200)
    assert len(page.items) == 200
    assert page.continuation_token is not None
    assert sum(len(nodes) for _, nodes in clients[0].asked) == 200


async def test_legacy_driver_browse_never_silently_truncates_the_folder() -> (
    None
):
    driver, clients = _driver()
    await driver.connect()
    clients[0].nodes.objects.children = [
        _child(f"P{index}", is_variable=True) for index in range(201)
    ]
    try:
        with pytest.raises(BrowsePageTooLarge, match="分页"):
            await driver.browse(None)
        assert clients[0].continuations == {}
        assert clients[0].released == [b"0"]
    finally:
        await driver.disconnect()


async def test_browsing_keeps_the_browse_budget_and_types_use_request_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver, clients = _driver()
    await driver.connect()
    clients[0].nodes.objects.children = [_child("P0", is_variable=True)]
    budgets: list[float | None] = []
    native_timeout = asyncio.timeout

    def timeout(delay: float | None) -> asyncio.Timeout:
        budgets.append(delay)
        return native_timeout(delay)

    monkeypatch.setattr(asyncio, "timeout", timeout)
    try:
        await driver.browse_page(None)
        assert budgets == [10.0, 3.0]
    finally:
        await driver.disconnect()


async def test_continuation_reads_the_next_page_without_rebrowsing() -> None:
    driver, clients = _driver()
    await driver.connect()
    clients[0].nodes.objects.children = [
        _child(f"P{index}", is_variable=True) for index in range(3)
    ]
    first = await driver.browse_page(None, limit=2)
    second = await driver.browse_page(
        None, limit=2, continuation_token=first.continuation_token
    )
    assert [item.address for item in second.items] == ["ns=2;s=P2"]
    assert second.continuation_token is None


async def test_continuation_cannot_be_used_for_another_folder() -> None:
    driver, clients = _driver()
    await driver.connect()
    clients[0].nodes.objects.children = [
        _child(f"P{index}", is_variable=True) for index in range(3)
    ]
    page = await driver.browse_page(None, limit=2)
    with pytest.raises(BrowseContinuationInvalid, match="重新浏览"):
        await driver.browse_page(
            "ns=2;s=Other", limit=2, continuation_token=page.continuation_token
        )


async def test_compatibility_cache_avoids_rereading_or_typing_all_nodes() -> (
    None
):
    driver, clients = _driver()
    await driver.connect()
    clients[0].is_page_limit_ignored = True
    clients[0].nodes.objects.children = [
        _child(f"P{index}", is_variable=True) for index in range(1000)
    ]
    first = await driver.browse_page(None)
    second = await driver.browse_page(
        None, continuation_token=first.continuation_token
    )
    assert len(second.items) == 200
    assert second.items[0].address == "ns=2;s=P200"
    assert clients[0].browse_requests == 1
    assert sum(len(nodes) for _, nodes in clients[0].asked) == 400
    await driver.disconnect()


async def test_unbounded_device_response_fails_before_reading_types() -> None:
    driver, clients = _driver()
    await driver.connect()
    clients[0].is_page_limit_ignored = True
    clients[0].nodes.objects.children = [
        _child(f"P{index}", is_variable=True)
        for index in range(MAX_BUFFERED_REFERENCES + 1)
    ]
    with pytest.raises(BrowsePageTooLarge):
        await driver.browse_page(None)
    assert clients[0].asked == []


async def test_consumed_continuation_cannot_be_replayed() -> None:
    driver, clients = _driver()
    await driver.connect()
    clients[0].nodes.objects.children = [
        _child(f"P{index}", is_variable=True) for index in range(4)
    ]
    first = await driver.browse_page(None, limit=2)
    await driver.browse_page(
        None, limit=2, continuation_token=first.continuation_token
    )
    with pytest.raises(BrowseContinuationInvalid):
        await driver.browse_page(
            None, limit=2, continuation_token=first.continuation_token
        )


async def test_disconnect_releases_points_and_invalidates_the_old_session() -> (
    None
):
    driver, clients = _driver()
    await driver.connect()
    clients[0].nodes.objects.children = [
        _child(f"P{index}", is_variable=True) for index in range(3)
    ]
    first = await driver.browse_page(None, limit=2)
    await driver.disconnect()
    assert clients[0].continuations == {}
    assert clients[0].released == [b"0"]
    await driver.connect()
    with pytest.raises(BrowseContinuationInvalid):
        await driver.browse_page(
            None, limit=2, continuation_token=first.continuation_token
        )


async def test_expired_continuation_is_released_and_cannot_be_used() -> None:
    now = [0]
    driver, clients = _driver(clock=lambda: now[0])
    await driver.connect()
    clients[0].nodes.objects.children = [
        _child(f"P{index}", is_variable=True) for index in range(3)
    ]
    first = await driver.browse_page(None, limit=2)
    now[0] = BROWSE_CURSOR_TTL_MS
    with pytest.raises(BrowseContinuationInvalid):
        await driver.browse_page(
            None, limit=2, continuation_token=first.continuation_token
        )
    assert clients[0].released == [b"0"]
    await driver.disconnect()


async def test_cancelling_type_reads_releases_the_new_continuation() -> None:
    driver, clients = _driver()
    await driver.connect()
    clients[0].nodes.objects.children = [
        _child(f"P{index}", is_variable=True) for index in range(3)
    ]
    clients[0].type_error = asyncio.CancelledError()
    with pytest.raises(asyncio.CancelledError):
        await driver.browse_page(None, limit=2)
    assert clients[0].continuations == {}
    assert clients[0].released == [b"0"]
    await driver.disconnect()


@pytest.mark.parametrize("limit", [0, 501])
async def test_page_size_is_checked_before_asking_the_device(
    limit: int,
) -> None:
    driver, clients = _driver()
    await driver.connect()
    with pytest.raises(ValueError, match="页大小"):
        await driver.browse_page(None, limit=limit)
    assert clients[0].browse_requests == 0


async def test_cursor_capacity_releases_the_oldest_device_continuation() -> (
    None
):
    driver, clients = _driver()
    await driver.connect()
    clients[0].nodes.objects.children = [
        _child(f"P{i}", is_variable=True) for i in range(3)
    ]
    first = await driver.browse_page(None, limit=1)
    for _ in range(32):
        await driver.browse_page(None, limit=1)
    with pytest.raises(BrowseContinuationInvalid):
        await driver.browse_page(
            None, limit=1, continuation_token=first.continuation_token
        )
    assert clients[0].released == [b"0"]
    await driver.disconnect()
    assert clients[0].continuations == {}


async def test_device_capacity_is_freed_before_browsing_a_new_folder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver, clients = _driver()
    await driver.connect()
    client = clients[0]
    client.nodes.objects.children = [_child("P0", is_variable=True)] * 2
    native_browse = client.browse

    async def browse(parameters: ua.BrowseParameters) -> list[ua.BrowseResult]:
        if len(client.continuations) >= MAX_BROWSE_CURSORS:
            raise ua.uaerrors.BadNoContinuationPoints()
        return await native_browse(parameters)

    monkeypatch.setattr(client, "browse", browse)
    try:
        for _ in range(MAX_BROWSE_CURSORS):
            await driver.browse_page(None, limit=1)
        page = await driver.browse_page(None, limit=1)
        assert page.continuation_token is not None
        assert client.released == [b"0"]
        assert len(client.continuations) == MAX_BROWSE_CURSORS
    finally:
        await driver.disconnect()


async def test_compatibility_cache_budget_is_shared_by_all_open_folders() -> (
    None
):
    driver, clients = _driver()
    await driver.connect()
    clients[0].is_page_limit_ignored = True
    clients[0].nodes.objects.children = [
        _child(f"P{i}", is_variable=True) for i in range(10_000)
    ]
    await driver.browse_page(None)
    await driver.browse_page(None)
    with pytest.raises(BrowsePageTooLarge):
        await driver.browse_page(None)
    assert sum(len(nodes) for _, nodes in clients[0].asked) == 400
    await driver.disconnect()


async def test_device_invalid_continuation_has_a_refreshable_domain_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver, clients = _driver()
    await driver.connect()
    clients[0].nodes.objects.children = [
        _child(f"P{i}", is_variable=True) for i in range(3)
    ]
    first = await driver.browse_page(None, limit=2)
    native_next = clients[0].browse_next

    async def next_page(
        parameters: ua.BrowseNextParameters,
    ) -> list[ua.BrowseResult]:
        if parameters.ReleaseContinuationPoints:
            return await native_next(parameters)
        raise ua.uaerrors.BadContinuationPointInvalid()

    monkeypatch.setattr(clients[0], "browse_next", next_page)
    with pytest.raises(BrowseContinuationInvalid, match="重新浏览"):
        await driver.browse_page(
            None, limit=2, continuation_token=first.continuation_token
        )
    assert clients[0].continuations == {}
    await driver.disconnect()


async def test_compatibility_cursor_expiry_refreshes_after_each_page() -> None:
    now = [0]
    driver, clients = _driver(clock=lambda: now[0])
    await driver.connect()
    clients[0].is_page_limit_ignored = True
    clients[0].nodes.objects.children = [
        _child(f"P{i}", is_variable=True) for i in range(1000)
    ]
    first = await driver.browse_page(None)
    now[0] = BROWSE_CURSOR_TTL_MS - 1
    second = await driver.browse_page(
        None, continuation_token=first.continuation_token
    )
    now[0] = BROWSE_CURSOR_TTL_MS + 1
    third = await driver.browse_page(
        None, continuation_token=second.continuation_token
    )
    assert third.items[0].address == "ns=2;s=P400"
    await driver.disconnect()


async def test_bad_device_page_status_releases_the_old_continuation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    driver, clients = _driver()
    await driver.connect()
    clients[0].nodes.objects.children = [
        _child(f"P{i}", is_variable=True) for i in range(3)
    ]
    first = await driver.browse_page(None, limit=2)
    native_next = clients[0].browse_next

    async def next_page(
        parameters: ua.BrowseNextParameters,
    ) -> list[ua.BrowseResult]:
        if parameters.ReleaseContinuationPoints:
            return await native_next(parameters)
        return [
            ua.BrowseResult(
                StatusCode_=ua.StatusCode(
                    ua.StatusCodes.BadContinuationPointInvalid
                )
            )
        ]

    monkeypatch.setattr(clients[0], "browse_next", next_page)
    with pytest.raises(BrowseContinuationInvalid):
        await driver.browse_page(
            None, limit=2, continuation_token=first.continuation_token
        )
    assert clients[0].continuations == {}
    await driver.disconnect()
