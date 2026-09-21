"""重新上传保留素材身份，失败与旧压缩任务不能改变当前内容。"""

import asyncio
import uuid
from unittest.mock import AsyncMock

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from integration.test_assets_api import ASSETS_URL, GLB, data_of, make_asset
from lib.objectstore import ObjectStoreError
from lib.testing import FakeObjectStore
from platform_server.apps.assets import keys
from platform_server.apps.assets.crud import asset_variant
from platform_server.apps.assets.crud.asset import lock_revision, model_content
from platform_server.apps.assets.crud.asset_variant import VariantResult

pytestmark = pytest.mark.requires_postgres
NEW_BYTES = b"new model bytes"


async def prepare(
    client: httpx.AsyncClient, store: FakeObjectStore, asset_id: str
) -> str:
    response = await client.post(
        f"{ASSETS_URL}/{asset_id}:presign-replacement",
        json={
            "kind": "model",
            "content_type": GLB,
            "size_bytes": len(NEW_BYTES),
        },
    )
    assert response.status_code == 201
    ticket = data_of(response)
    await store.put_bytes(ticket["fields"]["key"], NEW_BYTES, content_type=GLB)
    return str(ticket["asset_id"])


async def test_replacement_preserves_name_identity_and_existing_reference(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
) -> None:
    old = await make_asset(app_client, object_store, name="原文件.glb")
    upload_id = await prepare(app_client, object_store, old["id"])
    body = {"upload_id": upload_id, "expected_checksum": old["checksum"]}
    response = await app_client.post(
        f"{ASSETS_URL}/{old['id']}:replace", json=body
    )
    assert response.status_code == 200
    saved = data_of(response)
    for key in ("id", "name", "ref", "created_at", "created_by"):
        assert saved[key] == old[key]
    assert saved["checksum"] != old["checksum"]
    assert saved["size_bytes"] == len(NEW_BYTES)
    assert {v["status"] for v in saved["variants"]} == {"pending"}
    again = await app_client.post(
        f"{ASSETS_URL}/{old['id']}:replace", json=body
    )
    assert data_of(again) == saved
    assert len(data_of(await app_client.get(ASSETS_URL))) == 1
    location = await app_client.get(
        f"/api/v1/platform/public-assets/{old['id']}/high"
    )
    assert location.status_code == 307
    assert location.headers["cache-control"] == "no-store"
    key = location.headers["location"].removeprefix("/oss/")
    assert key.startswith(f"models/{old['id']}/revisions/")
    assert key.endswith("/original")
    assert await object_store.get_bytes(key) == NEW_BYTES


async def test_upload_failure_leaves_the_original_model_usable(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old = await make_asset(app_client, object_store)
    upload_id = await prepare(app_client, object_store, old["id"])
    monkeypatch.setattr(
        object_store,
        "copy",
        AsyncMock(side_effect=ObjectStoreError("unavailable")),
    )
    result = await app_client.post(
        f"{ASSETS_URL}/{old['id']}:replace",
        json={
            "upload_id": upload_id,
            "expected_checksum": old["checksum"],
        },
    )
    assert result.status_code == 503
    assert data_of(await app_client.get(f"{ASSETS_URL}/{old['id']}")) == old
    assert (
        await object_store.get_bytes(keys.model_key(uuid.UUID(old["id"])))
        == b"glTF-ish bytes"
    )


async def test_replacement_cannot_take_another_models_upload(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
) -> None:
    old = await make_asset(app_client, object_store)
    other = await make_asset(app_client, object_store)
    upload_id = await prepare(app_client, object_store, other["id"])
    result = await app_client.post(
        f"{ASSETS_URL}/{old['id']}:replace",
        json={
            "upload_id": upload_id,
            "expected_checksum": old["checksum"],
        },
    )
    assert result.status_code == 409
    assert data_of(await app_client.get(f"{ASSETS_URL}/{old['id']}")) == old


async def test_stale_confirmation_does_not_overwrite_new_content(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
) -> None:
    old = await make_asset(app_client, object_store)
    first = await prepare(app_client, object_store, old["id"])
    second = await prepare(app_client, object_store, old["id"])
    first_result = await app_client.post(
        f"{ASSETS_URL}/{old['id']}:replace",
        json={
            "upload_id": first,
            "expected_checksum": old["checksum"],
        },
    )
    assert first_result.status_code == 200
    result = await app_client.post(
        f"{ASSETS_URL}/{old['id']}:replace",
        json={
            "upload_id": second,
            "expected_checksum": old["checksum"],
        },
    )
    assert result.status_code == 409
    assert data_of(
        await app_client.get(f"{ASSETS_URL}/{old['id']}")
    ) == data_of(first_result)


@pytest.mark.parametrize(
    "content_type", ["text/html", "application/javascript"]
)
async def test_replacement_rejects_unaccepted_content_types(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
    content_type: str,
) -> None:
    old = await make_asset(app_client, object_store)
    response = await app_client.post(
        f"{ASSETS_URL}/{old['id']}:presign-replacement",
        json={
            "kind": "model",
            "content_type": content_type,
            "size_bytes": 10,
        },
    )
    assert response.status_code == 400


async def test_replacement_is_guarded_and_cannot_change_the_name(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
) -> None:
    old = await make_asset(app_client, object_store)
    upload_id = await prepare(app_client, object_store, old["id"])
    response = await app_client.post(
        f"{ASSETS_URL}/{old['id']}:replace",
        json={
            "upload_id": upload_id,
            "expected_checksum": old["checksum"],
            "name": "不允许.glb",
        },
    )
    assert response.status_code == 400
    app_client.headers.clear()
    response = await app_client.post(
        f"{ASSETS_URL}/{old['id']}:replace",
        json={
            "upload_id": upload_id,
            "expected_checksum": old["checksum"],
        },
    )
    assert response.status_code in (401, 403)


async def test_public_model_resolution_rejects_unknown_variants_and_assets(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
) -> None:
    old = await make_asset(app_client, object_store)
    app_client.headers.clear()
    response = await app_client.get(
        f"/api/v1/platform/public-assets/{old['id']}/original"
    )
    assert response.status_code == 307
    assert response.headers["location"] == f"/oss/models/{old['id']}/original"
    response = await app_client.get(
        f"/api/v1/platform/public-assets/{old['id']}/secret"
    )
    assert response.status_code == 404


async def test_concurrent_confirmation_cannot_overwrite_a_published_version(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old = await make_asset(app_client, object_store)
    upload_id = await prepare(app_client, object_store, old["id"])
    ready, resume = asyncio.Event(), asyncio.Event()
    copy = object_store.copy

    async def delayed_copy(source: str, target: str) -> None:
        if ready.is_set():
            await copy(source, target)
            return
        captured = await object_store.get_bytes(source)
        ready.set()
        await resume.wait()
        await object_store.put_bytes(target, captured, content_type=GLB)

    monkeypatch.setattr(object_store, "copy", delayed_copy)
    body = {"upload_id": upload_id, "expected_checksum": old["checksum"]}
    first = asyncio.create_task(
        app_client.post(f"{ASSETS_URL}/{old['id']}:replace", json=body)
    )
    try:
        await asyncio.wait_for(ready.wait(), 10)
        await object_store.put_bytes(
            keys.replacement_key(uuid.UUID(old["id"]), uuid.UUID(upload_id)),
            b"latest uploaded bytes",
            content_type=GLB,
        )
        second = await app_client.post(
            f"{ASSETS_URL}/{old['id']}:replace", json=body
        )
        assert second.status_code == 200
    finally:
        resume.set()
        await first
    resolved = await app_client.get(
        f"/api/v1/platform/public-assets/{old['id']}/original"
    )
    key = resolved.headers["location"].removeprefix("/oss/")
    assert await object_store.get_bytes(key) == b"latest uploaded bytes"
    assert data_of(
        await app_client.get(f"{ASSETS_URL}/{old['id']}")
    ) == data_of(second)


async def test_copied_content_must_match_validation_before_publishing(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old = await make_asset(app_client, object_store)
    upload_id = await prepare(app_client, object_store, old["id"])

    async def changed_copy(_source: str, target: str) -> None:
        await object_store.put_bytes(
            target, b"changed after validation", content_type=GLB
        )

    monkeypatch.setattr(object_store, "copy", changed_copy)
    response = await app_client.post(
        f"{ASSETS_URL}/{old['id']}:replace",
        json={
            "upload_id": upload_id,
            "expected_checksum": old["checksum"],
        },
    )
    assert response.status_code == 409
    assert data_of(await app_client.get(f"{ASSETS_URL}/{old['id']}")) == old


async def test_a_missing_target_is_not_created_by_replacement(
    app_client: httpx.AsyncClient,
) -> None:
    response = await app_client.post(
        f"{ASSETS_URL}/{uuid.uuid4()}:presign-replacement",
        json={
            "kind": "model",
            "content_type": GLB,
            "size_bytes": 10,
        },
    )
    assert response.status_code == 404


async def test_presign_failure_does_not_change_the_existing_model(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old = await make_asset(app_client, object_store)
    monkeypatch.setattr(
        object_store,
        "presign_post",
        AsyncMock(side_effect=ObjectStoreError("unavailable")),
    )
    response = await app_client.post(
        f"{ASSETS_URL}/{old['id']}:presign-replacement",
        json={
            "kind": "model",
            "content_type": GLB,
            "size_bytes": 10,
        },
    )
    assert response.status_code == 503
    assert data_of(await app_client.get(f"{ASSETS_URL}/{old['id']}")) == old


async def test_replacement_refuses_non_model_targets(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
) -> None:
    ticket = data_of(
        await app_client.post(
            f"{ASSETS_URL}:presign-upload",
            json={
                "kind": "image",
                "content_type": "image/png",
                "size_bytes": 3,
            },
        )
    )
    await object_store.put_bytes(
        ticket["fields"]["key"], b"png", content_type="image/png"
    )
    await app_client.post(
        f"{ASSETS_URL}/{ticket['asset_id']}:finalize", json={"name": "图片.png"}
    )
    response = await app_client.post(
        f"{ASSETS_URL}/{ticket['asset_id']}:presign-replacement",
        json={
            "kind": "model",
            "content_type": GLB,
            "size_bytes": 10,
        },
    )
    assert response.status_code == 400


@pytest.mark.parametrize("kind", ["image", "icon"])
async def test_model_replacement_cannot_request_another_kind(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
    kind: str,
) -> None:
    old = await make_asset(app_client, object_store)
    response = await app_client.post(
        f"{ASSETS_URL}/{old['id']}:presign-replacement",
        json={
            "kind": kind,
            "content_type": GLB,
            "size_bytes": 10,
        },
    )
    assert response.status_code == 400


async def test_empty_replacement_is_not_published(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
) -> None:
    old = await make_asset(app_client, object_store)
    upload_id = await prepare(app_client, object_store, old["id"])
    await object_store.put_bytes(
        keys.replacement_key(uuid.UUID(old["id"]), uuid.UUID(upload_id)),
        b"",
        content_type=GLB,
    )
    response = await app_client.post(
        f"{ASSETS_URL}/{old['id']}:replace",
        json={
            "upload_id": upload_id,
            "expected_checksum": old["checksum"],
        },
    )
    assert response.status_code == 409


async def test_ready_variant_resolves_with_the_current_content_revision(
    app_client: httpx.AsyncClient,
    object_store: FakeObjectStore,
    db_session: AsyncSession,
) -> None:
    old = await make_asset(app_client, object_store)
    upload_id = await prepare(app_client, object_store, old["id"])
    await app_client.post(
        f"{ASSETS_URL}/{old['id']}:replace",
        json={
            "upload_id": upload_id,
            "expected_checksum": old["checksum"],
        },
    )
    asset_id = uuid.UUID(old["id"])
    await asset_variant.mark_ready(
        db_session,
        asset_id,
        "high",
        VariantResult(size_bytes=5, checksum="derived"),
    )
    current = await model_content(db_session, asset_id, "high")
    assert current is not None
    assert current[0] is not None
    assert current[1]
    assert await lock_revision(db_session, asset_id, current[0])
    assert not await lock_revision(db_session, asset_id, None)
    resolved = await app_client.get(
        f"/api/v1/platform/public-assets/{asset_id}/high"
    )
    assert (
        resolved.headers["location"]
        == f"/oss/{keys.revision_key(asset_id, current[0], 'high')}"
    )
    missing = await app_client.get(
        f"/api/v1/platform/public-assets/{uuid.uuid4()}/original"
    )
    assert missing.status_code == 404
