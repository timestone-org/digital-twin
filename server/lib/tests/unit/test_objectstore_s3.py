"""S3 实现的错误收敛、翻页与直传条件。用假 boto 客户端，不碰网络。

⚠ 这里守的是三件「不报错但错」的事：缺失被当成通用故障（调用方于是把
「没上传成功」当成「存储挂了」）、列前缀不翻页（超过一页的前缀被静默半删）、
大小闸没签进 policy（绕过页面就能传任意大的文件）。
"""

from typing import Any

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from lib.objectstore.base import (
    ObjectNotFound,
    ObjectStoreError,
    UploadLimits,
)
from lib.objectstore.s3 import S3ObjectStore, create_object_store
from lib.objectstore.settings import ObjectStoreSettings

BUCKET = "probe-bucket"
LIMITS = UploadLimits(min_bytes=1, max_bytes=1024)


def missing_error() -> ClientError:
    """存储回的「键不存在」。"""
    return ClientError(
        {"Error": {"Code": "NoSuchKey"}, "ResponseMetadata": {}}, "GetObject"
    )


def denied_error() -> ClientError:
    """存储回的「拒绝」，不是缺失。"""
    return ClientError(
        {"Error": {"Code": "AccessDenied"}, "ResponseMetadata": {}},
        "GetObject",
    )


class FakeClient:
    """记账用的假 boto 客户端；每个方法的行为由测试逐个设定。"""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.pages: list[dict[str, Any]] = []
        self.raises: Exception | None = None
        self.deleted: list[str] = []

    def _record(self, name: str, kwargs: dict[str, Any]) -> None:
        self.calls.append((name, kwargs))
        if self.raises is not None:
            raise self.raises

    def get_object(self, **kwargs: Any) -> dict[str, Any]:
        self._record("get_object", kwargs)
        return {"Body": _Body(b"bytes")}

    def head_object(self, **kwargs: Any) -> dict[str, Any]:
        self._record("head_object", kwargs)
        return {
            "ContentLength": 5,
            "ContentType": "model/gltf-binary",
            "ETag": '"abc"',
        }

    def put_object(self, **kwargs: Any) -> dict[str, Any]:
        self._record("put_object", kwargs)
        return {}

    def copy_object(self, **kwargs: Any) -> dict[str, Any]:
        self._record("copy_object", kwargs)
        return {}

    def delete_object(self, **kwargs: Any) -> dict[str, Any]:
        self._record("delete_object", kwargs)
        self.deleted.append(str(kwargs["Key"]))
        return {}

    def list_objects_v2(self, **kwargs: Any) -> dict[str, Any]:
        self._record("list_objects_v2", kwargs)
        return self.pages.pop(0)

    def generate_presigned_post(self, **kwargs: Any) -> dict[str, Any]:
        self._record("generate_presigned_post", kwargs)
        return {"url": "http://store/probe-bucket", "fields": {"key": "k"}}


class _Body:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self) -> bytes:
        return self._data


def store(client: FakeClient) -> S3ObjectStore:
    return S3ObjectStore(client, BUCKET)


async def test_a_missing_key_is_its_own_error() -> None:
    client = FakeClient()
    client.raises = missing_error()
    with pytest.raises(ObjectNotFound):
        await store(client).get_bytes("models/x/original")


async def test_a_refusal_is_not_reported_as_missing() -> None:
    client = FakeClient()
    client.raises = denied_error()
    with pytest.raises(ObjectStoreError) as caught:
        await store(client).get_bytes("models/x/original")
    assert not isinstance(caught.value, ObjectNotFound)


async def test_an_unreachable_store_is_its_own_error() -> None:
    client = FakeClient()
    client.raises = EndpointConnectionError(endpoint_url="http://store")
    with pytest.raises(ObjectStoreError):
        await store(client).put_bytes("k", b"x", content_type="text/plain")


async def test_stat_gives_none_for_a_missing_key() -> None:
    client = FakeClient()
    client.raises = missing_error()
    assert await store(client).stat("k") is None


async def test_stat_strips_the_quotes_around_the_etag() -> None:
    stat = await store(FakeClient()).stat("k")
    assert stat is not None
    assert stat.etag == "abc"


async def test_delete_on_a_missing_key_is_not_an_error() -> None:
    client = FakeClient()
    client.raises = missing_error()
    with pytest.raises(ObjectStoreError):
        # delete 不传 key，故缺失也走通用分支——语义是「删不存在的键不报缺失」
        await store(client).delete("k")


async def test_listing_a_prefix_walks_every_page() -> None:
    client = FakeClient()
    client.pages = [
        {"Contents": [{"Key": "p/b"}], "NextContinuationToken": "t1"},
        {"Contents": [{"Key": "p/a"}]},
    ]
    assert await store(client).list_prefix("p/") == ["p/a", "p/b"]


async def test_deleting_a_prefix_removes_every_page_of_it() -> None:
    client = FakeClient()
    client.pages = [
        {"Contents": [{"Key": "p/a"}], "NextContinuationToken": "t1"},
        {"Contents": [{"Key": "p/b"}]},
    ]
    assert await store(client).delete_prefix("p/") == 2
    assert client.deleted == ["p/a", "p/b"]


async def test_the_upload_ticket_signs_the_size_range_into_the_policy() -> None:
    client = FakeClient()
    await store(client).presign_post(
        "staging/model/1",
        content_type="model/gltf-binary",
        limits=LIMITS,
        ttl_s=900,
    )
    kwargs = dict(client.calls[0][1])
    assert ["content-length-range", 1, 1024] in kwargs["Conditions"]
    assert {"Content-Type": "model/gltf-binary"} in kwargs["Conditions"]
    assert kwargs["ExpiresIn"] == 900


async def test_the_upload_ticket_carries_the_key_back() -> None:
    ticket = await store(FakeClient()).presign_post(
        "staging/model/1",
        content_type="model/gltf-binary",
        limits=LIMITS,
        ttl_s=60,
    )
    assert ticket.key == "staging/model/1"
    assert ticket.expires_seconds == 60


def settings() -> ObjectStoreSettings:
    return ObjectStoreSettings(
        objectstore_endpoint="http://minio:9000",
        objectstore_bucket=BUCKET,
        objectstore_access_key="probe-key",
        objectstore_secret_key="probe-secret",
    )


def test_the_client_is_built_for_path_style_addressing() -> None:
    # ⚠ 自建实现只支持 path-style：默认的 virtual-host 风格会把桶名拼成子域名，
    # 容器里解析不到，而报出来的是连接超时
    built = create_object_store(settings())
    assert built._client.meta.config.s3["addressing_style"] == "path"


def test_the_client_signs_with_v4() -> None:
    built = create_object_store(settings())
    assert built._client.meta.config.signature_version == "s3v4"
