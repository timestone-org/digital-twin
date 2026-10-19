"""真实 PostgreSQL 的项目隔离、幂等、版本和恢复。"""

import asyncio
from uuid import UUID, uuid4

import pytest
from conftest import headers

BASE = "/api/v1/hierarchy"
pytestmark = [pytest.mark.requires_postgres, pytest.mark.requires_redis]


async def create(client, document):
    result = await client.post(
        f"{BASE}/projects",
        json={"document": document.model_dump(by_alias=True)},
        headers={"Idempotency-Key": str(uuid4())},
    )
    assert result.status_code == 201, result.text
    return result.json()["data"]


async def test_save_reload_restore_and_delete(client, document):
    project = await create(client, document)
    path = f"{BASE}/projects/{project['id']}"
    payload = project["document"]
    payload["nodes"][0]["parameter"] = "0.5级"
    result = await client.put(path, json={"revision": 1, "document": payload})
    assert result.status_code == 200
    assert result.json()["data"]["revision"] == 2
    reread = (await client.get(path)).json()["data"]
    assert reread["document"]["nodes"][0]["parameter"] == "0.5级"
    assert reread["updated_at"].endswith("Z")
    stale = await client.put(path, json={"revision": 1, "document": payload})
    assert stale.status_code == 409
    history = (
        await client.get(path + "/versions", params={"limit": 1})
    ).json()["data"]
    assert history["items"][0]["revision"] == 2
    assert history["has_more"] is True
    tail = (
        await client.get(path + "/versions", params={"after": history["next"]})
    ).json()["data"]
    assert [item["revision"] for item in tail["items"]] == [1]
    restored = await client.post(
        path + ":restore", json={"revision": 2, "target_revision": 1}
    )
    assert (
        restored.json()["data"]["document"]["nodes"][0]["parameter"] == "1.0级"
    )
    assert restored.json()["data"]["revision"] == 3
    assert (await client.delete(path)).status_code == 204
    assert (await client.delete(path)).status_code == 204
    assert (await client.get(path)).status_code == 404


async def test_idempotent_create_and_owner_isolation(client, document):
    key = str(uuid4())
    first = await client.post(
        f"{BASE}/projects",
        json={"document": document.model_dump(by_alias=True)},
        headers={"Idempotency-Key": key},
    )
    second = await client.post(
        f"{BASE}/projects",
        json={"document": document.model_dump(by_alias=True)},
        headers={"Idempotency-Key": key},
    )
    assert first.json()["data"] == second.json()["data"]
    project = first.json()["data"]
    assert first.headers["location"].endswith(project["id"])
    foreign = headers(UUID("20000000-0000-0000-0000-000000000002"))
    assert (
        await client.get(f"{BASE}/projects/{project['id']}", headers=foreign)
    ).status_code == 404
    assert (
        await client.get(
            f"{BASE}/projects/{project['id']}/versions", headers=foreign
        )
    ).status_code == 404
    assert (
        await client.delete(f"{BASE}/projects/{project['id']}", headers=foreign)
    ).status_code == 204
    assert (
        await client.get(f"{BASE}/projects/{project['id']}")
    ).status_code == 200
    await client.delete(f"{BASE}/projects/{project['id']}")


async def test_concurrent_saves_have_one_winner(client, document):
    project = await create(client, document)
    path = f"{BASE}/projects/{project['id']}"
    changes = [
        {"revision": 1, "document": {**project["document"], "title": title}}
        for title in ("甲", "乙")
    ]
    outcomes = await asyncio.gather(
        *(client.put(path, json=change) for change in changes)
    )
    assert sorted(result.status_code for result in outcomes) == [200, 409]
    assert (
        len((await client.get(path + "/versions")).json()["data"]["items"]) == 2
    )
    await client.delete(path)


async def test_history_keeps_latest_fifty_versions(client, document):
    project = await create(client, document)
    path = f"{BASE}/projects/{project['id']}"
    for revision in range(1, 53):
        result = await client.put(
            path,
            json={
                "revision": revision,
                "document": {**project["document"], "title": f"版本{revision}"},
            },
        )
        assert result.status_code == 200
    versions = (await client.get(path + "/versions")).json()["data"]["items"]
    assert len(versions) == 50
    assert versions[0]["revision"] == 53
    assert versions[-1]["revision"] == 4
    missing = await client.post(
        path + ":restore", json={"revision": 53, "target_revision": 1}
    )
    assert missing.status_code == 404
    await client.delete(path)


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/projects", None),
        ("POST", "/projects", {}),
        ("GET", "/capabilities", None),
    ],
)
async def test_unsigned_requests_are_rejected(client, method, path, body):
    client.headers.clear()
    result = await client.request(method, BASE + path, json=body)
    assert result.status_code == 401


async def test_readonly_cannot_write_and_lists_are_bounded(client, document):
    result = await client.post(
        BASE + "/projects",
        json={"document": document.model_dump(by_alias=True)},
        headers=headers(codes=("hierarchy:view",)),
    )
    assert result.status_code == 403
    assert (
        await client.get(BASE + "/projects", params={"size": 201})
    ).status_code == 400
    response = await client.get(
        BASE + "/projects", params={"q": "unlikely-unique-no-match"}
    )
    assert response.json()["data"]["items"] == []
    assert response.json()["trace_id"]


async def test_capability_and_unsupplied_idempotency_key(client, document):
    capability = await client.get(BASE + "/capabilities")
    assert capability.json()["data"] == {
        "is_enabled": True,
        "max_nodes": 300,
        "max_edges": 2000,
        "history_limit": 50,
    }
    result = await client.post(
        BASE + "/projects",
        json={"document": document.model_dump(by_alias=True)},
    )
    assert result.status_code == 201
    project = result.json()["data"]
    listing = await client.get(BASE + "/projects")
    assert any(
        item["id"] == project["id"] for item in listing.json()["data"]["items"]
    )
    missing = await client.post(
        BASE + "/projects/10000000-0000-0000-0000-000000000000:restore",
        json={"revision": 1, "target_revision": 1},
    )
    assert missing.status_code == 404
    await client.delete(f"{BASE}/projects/{project['id']}")
