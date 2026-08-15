"""S3 协议实现。只用标准 S3 API，故 MinIO / Ceph / AWS 都能接。

⚠ boto3 的客户端是同步阻塞的，每个方法都经 `asyncio.to_thread` 挪出事件循环。
客户端本身构造有成本且线程安全，故一个进程共用一个（`create_object_store`）。
"""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING, Any, cast

import boto3
from botocore.client import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError

from lib.objectstore.base import (
    ObjectNotFound,
    ObjectStat,
    ObjectStoreError,
    PresignedPost,
    UploadLimits,
)
from lib.objectstore.settings import ObjectStoreSettings

if TYPE_CHECKING:  # pragma: no cover - 仅类型检查期，运行期不装这个包
    from mypy_boto3_s3.client import S3Client

# 「对象不存在」在不同实现里回的码不一样，三个都要认
_MISSING_CODES = frozenset({"404", "NoSuchKey", "NotFound"})
# 一次 list 的上限，超过要翻页
_PAGE_SIZE = 1000


def _is_missing(error: ClientError) -> bool:
    code = str(error.response.get("Error", {}).get("Code", ""))
    status = str(
        error.response.get("ResponseMetadata", {}).get("HTTPStatusCode", "")
    )
    return code in _MISSING_CODES or status == "404"


class S3ObjectStore:
    """一个桶的字节面。键的形状由调用方决定，本类不认识任何业务概念。"""

    def __init__(
        self, client: S3Client, bucket: str, public_base: str = ""
    ) -> None:
        self._client = client
        self._bucket = bucket
        # 浏览器侧的直传落点；空串表示原样用签出来的地址（测试与本机直连）
        self._public_base = public_base

    async def put_bytes(
        self, key: str, data: bytes, *, content_type: str
    ) -> None:
        """写一个对象，已存在即覆盖。"""
        await self._call(
            self._client.put_object,
            Bucket=self._bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    async def get_bytes(self, key: str) -> bytes:
        """读一个对象；不存在抛 `ObjectNotFound`。"""
        response = await self._call(
            self._client.get_object, Bucket=self._bucket, Key=key, key=key
        )
        body = cast(dict[str, Any], response)["Body"]
        return cast(bytes, await asyncio.to_thread(body.read))

    async def stat(self, key: str) -> ObjectStat | None:
        """取元信息；不存在给 None。"""
        try:
            head = await self._call(
                self._client.head_object, Bucket=self._bucket, Key=key, key=key
            )
        except ObjectNotFound:
            return None
        raw = cast(dict[str, Any], head)
        return ObjectStat(
            key=key,
            size_bytes=int(raw.get("ContentLength", 0)),
            content_type=str(raw.get("ContentType", "")),
            etag=str(raw.get("ETag", "")).strip('"'),
        )

    async def copy(self, source_key: str, target_key: str) -> None:
        """服务端内复制，字节不经过本进程；源不存在抛 `ObjectNotFound`。"""
        await self._call(
            self._client.copy_object,
            Bucket=self._bucket,
            Key=target_key,
            CopySource={"Bucket": self._bucket, "Key": source_key},
            key=source_key,
        )

    async def delete(self, key: str) -> None:
        """删一个对象。删不存在的键不是错误。"""
        await self._call(
            self._client.delete_object, Bucket=self._bucket, Key=key
        )

    async def delete_prefix(self, prefix: str) -> int:
        """删掉整个前缀，返回删掉的对象数。"""
        keys = await self.list_prefix(prefix)
        for key in keys:
            await self.delete(key)
        return len(keys)

    async def list_prefix(self, prefix: str) -> list[str]:
        """列出前缀下的全部键，按字典序。

        ⚠ 必须翻页：只取第一页时，超过一页的前缀会被静默地只删掉前 1000 个，
        而返回值看起来一切正常。
        """
        found: list[str] = []
        token: str | None = None
        while True:
            extra = {"ContinuationToken": token} if token is not None else {}
            page = cast(
                dict[str, Any],
                await self._call(
                    self._client.list_objects_v2,
                    Bucket=self._bucket,
                    Prefix=prefix,
                    MaxKeys=_PAGE_SIZE,
                    **extra,
                ),
            )
            found.extend(str(item["Key"]) for item in page.get("Contents", []))
            token = page.get("NextContinuationToken")
            if token is None:
                return sorted(found)

    async def presign_post(
        self, key: str, *, content_type: str, limits: UploadLimits, ttl_s: int
    ) -> PresignedPost:
        """签发一次直传凭证；条件把键、类型与大小都钉死。

        ⚠ 大小闸签进 policy 由存储端强制：只在前端拦的话，绕过页面直接 POST
        就能上传任意大的文件，而服务端在 finalize 之前根本不知道有这回事。
        """
        conditions: list[Any] = [
            {"Content-Type": content_type},
            ["content-length-range", limits.min_bytes, limits.max_bytes],
        ]
        signed = cast(
            dict[str, Any],
            await self._call(
                self._client.generate_presigned_post,
                Bucket=self._bucket,
                Key=key,
                Fields={"Content-Type": content_type},
                Conditions=conditions,
                ExpiresIn=ttl_s,
            ),
        )
        return PresignedPost(
            # ⚠ 换成浏览器够得着的地址：签名只覆盖 policy 文档，不覆盖 URL，
            # 故换地址不会让凭证失效——只要它仍然指向同一个桶
            url=self._public_base or str(signed["url"]),
            fields={str(k): str(v) for k, v in signed["fields"].items()},
            key=key,
            expires_seconds=ttl_s,
        )

    async def _call(
        self, fn: Any, *, key: str | None = None, **kwargs: Any
    ) -> Any:
        """把一次同步调用挪进线程，并把底层异常收敛成本模块的两种。

        @param key 供「不存在」判定用；不传表示该操作不区分缺失
        """
        try:
            return await asyncio.to_thread(lambda: fn(**kwargs))
        except ClientError as error:
            if key is not None and _is_missing(error):
                raise ObjectNotFound(f"对象不存在：{key}") from error
            raise ObjectStoreError("对象存储拒绝了一次操作") from error
        except BotoCoreError as error:
            raise ObjectStoreError("对象存储不可达") from error


def create_object_store(settings: ObjectStoreSettings) -> S3ObjectStore:
    """按配置造一个客户端。进程内共用一个实例即可，boto3 客户端线程安全。

    @param settings 连接组
    """
    # pyright: ignore 的理由 —— boto3.client 的重载覆盖上百个服务，只有装了
    # stubs 的那一个有真类型，其余一律 Unknown，整个符号于是被判成部分未知。
    # 返回值这一侧已由 S3Client 标注钉住，未知只停在这一行。
    client: S3Client = boto3.client(  # pyright: ignore[reportUnknownMemberType]
        "s3",
        endpoint_url=settings.objectstore_endpoint,
        aws_access_key_id=settings.objectstore_access_key.get_secret_value(),
        aws_secret_access_key=(
            settings.objectstore_secret_key.get_secret_value()
        ),
        region_name=settings.objectstore_region,
        config=BotoConfig(
            signature_version="s3v4",
            s3={
                "addressing_style": (
                    "path"
                    if settings.objectstore_path_style_enabled
                    else "auto"
                )
            },
            connect_timeout=settings.objectstore_connect_timeout_s,
            read_timeout=settings.objectstore_read_timeout_s,
            retries={
                "max_attempts": settings.objectstore_max_attempts,
                "mode": "standard",
            },
        ),
    )
    return S3ObjectStore(
        client,
        settings.objectstore_bucket,
        settings.objectstore_public_base,
    )
