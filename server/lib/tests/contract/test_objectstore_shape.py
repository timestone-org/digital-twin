"""契约：替身与真实现是同一个形状，且语义逐条对齐。

⚠ 替身比真的宽容时，整套用例会在真环境炸掉之前一路全绿。形状由 pyright
在这里钉住（两者都必须能赋给 `ObjectStore`），语义由下面这批逐条比对。
"""

from pathlib import Path

import pytest

from lib.objectstore import (
    ObjectNotFound,
    ObjectStore,
    S3ObjectStore,
    UploadLimits,
)
from lib.testing import FakeObjectStore

LIMITS = UploadLimits(min_bytes=1, max_bytes=64)


def test_both_implementations_satisfy_the_protocol() -> None:
    # 赋值即断言：少一个方法或签名对不上，pyright 在这一行报错
    fake: ObjectStore = FakeObjectStore()
    real: ObjectStore = S3ObjectStore(object(), "bucket")
    assert fake is not real


async def test_reading_a_missing_key_raises_the_same_error() -> None:
    with pytest.raises(ObjectNotFound):
        await FakeObjectStore().get_bytes("nope")


async def test_stat_on_a_missing_key_gives_none() -> None:
    assert await FakeObjectStore().stat("nope") is None


async def test_deleting_a_missing_key_is_not_an_error() -> None:
    store = FakeObjectStore()
    await store.delete("nope")
    assert await store.list_prefix("") == []


async def test_copying_a_missing_source_raises() -> None:
    with pytest.raises(ObjectNotFound):
        await FakeObjectStore().copy("nope", "target")


async def test_a_prefix_delete_reports_how_many_went() -> None:
    store = FakeObjectStore()
    await store.put_bytes("p/a", b"1", content_type="text/plain")
    await store.put_bytes("p/b", b"2", content_type="text/plain")
    await store.put_bytes("q/c", b"3", content_type="text/plain")

    assert await store.delete_prefix("p/") == 2
    assert await store.list_prefix("") == ["q/c"]


async def test_listing_is_sorted_so_assertions_are_stable() -> None:
    store = FakeObjectStore()
    await store.put_bytes("p/b", b"1", content_type="text/plain")
    await store.put_bytes("p/a", b"2", content_type="text/plain")

    assert await store.list_prefix("p/") == ["p/a", "p/b"]


async def test_writing_the_same_key_twice_overwrites() -> None:
    store = FakeObjectStore()
    await store.put_bytes("k", b"first", content_type="text/plain")
    await store.put_bytes("k", b"second", content_type="text/plain")

    assert await store.get_bytes("k") == b"second"


async def test_the_ticket_carries_the_key_and_ttl() -> None:
    store = FakeObjectStore()
    ticket = await store.presign_post(
        "staging/model/1",
        content_type="model/gltf-binary",
        limits=LIMITS,
        ttl_s=300,
    )

    assert (ticket.key, ticket.expires_seconds) == ("staging/model/1", 300)
    assert store.presigned == [ticket]


async def test_a_file_round_trips_through_the_store(tmp_path: Path) -> None:
    store = FakeObjectStore()
    source = tmp_path / "in.glb"
    source.write_bytes(b"payload")
    await store.upload_from("k", source, content_type="model/gltf-binary")

    target = tmp_path / "out.glb"
    await store.download_to("k", target)

    assert target.read_bytes() == b"payload"
    stat = await store.stat("k")
    assert stat is not None
    assert stat.content_type == "model/gltf-binary"


async def test_downloading_a_missing_key_raises(tmp_path: Path) -> None:
    with pytest.raises(ObjectNotFound):
        await FakeObjectStore().download_to("nope", tmp_path / "out")
