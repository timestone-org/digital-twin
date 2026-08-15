"""对象存储的对外形状：协议、值对象与错误。

实现见 `s3.py`，替身见 `lib.testing`。

⚠ 接口一律 async：底下的 SDK 是同步阻塞的，只要有一处忘了挪进线程就会卡住整个
事件循环，而现象是「偶尔所有请求一起变慢」，归因极难。把 async 定在协议上之后，
同步实现不可能被直接 await（code-style-python §5.3）。
"""

from dataclasses import dataclass
from typing import Protocol


class ObjectStoreError(RuntimeError):
    """对象存储不可用或拒绝了一次操作。"""


class ObjectNotFound(ObjectStoreError):
    """要读的键不存在。"""


@dataclass(frozen=True)
class ObjectStat:
    """一个对象的元信息。"""

    key: str
    size_bytes: int
    content_type: str
    etag: str


@dataclass(frozen=True)
class PresignedPost:
    """浏览器直传用的一次性表单凭证。

    ⚠ `fields` 必须原样按序写进 multipart 表单，且**文件字段必须排在最后**：
    S3 的 POST 语义是「文件之后的字段一律忽略」，把 key 或签名排到文件后面，
    服务端读到的就是一份缺字段的表单，报出来的是含糊的 403。
    """

    url: str
    fields: dict[str, str]
    key: str
    expires_seconds: int


@dataclass(frozen=True)
class UploadLimits:
    """直传的大小闸。签进 policy，由存储端强制，不靠前端自觉。"""

    min_bytes: int
    max_bytes: int


class ObjectStore(Protocol):
    """字节面的全部操作。键的形状由调用方决定，本层不认识任何业务概念。"""

    async def put_bytes(
        self, key: str, data: bytes, *, content_type: str
    ) -> None:
        """写一个对象，已存在即覆盖。"""
        ...

    async def get_bytes(self, key: str) -> bytes:
        """读一个对象；不存在抛 `ObjectNotFound`。"""
        ...

    async def stat(self, key: str) -> ObjectStat | None:
        """取元信息；不存在给 None。"""
        ...

    async def copy(self, source_key: str, target_key: str) -> None:
        """服务端内复制，字节不经过本进程；源不存在抛 `ObjectNotFound`。"""
        ...

    async def delete(self, key: str) -> None:
        """删一个对象。删不存在的键不是错误。"""
        ...

    async def delete_prefix(self, prefix: str) -> int:
        """删掉整个前缀，返回删掉的对象数。"""
        ...

    async def list_prefix(self, prefix: str) -> list[str]:
        """列出前缀下的全部键，按字典序。"""
        ...

    async def presign_post(
        self, key: str, *, content_type: str, limits: UploadLimits, ttl_s: int
    ) -> PresignedPost:
        """签发一次直传凭证；条件把键、类型与大小都钉死。"""
        ...
