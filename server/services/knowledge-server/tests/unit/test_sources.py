"""来源层：对象键的形状、上传那一路的取件、注册表的分派。"""

import uuid
from typing import Any

import pytest

from knowledge_server.apps.knowledge.services.sources import (
    UPLOAD_KIND,
    DuplicateSource,
    KnowledgeSource,
    SourceDeps,
    SourceUnavailable,
    UnknownSource,
    UploadSource,
    base_prefix,
    build_sources,
    document_key,
    source_for,
    source_kinds,
    staging_key,
    suffix_of,
)
from lib.objectstore import ObjectNotFound, ObjectStat, ObjectStoreError

BASE = uuid.UUID("00000000-0000-7000-8000-000000000001")
DOC = uuid.UUID("00000000-0000-7000-8000-000000000002")


@pytest.mark.parametrize(
    ("filename", "expected"),
    [
        ("手册.docx", ".docx"),
        ("HANDBOOK.DOCX", ".docx"),
        ("没有后缀", ""),
        ("a.tar.gz", ".gz"),
        # ⚠ 后缀会拼进对象键，而对象键要拼进 URL：放行任意字符等于让
        # 用户给的文件名决定我们往哪个键写字节
        ("evil.../../etc", ""),
        ("a.exe1234567890123", ""),
        ("a.", ""),
    ],
)
def test_only_a_safe_suffix_makes_it_into_the_key(
    filename: str, expected: str
) -> None:
    assert suffix_of(filename) == expected


def test_keys_carry_the_base_and_document() -> None:
    """⚠ 两者都在键里的话，「这份字节属于哪个库的哪份文档」不必查库就说得清，
    而删库时按前缀一把清得干净。"""
    key = document_key(BASE, DOC, ".md")
    assert str(BASE) in key
    assert str(DOC) in key
    assert key.endswith(".md")
    assert key.startswith(base_prefix(BASE))


def test_staging_is_outside_the_final_prefix() -> None:
    """⚠ 没验过的字节不许有一个本站链接：删库按正式前缀清，
    暂存件在那之外，所以两者不能互相覆盖。"""
    assert not staging_key(BASE, DOC, ".md").startswith(base_prefix(BASE))


class _Store:
    """只实现取件那几步的假存储。"""

    def __init__(
        self, content: bytes | None, content_type: str = "text/plain"
    ) -> None:
        self._content = content
        self._content_type = content_type
        self.error: Exception | None = None

    async def stat(self, key: str) -> ObjectStat | None:
        if self.error is not None:
            raise self.error
        if self._content is None:
            raise ObjectNotFound(key)
        return ObjectStat(
            key=key,
            size_bytes=len(self._content),
            content_type=self._content_type,
            etag="e",
        )

    async def get_bytes(self, key: str) -> bytes:
        if self._content is None:
            raise ObjectNotFound(key)
        return self._content


def _upload(store: _Store) -> UploadSource:
    return UploadSource(store=store)  # pyright: ignore[reportArgumentType]


async def test_fetch_names_the_item_after_the_key() -> None:
    """⚠ 键的最后一段带着净化过的后缀，而后缀是解析器分派的唯一判据。
    用文档行上的显示名反而不安全：那是用户给的字符串。"""
    body = "# 标题".encode()
    made = await _upload(_Store(body)).fetch({}, f"knowledge/{BASE}/{DOC}.md")
    assert made.filename == f"{DOC}.md"
    assert made.content == body
    assert made.media_type == "text/plain"


async def test_a_missing_object_is_not_retryable() -> None:
    """⚠ 与「此刻拿不到」分开：混成一档的话，一份原件被人清了之后
    会被无限重试。"""
    with pytest.raises(FileNotFoundError):
        await _upload(_Store(None)).fetch({}, "k")


async def test_a_flaky_store_is_retryable() -> None:
    store = _Store(b"x")
    store.error = ObjectStoreError("抖了一下")
    with pytest.raises(SourceUnavailable):
        await _upload(store).fetch({}, "k")


async def test_upload_discovers_nothing_on_purpose() -> None:
    """⚠ 这一路的条目由用户直传推进来，不是我们拉出来的。给它一个诚实的空
    实现，好过给上传开一条绕过接口的后门。"""
    page = await _upload(_Store(b"x")).discover({}, None)
    assert page.items == ()
    assert page.cursor is None


def test_the_registry_dispatches_by_kind() -> None:
    sources = build_sources(
        SourceDeps(store=_Store(b"x"))  # pyright: ignore[reportArgumentType]
    )
    assert source_for(UPLOAD_KIND, sources).kind == UPLOAD_KIND


def test_an_unknown_kind_raises_by_name() -> None:
    sources = build_sources(
        SourceDeps(store=_Store(b"x"))  # pyright: ignore[reportArgumentType]
    )
    with pytest.raises(UnknownSource, match="没有叫 erp 的来源"):
        source_for("erp", sources)


def test_duplicate_kinds_are_caught_at_assembly() -> None:
    """⚠ 重名时后注册的那一路会被前一路遮掉，而遮掉的是哪一个从外面
    完全看不出来。"""
    twin: tuple[KnowledgeSource, ...] = (
        _upload(_Store(b"x")),
        _upload(_Store(b"y")),
    )
    with pytest.raises(DuplicateSource):
        source_kinds(twin)


def test_upload_declares_an_empty_config_schema() -> None:
    """留一个空 schema 而不是不实现，是为了让「这一路要配什么」在界面上
    有一个统一的问法。"""
    schema: dict[str, Any] = dict(_upload(_Store(b"x")).config_schema())
    assert schema["type"] == "object"
