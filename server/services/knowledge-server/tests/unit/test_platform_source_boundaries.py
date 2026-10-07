"""平台来源拒绝无效信封和行标识，并隔离并发调用者身份。"""

import asyncio

import httpx
import pytest

from knowledge_server.apps.knowledge.errors import SourceReadFailed
from knowledge_server.apps.knowledge.services.sources import PlatformSource


@pytest.mark.parametrize(
    "body",
    [b"<html>private-error</html>", b"{broken", b""],
    ids=["html", "malformed-json", "empty"],
)
async def test_invalid_success_body_has_a_named_failure(body: bytes) -> None:
    async with httpx.AsyncClient(
        base_url="http://platform-test",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, content=body)
        ),
    ) as client:
        with pytest.raises(SourceReadFailed):
            await PlatformSource(client, {}).discover({"path": "/x"}, None)


@pytest.mark.parametrize(
    "body",
    [
        [],
        {},
        {"data": None},
        {"code": 0, "data": {"items": "invalid"}},
        {"code": 0, "data": {"items": [None, "corrupted-row"]}},
        {"data": {"items": [{"row_id": "valid"}, None]}},
    ],
    ids=[
        "bare-list",
        "missing-data",
        "null-data",
        "invalid-items",
        "invalid-rows",
        "mixed-rows",
    ],
)
async def test_invalid_envelope_cannot_be_empty_success(body: object) -> None:
    async with httpx.AsyncClient(
        base_url="http://platform-test",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(200, json=body)
        ),
    ) as client:
        with pytest.raises(SourceReadFailed):
            await PlatformSource(client, {}).discover({"path": "/x"}, None)


@pytest.mark.parametrize(
    ("row", "id_field"),
    [
        ({"name": "missing"}, "row_id"),
        ({"row_id": None}, "row_id"),
        ({"row_id": ""}, "row_id"),
        ({"row_id": "   "}, "row_id"),
        ({"row_id": "valid"}, "configured_typo"),
        ({"row_id": []}, "row_id"),
        ({"row_id": {}}, "row_id"),
        ({"row_id": True}, "row_id"),
    ],
    ids=[
        "missing",
        "null",
        "empty",
        "blank",
        "wrong-field",
        "array",
        "object",
        "boolean",
    ],
)
async def test_invalid_row_identity_has_a_named_failure(
    row: dict[str, object], id_field: str
) -> None:
    async with httpx.AsyncClient(
        base_url="http://platform-test",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200, json={"code": 0, "data": {"items": [row]}}
            )
        ),
    ) as client:
        with pytest.raises(SourceReadFailed, match="行标识") as caught:
            await PlatformSource(client, {}).discover(
                {"path": "/x", "id_field": id_field}, None
            )
    assert caught.value.is_retryable is False
    assert "configured_typo" not in caught.value.message


@pytest.mark.parametrize("identity", [0, 12, "零号记录"])
async def test_valid_scalar_identity_is_preserved(identity: str | int) -> None:
    async with httpx.AsyncClient(
        base_url="http://platform-test",
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200, json={"code": 0, "data": {"items": [{"row_id": identity}]}}
            )
        ),
    ) as client:
        page = await PlatformSource(client, {}).discover({"path": "/x"}, None)
    assert page.items[0].external_ref == str(identity)
    assert page.items[0].title == f"{identity}.md"


async def test_overlapping_users_keep_their_own_identity() -> None:
    first_entered, second_entered = asyncio.Event(), asyncio.Event()
    seen: dict[str, dict[str, str]] = {}

    async def respond(request: httpx.Request) -> httpx.Response:
        signature = request.headers["x-auth-sig"]
        if signature == "caller-a":
            first_entered.set()
            await second_entered.wait()
        else:
            await first_entered.wait()
            second_entered.set()
        seen[signature] = dict(request.headers)
        return httpx.Response(
            200, json={"code": 0, "data": {"items": [{"row_id": signature}]}}
        )

    async with httpx.AsyncClient(
        base_url="http://platform-test", transport=httpx.MockTransport(respond)
    ) as client:
        first, second = await asyncio.gather(
            PlatformSource(client, {"X-Auth-Sig": "caller-a"}).discover(
                {"path": "/x"}, None
            ),
            PlatformSource(client, {"X-Auth-Sig": "caller-b"}).discover(
                {"path": "/x"}, None
            ),
        )
    assert [first.items[0].external_ref, second.items[0].external_ref] == [
        "caller-a",
        "caller-b",
    ]
    assert [seen["caller-a"]["x-auth-sig"], seen["caller-b"]["x-auth-sig"]] == [
        "caller-a",
        "caller-b",
    ]


async def test_full_page_cursor_never_repeats_a_page() -> None:
    requested: list[int] = []

    def respond(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        requested.append(page)
        count = 50 if page < 3 else 1
        return httpx.Response(
            200,
            json={
                "code": 0,
                "data": {
                    "items": [
                        {"row_id": f"{page}:{index}"} for index in range(count)
                    ]
                },
            },
        )

    async with httpx.AsyncClient(
        base_url="http://platform-test", transport=httpx.MockTransport(respond)
    ) as client:
        source, cursor = PlatformSource(client, {}), None
        identities: list[str] = []
        for _ in range(3):
            page = await source.discover({"path": "/x"}, cursor)
            identities.extend(item.external_ref for item in page.items)
            cursor = page.cursor
    assert requested == [1, 2, 3]
    assert len(identities) == len(set(identities)) == 101
    assert cursor is None
