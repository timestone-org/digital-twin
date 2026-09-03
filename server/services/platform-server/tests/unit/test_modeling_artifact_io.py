"""产物与对象存储之间那一段：取回来、搬过去、缓一份。

⚠ 这一组盯的是**失败路径**：字节没了、体积超了、库版本换了——三种都必须给一句
人话原因，因为那句话会原样落到「这个模型版本为什么用不了」上
（docs/MODELING_PLATFORM_DESIGN.md D10）。
"""

import pytest

from lib.testing import FakeObjectStore
from platform_server.apps.modeling.services import artifact_io
from platform_server.apps.modeling.services.artifact_store import (
    CONTENT_TYPE,
    ArtifactRejected,
    meta_of,
    model_key,
    run_key,
    seal,
)

RUN_ID = "0198f0c0-0000-7000-8000-000000000001"
VERSION_ID = "0198f0c0-0000-7000-8000-000000000002"
NODE_ID = "m"


async def _stored() -> tuple[FakeObjectStore, dict[str, object]]:
    """存好一份产物，回存储与它的元信息。"""
    store = FakeObjectStore()
    sealed = seal({"kind": "tree", "leaves": [1.0, 2.0]})
    key = run_key(RUN_ID, NODE_ID)
    await store.put_bytes(key, sealed.payload, content_type=CONTENT_TYPE)
    return store, meta_of(sealed, key)


async def test_a_stored_artifact_comes_back_as_the_same_object() -> None:
    """存进去什么，取回来还是什么。"""
    store, meta = await _stored()
    assert await artifact_io.fetch(store, meta) == {
        "kind": "tree",
        "leaves": [1.0, 2.0],
    }


async def test_a_vanished_artifact_gives_a_reason_not_a_crash() -> None:
    """对象没了时给一句人话，不是一个存储层的异常。"""
    store, meta = await _stored()
    await store.delete(run_key(RUN_ID, NODE_ID))
    with pytest.raises(ArtifactRejected, match="不在存储里"):
        await artifact_io.fetch(store, meta)


async def test_an_oversized_artifact_is_refused_before_unpickling() -> None:
    """超过体积上限的产物在反序列化**之前**就拒掉。

    ⚠ 顺序不能反：反序列化那一次停顿是同步的，字节越多事件循环被占得越久。
    """
    store = FakeObjectStore()
    key = run_key(RUN_ID, NODE_ID)
    payload = b"x" * (artifact_io.MAX_ARTIFACT_BYTES + 1)
    await store.put_bytes(key, payload, content_type=CONTENT_TYPE)
    with pytest.raises(ArtifactRejected, match="上限"):
        await artifact_io.fetch(
            store,
            {
                "object_key": key,
                "digest": "0" * 64,
                "format_version": 1,
                "runtime": {},
            },
        )


async def test_a_version_without_a_key_says_so() -> None:
    """元信息里没记键时说清楚，而不是去读一个空键。"""
    store, _ = await _stored()
    with pytest.raises(ArtifactRejected, match="没有记下产物的位置"):
        await artifact_io.fetch(
            store,
            {
                "object_key": "",
                "digest": "0" * 64,
                "format_version": 1,
                "runtime": {},
            },
        )


async def test_promoting_moves_it_under_the_version_key() -> None:
    """搬完之后，版本自己的键下有一份一模一样的字节。

    ⚠ 必须搬：运行记录到期整片删掉之后，指着运行期那个键的版本会一起变成
    算不出数的版本。
    """
    store, meta = await _stored()
    target = model_key(VERSION_ID)
    promoted = await artifact_io.promote(store, meta, target)
    assert promoted["object_key"] == target
    assert (
        store.objects[target][0] == store.objects[run_key(RUN_ID, NODE_ID)][0]
    )


async def test_promoting_a_vanished_artifact_gives_a_reason() -> None:
    """源没了时给一句人话。"""
    store, meta = await _stored()
    await store.delete(run_key(RUN_ID, NODE_ID))
    with pytest.raises(ArtifactRejected, match="不在存储里"):
        await artifact_io.promote(store, meta, model_key(VERSION_ID))


async def test_the_cache_serves_the_second_read_without_the_store() -> None:
    """第二次要同一份时不再碰存储。

    ⚠ 这不是省一次网络：省的是**反序列化那一次同步停顿**，它才是大头。
    """
    store, meta = await _stored()
    cache = artifact_io.ArtifactCache()
    first = await artifact_io.fetch(store, meta, cache)
    store.objects.clear()
    assert await artifact_io.fetch(store, meta, cache) is first


def test_the_cache_evicts_the_least_recently_used() -> None:
    """满了先淘汰最久没用的那一份，而不是最先放进去的。"""
    cache = artifact_io.ArtifactCache(capacity=2)
    cache.put("a" * 64, "第一份")
    cache.put("b" * 64, "第二份")
    cache.get("a" * 64)
    cache.put("c" * 64, "第三份")
    assert cache.get("b" * 64) is None
    assert cache.get("a" * 64) == "第一份"
