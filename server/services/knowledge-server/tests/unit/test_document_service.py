"""文档服务里不碰库的那几步：格式与大小的闸、直传凭证、哈希与挪件。"""

import uuid

import pytest

from knowledge_server.apps.knowledge.errors import UnsupportedRawItem
from knowledge_server.apps.knowledge.schemas import UploadTicketIn
from knowledge_server.apps.knowledge.services import document_service
from knowledge_server.settings import MAX_RAW_BYTES
from lib.objectstore import PresignedPost, UploadLimits

BASE = uuid.UUID("00000000-0000-7000-8000-000000000001")


class _Store:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.copied: list[tuple[str, str]] = []
        self.deleted: list[str] = []
        self.limits: UploadLimits | None = None
        self.ttl: int = 0

    async def presign_post(
        self,
        key: str,
        *,
        content_type: str,
        limits: UploadLimits,
        ttl_s: int,
    ) -> PresignedPost:
        del content_type
        self.limits = limits
        self.ttl = ttl_s
        return PresignedPost(
            url="http://store",
            fields={"key": key},
            key=key,
            expires_seconds=ttl_s,
        )

    async def get_bytes(self, key: str) -> bytes:
        return self.objects[key]

    async def copy(self, source_key: str, target_key: str) -> None:
        self.copied.append((source_key, target_key))
        self.objects[target_key] = self.objects[source_key]

    async def delete(self, key: str) -> None:
        self.deleted.append(key)
        self.objects.pop(key, None)


def _ticket(filename: str, size: int = 10) -> UploadTicketIn:
    return UploadTicketIn(filename=filename, size_bytes=size)


async def test_a_ticket_encodes_the_document_id_into_the_key() -> None:
    """⚠ id 在签凭证那一步就铸好并编进对象键：登记那一步只认这个键，
    客户端没法把字节传到一个 id 下、再拿另一个 id 来登记。"""
    store = _Store()
    made = await document_service.presign_upload(
        store,  # pyright: ignore[reportArgumentType]
        BASE,
        _ticket("手册.md"),
        (),
    )
    assert str(made.document_id) in made.object_key
    assert str(BASE) in made.object_key
    assert made.object_key.endswith(".md")


async def test_the_size_limit_is_signed_into_the_policy() -> None:
    """⚠ 大小闸签进 policy 由存储端强制，不靠前端自觉：只在前端拦的话，
    一次直连存储的请求就能绕过去。"""
    store = _Store()
    await document_service.presign_upload(
        store,  # pyright: ignore[reportArgumentType]
        BASE,
        _ticket("手册.md"),
        (),
    )
    assert store.limits is not None
    assert store.limits.max_bytes == MAX_RAW_BYTES
    assert store.limits.min_bytes >= 1


async def test_a_zero_byte_file_is_refused_by_the_policy() -> None:
    """⚠ 最小字节数不是 0：一份 0 字节的文件传得上去、解出来是空的、状态却是
    ready，而那与「这份文档里确实没这句话」长得一模一样。"""
    store = _Store()
    await document_service.presign_upload(
        store,  # pyright: ignore[reportArgumentType]
        BASE,
        _ticket("手册.md"),
        (),
    )
    assert store.limits is not None
    assert store.limits.min_bytes > 0


@pytest.mark.parametrize("filename", ["图纸.pdf", "没有后缀", "a.exe"])
async def test_an_unsupported_format_is_refused_before_signing(
    filename: str,
) -> None:
    with pytest.raises(UnsupportedRawItem):
        await document_service.presign_upload(
            _Store(),  # pyright: ignore[reportArgumentType]
            BASE,
            _ticket(filename),
            (),
        )


async def test_a_file_over_the_limit_is_refused_before_signing() -> None:
    """⚠ 在签凭证那一步就拒：签出去之后再拒，用户已经把字节传上来了。"""
    with pytest.raises(UnsupportedRawItem, match="超过上限"):
        await document_service.presign_upload(
            _Store(),  # pyright: ignore[reportArgumentType]
            BASE,
            _ticket("手册.md", MAX_RAW_BYTES + 1),
            (),
        )


async def test_the_hash_is_computed_on_our_side() -> None:
    """⚠ 客户端报什么我们就存什么的话，去重就成了一句空话——两份不同内容
    报同一个哈希，第二份会被当成重复丢掉。"""
    store = _Store()
    store.objects["staging"] = b"hello"
    digest, size = await document_service._hash_and_move(
        store,  # pyright: ignore[reportArgumentType]
        "staging",
        "final",
    )
    assert size == 5
    assert len(digest) == 64
    assert store.copied == [("staging", "final")]
    assert store.deleted == ["staging"]


async def test_the_same_bytes_always_hash_the_same() -> None:
    store = _Store()
    store.objects["a"] = b"same"
    store.objects["b"] = b"same"
    first, _ = await document_service._hash_and_move(
        store,  # pyright: ignore[reportArgumentType]
        "a",
        "a2",
    )
    second, _ = await document_service._hash_and_move(
        store,  # pyright: ignore[reportArgumentType]
        "b",
        "b2",
    )
    assert first == second
