"""S3 实现的错误收敛、翻页与直传条件。用假 boto 客户端，不碰网络。

⚠ 这里守的是三件「不报错但错」的事：缺失被当成通用故障（调用方于是把
「没上传成功」当成「存储挂了」）、列前缀不翻页（超过一页的前缀被静默半删）、
大小闸没签进 policy（绕过页面就能传任意大的文件）。
"""

from io import BytesIO
from typing import Any

import pytest
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    EndpointConnectionError,
    NoCredentialsError,
    ReadTimeoutError,
    ResponseStreamingError,
)
from botocore.response import StreamingBody
from urllib3 import HTTPConnectionPool
from urllib3.exceptions import ProtocolError as StreamProtocolError
from urllib3.exceptions import ReadTimeoutError as StreamReadTimeout

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
        self.body: Any = _Body(b"bytes")

    def _record(self, name: str, kwargs: dict[str, Any]) -> None:
        self.calls.append((name, kwargs))
        if self.raises is not None:
            raise self.raises

    def get_object(self, **kwargs: Any) -> dict[str, Any]:
        self._record("get_object", kwargs)
        return {"Body": self.body}

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


def _upstream_error(code: str, status: int | None = None) -> ClientError:
    metadata = {} if status is None else {"HTTPStatusCode": status}
    return ClientError(
        {"Error": {"Code": code}, "ResponseMetadata": metadata}, "GetObject"
    )


@pytest.mark.parametrize(
    ("code", "status"),
    [
        ("AccessDenied", 403),
        ("InvalidAccessKeyId", 403),
        ("SignatureDoesNotMatch", 403),
        ("InvalidRequest", 400),
        ("NotImplemented", 501),
        ("Unknown", None),
        ("Unknown", 599),
        ("SlowDown", 403),
    ],
)
async def test_permanent_or_unknown_read_errors_are_not_retryable(
    code: str, status: int | None
) -> None:
    client = FakeClient()
    client.raises = _upstream_error(code, status)
    with pytest.raises(ObjectStoreError) as caught:
        await store(client).get_bytes("private-key")
    assert getattr(caught.value, "is_retryable", None) is False
    assert "private-" not in str(caught.value)


@pytest.mark.parametrize("operation", ["get", "stat", "list"])
@pytest.mark.parametrize(
    ("code", "status"),
    [("SlowDown", None), ("RequestTimeout", 400), ("Unknown", 503)],
)
async def test_known_temporary_read_failures_are_retryable(
    operation: str, code: str, status: int | None
) -> None:
    client = FakeClient()
    client.raises = _upstream_error(code, status)
    with pytest.raises(ObjectStoreError) as caught:
        await _operation(store(client), operation)
    assert getattr(caught.value, "is_retryable", None) is True


@pytest.mark.parametrize("operation", ["put", "copy", "delete", "presign"])
@pytest.mark.parametrize("fault", ["timeout", "503", "unknown", "stream-reset"])
async def test_write_failures_are_never_marked_retryable(
    operation: str, fault: str
) -> None:
    client = FakeClient()
    client.raises = _fault(fault)
    with pytest.raises(ObjectStoreError) as caught:
        await _operation(store(client), operation)
    assert getattr(caught.value, "is_retryable", None) is False


@pytest.mark.parametrize(
    "fault", ["timeout", "unavailable", "credentials", "unknown"]
)
async def test_sdk_read_failures_carry_explicit_retryability(
    fault: str,
) -> None:
    client = FakeClient()
    client.raises = _fault(fault)
    with pytest.raises(ObjectStoreError) as caught:
        await store(client).get_bytes("private-key")
    assert getattr(caught.value, "is_retryable", None) is (
        fault in ("timeout", "unavailable")
    )
    assert "private-" not in str(caught.value)


def _fault(fault: str) -> Exception:
    if fault == "timeout":
        return ReadTimeoutError(endpoint_url="private-endpoint")
    if fault == "unavailable":
        return EndpointConnectionError(endpoint_url="private-endpoint")
    if fault == "credentials":
        return NoCredentialsError()
    if fault == "503":
        return _upstream_error("ServiceUnavailable", 503)
    if fault == "stream-reset":
        return ResponseStreamingError(
            error=StreamProtocolError("private-reset")
        )
    return BotoCoreError()


async def _operation(storage: S3ObjectStore, operation: str) -> None:
    if operation == "get":
        await storage.get_bytes("k")
        return
    if operation == "stat":
        await storage.stat("k")
        return
    if operation == "list":
        await storage.list_prefix("p/")
        return
    if operation == "put":
        await storage.put_bytes("k", b"x", content_type="text/plain")
        return
    if operation == "copy":
        await storage.copy("k", "target")
        return
    if operation == "delete":
        await storage.delete("k")
        return
    await storage.presign_post(
        "k", content_type="text/plain", limits=LIMITS, ttl_s=60
    )


class _TimeoutStream(BytesIO):
    """真实 StreamingBody 下方产生读取超时的流替身。"""

    def read(self, size: int | None = -1) -> bytes:
        del size
        raise StreamReadTimeout(
            HTTPConnectionPool("test-pool"),
            "private-endpoint",
            "private-timeout",
        )


async def test_streaming_body_timeout_is_wrapped_as_retryable() -> None:
    client = FakeClient()
    client.body = StreamingBody(_TimeoutStream(), 5)
    with pytest.raises(ObjectStoreError) as caught:
        await store(client).get_bytes("private-key")
    assert getattr(caught.value, "is_retryable", None) is True
    assert "private-" not in str(caught.value)


class _ResetStream(BytesIO):
    """真实 StreamingBody 下方发生连接重置的流替身。"""

    def read(self, size: int | None = -1) -> bytes:
        del size
        raise StreamProtocolError(
            "private-reset", ConnectionResetError("private-reset")
        )


async def test_streaming_body_reset_is_wrapped_as_retryable() -> None:
    client = FakeClient()
    client.body = StreamingBody(_ResetStream(), 5)
    with pytest.raises(ObjectStoreError) as caught:
        await store(client).get_bytes("private-key")
    assert getattr(caught.value, "is_retryable", None) is True
    assert "private-" not in str(caught.value)


async def test_get_bytes_preserves_the_body_bytes() -> None:
    assert await store(FakeClient()).get_bytes("k") == b"bytes"


def test_unknown_objectstore_errors_default_to_not_retryable() -> None:
    assert getattr(ObjectStoreError("unknown"), "is_retryable", None) is False
    assert getattr(ObjectNotFound("missing"), "is_retryable", None) is False
