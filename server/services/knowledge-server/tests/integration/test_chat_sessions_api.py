"""对话的会话面，打真库：列、建、看、改、删，以及别人的看不见。"""

import uuid

import httpx
import pytest
from integration.conftest import DbStack, HeaderFactory

from knowledge_server.settings import API_PREFIX

pytestmark = pytest.mark.requires_postgres

URL = f"{API_PREFIX}/chat-sessions"


async def _create(client: httpx.AsyncClient, title: str = "") -> dict[str, str]:
    response = await client.post(URL, json={"title": title})
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def test_create_lists_and_reads_back(
    db_client: httpx.AsyncClient,
) -> None:
    made = await _create(db_client, "锅炉那几台")

    listed = await db_client.get(URL)
    detail = await db_client.get(f"{URL}/{made['id']}")

    assert listed.status_code == 200
    assert made["id"] in [one["id"] for one in listed.json()["data"]["items"]]
    assert detail.status_code == 200
    assert detail.json()["data"]["title"] == "锅炉那几台"
    assert detail.json()["data"]["messages"] == []


async def test_create_is_idempotent_under_the_same_key(
    db_client: httpx.AsyncClient,
) -> None:
    headers = {"Idempotency-Key": str(uuid.uuid4())}

    first = await db_client.post(URL, json={"title": "a"}, headers=headers)
    second = await db_client.post(URL, json={"title": "a"}, headers=headers)

    assert first.json()["data"]["id"] == second.json()["data"]["id"]


async def test_rename_bumps_the_row_version_and_archive_hides_it(
    db_client: httpx.AsyncClient,
) -> None:
    made = await _create(db_client)

    renamed = await db_client.patch(
        f"{URL}/{made['id']}", json={"title": "改名了"}
    )
    archived = await db_client.patch(
        f"{URL}/{made['id']}", json={"is_archived": True}
    )
    live = await db_client.get(URL, params={"is_archived": "false"})

    assert renamed.json()["data"]["row_version"] == 2
    assert archived.json()["data"]["row_version"] == 3
    assert made["id"] not in [one["id"] for one in live.json()["data"]["items"]]


async def test_an_empty_patch_leaves_the_version_alone(
    db_client: httpx.AsyncClient,
) -> None:
    """⚠ 推了的话 `updated_at` 跟着走，空 PATCH 会把它顶到最前。"""
    made = await _create(db_client)

    touched = await db_client.patch(f"{URL}/{made['id']}", json={})

    assert touched.json()["data"]["row_version"] == 1


async def test_null_on_a_non_nullable_field_is_refused(
    db_client: httpx.AsyncClient,
) -> None:
    made = await _create(db_client)

    response = await db_client.patch(
        f"{URL}/{made['id']}", json={"title": None}
    )

    assert response.status_code == 400


async def test_delete_removes_it(db_client: httpx.AsyncClient) -> None:
    made = await _create(db_client)

    gone = await db_client.delete(f"{URL}/{made['id']}")
    after = await db_client.get(f"{URL}/{made['id']}")

    assert gone.status_code == 204
    assert after.status_code == 404


async def test_someone_elses_session_is_404_not_403(
    db_stack: DbStack, sign: HeaderFactory
) -> None:
    """⚠ 403 等于逐个 id 回答「这条对话确实存在」。"""
    made = await _create(db_stack.client)
    stranger = sign()

    read = await db_stack.client.get(f"{URL}/{made['id']}", headers=stranger)
    patched = await db_stack.client.patch(
        f"{URL}/{made['id']}", json={"title": "x"}, headers=stranger
    )

    assert read.status_code == 404
    assert patched.status_code == 404


async def test_the_list_only_shows_my_own(
    db_stack: DbStack, sign: HeaderFactory
) -> None:
    mine = await _create(db_stack.client)
    theirs = await db_stack.client.post(
        URL, json={"title": "别人的"}, headers=sign()
    )

    listed = await db_stack.client.get(URL)
    ids = [one["id"] for one in listed.json()["data"]["items"]]

    assert mine["id"] in ids
    assert theirs.json()["data"]["id"] not in ids


async def test_use_is_enough_and_nothing_less_gets_in(
    db_stack: DbStack, sign: HeaderFactory
) -> None:
    """对话面只要 `knowledge:use`（设计 §6）。"""
    reader = sign(codes=("knowledge:use",))
    nobody = sign(codes=())

    allowed = await db_stack.client.post(URL, json={}, headers=reader)
    denied = await db_stack.client.post(URL, json={}, headers=nobody)

    assert allowed.status_code == 201
    assert denied.status_code == 403
