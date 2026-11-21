"""进程内对象存储替身：字节存在字典里，语义与 S3 实现逐条对齐。

⚠ 替身与真实现的差异要么补上、要么在这里写清楚：测试全绿而线上炸掉，
十有八九是替身比真的宽容。已知刻意的差异只有一条——直传凭证不做真签名。
"""

import asyncio
from hashlib import sha256
from pathlib import Path

from lib.objectstore.base import (
    ObjectChanged,
    ObjectNotFound,
    ObjectStat,
    PresignedPost,
    UploadLimits,
)

_FAKE_HOST = "https://objectstore.test"


class FakeObjectStore:
    """一个桶的字节面替身。"""

    def __init__(self, bucket: str = "test-bucket") -> None:
        self.bucket = bucket
        self.objects: dict[str, tuple[bytes, str]] = {}
        """签发过的直传凭证，按键记账，供测试断言条件是否钉死。"""
        self.presigned: list[PresignedPost] = []

    async def put_bytes(
        self, key: str, data: bytes, *, content_type: str
    ) -> None:
        self.objects[key] = (data, content_type)

    async def put_if_absent(
        self, key: str, data: bytes, *, content_type: str
    ) -> bool:
        """仅在键不存在时写入。Args: key, data, content_type。"""
        if key in self.objects:
            return False
        self.objects[key] = (data, content_type)
        return True

    async def get_bytes(self, key: str) -> bytes:
        return self._current(key, None)[0]

    async def read_prefix(
        self, key: str, *, max_bytes: int, expected_etag: str
    ) -> bytes:
        """读取指定版本的前缀。Args: key, max_bytes, expected_etag。"""
        if max_bytes <= 0:
            raise ValueError("前缀长度必须为正数")
        return self._current(key, expected_etag)[0][:max_bytes]

    async def download_to(self, key: str, path: Path) -> None:
        found = self.objects.get(key)
        if found is None:
            raise ObjectNotFound(f"对象不存在：{key}")
        await asyncio.to_thread(path.write_bytes, found[0])

    async def upload_from(
        self, key: str, path: Path, *, content_type: str
    ) -> None:
        data = await asyncio.to_thread(path.read_bytes)
        self.objects[key] = (data, content_type)

    async def stat(self, key: str) -> ObjectStat | None:
        found = self.objects.get(key)
        if found is None:
            return None
        data, content_type = found
        return ObjectStat(
            key=key,
            size_bytes=len(data),
            content_type=content_type,
            etag=sha256(data).hexdigest(),
        )

    async def copy(
        self,
        source_key: str,
        target_key: str,
        *,
        expected_etag: str | None = None,
    ) -> None:
        """在同一版本上复制。Args: source_key, target_key, expected_etag。"""
        self.objects[target_key] = self._current(source_key, expected_etag)

    def _current(
        self, key: str, expected_etag: str | None
    ) -> tuple[bytes, str]:
        """取当前对象并核对条件。Args: key, expected_etag。"""
        found = self.objects.get(key)
        if found is None:
            raise ObjectNotFound(f"对象不存在：{key}")
        if (
            expected_etag is not None
            and sha256(found[0]).hexdigest() != expected_etag
        ):
            raise ObjectChanged("对象版本已变化")
        return found

    async def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    async def delete_prefix(self, prefix: str) -> int:
        doomed = [key for key in self.objects if key.startswith(prefix)]
        for key in doomed:
            del self.objects[key]
        return len(doomed)

    async def list_prefix(self, prefix: str) -> list[str]:
        return sorted(key for key in self.objects if key.startswith(prefix))

    async def presign_post(
        self, key: str, *, content_type: str, limits: UploadLimits, ttl_s: int
    ) -> PresignedPost:
        # 刻意不做真签名：本替身只保证「条件被原样带出去」，签名正确性由
        # 对着真实现跑的集成用例守
        ticket = PresignedPost(
            url=f"{_FAKE_HOST}/{self.bucket}",
            fields={
                "key": key,
                "Content-Type": content_type,
                "x-fake-min": str(limits.min_bytes),
                "x-fake-max": str(limits.max_bytes),
            },
            key=key,
            expires_seconds=ttl_s,
        )
        self.presigned.append(ticket)
        return ticket
