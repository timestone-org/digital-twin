"""签发直传凭证这一步：过闸、铸 id、把条件钉进 policy。不碰数据库。

⚠ 这一步**不落行**，故它是唯一一处「过不了闸就什么都没发生」的干净拒绝点。
过了闸之后再拒，用户已经把 200MB 传上去了。
"""

import pytest

from lib.objectstore import ObjectStoreError
from lib.testing import FakeObjectStore
from platform_server.apps.assets import keys
from platform_server.apps.assets.errors import (
    AssetKindUnknown,
    AssetStoreUnavailable,
    AssetTooLarge,
    AssetTypeRejected,
)
from platform_server.apps.assets.kinds import spec_of
from platform_server.apps.assets.services import UploadRequest, presign_upload

GLB = "model/gltf-binary"


def request(
    *, kind: str = "model", content_type: str = GLB, size_bytes: int = 1024
) -> UploadRequest:
    """一份能过闸的申请，可按需改坏其中一项。"""
    return UploadRequest(
        kind=kind, content_type=content_type, size_bytes=size_bytes
    )


class BrokenStore(FakeObjectStore):
    """签不出凭证的存储。"""

    async def presign_post(self, *_a: object, **_kw: object) -> object:
        raise ObjectStoreError("签不出来")


async def test_an_unknown_kind_is_refused_before_anything_happens() -> None:
    store = FakeObjectStore()
    with pytest.raises(AssetKindUnknown):
        await presign_upload(store, request(kind="video"))
    assert store.presigned == []


async def test_a_type_outside_the_whitelist_is_refused() -> None:
    store = FakeObjectStore()
    with pytest.raises(AssetTypeRejected):
        await presign_upload(store, request(content_type="text/html"))
    assert store.presigned == []


async def test_an_oversized_declaration_is_refused_before_uploading() -> None:
    spec = spec_of("model")
    assert spec is not None
    store = FakeObjectStore()
    with pytest.raises(AssetTooLarge):
        await presign_upload(store, request(size_bytes=spec.max_bytes + 1))
    assert store.presigned == []


async def test_the_ticket_points_at_the_staging_key_for_that_kind() -> None:
    store = FakeObjectStore()
    ticket = await presign_upload(store, request())
    assert store.presigned[0].key == keys.staging_key("model", ticket.asset_id)


async def test_the_ticket_never_points_at_a_public_prefix() -> None:
    # ⚠ 直传落点若在匿名可读前缀下，未验证的字节当场就有了本站链接
    store = FakeObjectStore()
    await presign_upload(store, request())
    assert keys.is_public(store.presigned[0].key) is False


async def test_the_size_ceiling_signed_in_is_the_kinds_own() -> None:
    spec = spec_of("icon")
    assert spec is not None
    store = FakeObjectStore()
    await presign_upload(
        store, request(kind="icon", content_type="image/png", size_bytes=100)
    )
    assert store.presigned[0].fields["x-fake-max"] == str(spec.max_bytes)


async def test_two_requests_get_two_ids() -> None:
    store = FakeObjectStore()
    first = await presign_upload(store, request())
    second = await presign_upload(store, request())
    assert first.asset_id != second.asset_id


async def test_an_unreachable_store_is_reported_as_unavailable() -> None:
    # 503 而不是 500：调用方据此知道「稍后重试」是有意义的
    with pytest.raises(AssetStoreUnavailable):
        await presign_upload(BrokenStore(), request())
