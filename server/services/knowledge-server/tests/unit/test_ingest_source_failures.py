"""来源失败经过真实摄取管线后，永久失败确认、临时失败留待认领。"""

import uuid
from collections.abc import AsyncGenerator, Callable, Mapping
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import dataclass
from io import BytesIO
from typing import TYPE_CHECKING, Any, cast

import httpx
import pytest
from botocore.exceptions import BotoCoreError, ClientError, ReadTimeoutError
from botocore.response import StreamingBody
from sqlalchemy import Update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.base import Executable
from urllib3 import HTTPConnectionPool
from urllib3.exceptions import ProtocolError as StreamProtocolError
from urllib3.exceptions import ReadTimeoutError as StreamReadTimeout

from knowledge_server.apps.knowledge.models import (
    KnowledgeDocument,
)
from knowledge_server.apps.knowledge.models import (
    KnowledgeSource as SourceRow,
)
from knowledge_server.apps.knowledge.services import ingest_queue
from knowledge_server.apps.knowledge.services.embedding import NullEmbedder
from knowledge_server.apps.knowledge.services.indexing import build_indexes
from knowledge_server.apps.knowledge.services.ingest_pipeline import IngestDeps
from knowledge_server.apps.knowledge.services.ingest_worker import (
    ConsumerOptions,
    IngestConsumer,
)
from knowledge_server.apps.knowledge.services.parsing import RawItem
from knowledge_server.apps.knowledge.services.sources import (
    PLATFORM_KIND,
    UPLOAD_KIND,
    DiscoveredPage,
    KnowledgeSource,
    PlatformSource,
    UploadSource,
)
from lib.db import Database
from lib.errors import AppError
from lib.objectstore import (
    ObjectStat,
    ObjectStore,
    ObjectStoreUnavailable,
    S3ObjectStore,
)
from lib.stream import StreamEntry, StreamGroup, StreamLike

if TYPE_CHECKING:
    from mypy_boto3_s3.client import S3Client

TARGET = StreamGroup(stream="test-ingest", group="test", consumer="one")


class _Result:
    """数据库边界返回的单行及受影响行数。"""

    rowcount = 1

    def __init__(self, row: KnowledgeDocument | SourceRow | None) -> None:
        self.row = row

    def scalar_one_or_none(self) -> KnowledgeDocument | SourceRow | None:
        return self.row


class _Session:
    """仅模拟取来源、认领与写失败三个数据库操作。"""

    def __init__(self, database: "_Database") -> None:
        self.database = database

    async def execute(self, statement: Executable) -> _Result:
        if isinstance(statement, Update):
            values = statement.compile().params
            self.database.document.status = str(values["status"])
            self.database.document.failure_reason = str(
                values["failure_reason"]
            )
            return _Result(self.database.document)
        return _Result(self.database.source)


class _Database:
    """记录真实 CRUD 发出的终态，连接边界由内存行替代。"""

    def __init__(self, kind: str = "fixture") -> None:
        self.source = SourceRow(
            id=uuid.uuid4(), kind=kind, config_json={}, name="来源"
        )
        self.document = KnowledgeDocument(
            id=uuid.uuid4(),
            base_id=uuid.uuid4(),
            source_id=self.source.id,
            external_ref="private-item-ref",
            object_key="private-object-key",
            status="pending",
            failure_reason="",
        )

    @asynccontextmanager
    async def session(self) -> AsyncGenerator[AsyncSession]:
        # 只替代数据库连接面，CRUD 与摄取控制流使用真实实现。
        yield cast("AsyncSession", _Session(self))


@dataclass(frozen=True)
class _Source:
    """来源端口透传适配器实际产生的异常。"""

    error: AppError
    kind: str = "fixture"

    def config_schema(self) -> Mapping[str, Any]:
        return {}

    async def discover(
        self, config: Mapping[str, Any], cursor: str | None
    ) -> DiscoveredPage:
        del config, cursor
        raise self.error

    async def fetch(self, config: Mapping[str, Any], ref: str) -> RawItem:
        del config, ref
        raise self.error


class _Stream:
    """只记录已确认的消息，所有权始终归当前消费者。"""

    def __init__(self, entry: StreamEntry) -> None:
        self.acked: list[str] = []
        self.entry = entry
        self.stop: Callable[[], None] | None = None

    async def ensure_group(self, target: StreamGroup) -> None:
        del target

    async def claim_stale(
        self, target: StreamGroup, *, min_idle_ms: int, count: int
    ) -> list[StreamEntry]:
        del target, min_idle_ms, count
        return []

    async def read_group(
        self, target: StreamGroup, *, count: int, block_ms: int
    ) -> list[StreamEntry]:
        del target, count, block_ms
        if self.stop is None:
            raise AssertionError("用例必须在运行前接好停止信号")
        self.stop()
        return [self.entry]

    async def touch(self, target: StreamGroup, entry_id: str) -> bool:
        del target, entry_id
        return True

    async def ack_if_owned(self, target: StreamGroup, entry_id: str) -> bool:
        del target
        self.acked.append(entry_id)
        return True


class _Store:
    """取对象时发生临时存储错误的外部替身。"""

    async def stat(self, key: str) -> ObjectStat | None:
        del key
        raise ObjectStoreUnavailable("private-store-details")


async def _error(mode: str) -> AppError:
    def handler(request: httpx.Request) -> httpx.Response:
        if mode == "timeout":
            raise httpx.ReadTimeout("private-timeout-details", request=request)
        return httpx.Response(int(mode), text="private-upstream-body")

    async with httpx.AsyncClient(
        base_url="http://platform", transport=httpx.MockTransport(handler)
    ) as client:
        source = PlatformSource(client=client, headers={})
        try:
            await _read_failing_source(source, mode)
        except AppError as error:
            return error
    raise AssertionError("来源应拒绝这次读取")


async def _read_failing_source(source: PlatformSource, mode: str) -> None:
    if mode == "configuration":
        await source.discover({"path": "private-invalid-path"}, None)
        return
    if mode == "fetch":
        await source.fetch({}, "private-item-ref")
        return
    if mode == "store":
        # 替身仅实现这条失败路径会用到的对象存储边界。
        await UploadSource(store=cast("ObjectStore", _Store())).fetch(
            {}, "private-object-key"
        )
        return
    await source.discover({"path": "/private-platform-path"}, None)


@pytest.mark.parametrize(
    ("mode", "reason"),
    [
        ("configuration", "这一路来源的路径没配，或者不是一条平台路径"),
        ("fetch", "这一路来源不支持单独读取原件，请重新同步来源"),
        ("404", "无法读取来源，请检查来源配置后重新同步"),
        ("403", "没有读取平台来源的权限，请联系管理员授权"),
        ("401", "来源读取身份已失效，请重新登录后同步"),
    ],
)
async def test_a_permanent_source_failure_keeps_its_reason_and_is_acked(
    mode: str,
    reason: str,
) -> None:
    database, stream = await _run(mode)
    assert database.document.status == "failed"
    assert database.document.failure_reason == reason
    assert "private-" not in database.document.failure_reason
    assert stream.acked == ["1-0"]


@pytest.mark.parametrize("mode", ["timeout", "503", "store"])
async def test_a_temporary_source_failure_is_left_unacked(mode: str) -> None:
    database, stream = await _run(mode)
    assert database.document.status == "parsing"
    assert database.document.failure_reason == ""
    assert stream.acked == []


async def _run(mode: str) -> tuple[_Database, _Stream]:
    return await _run_source(_Source(error=await _error(mode)), "fixture")


async def _run_source(
    source: KnowledgeSource, kind: str
) -> tuple[_Database, _Stream]:
    database = _Database(kind)
    message = ingest_queue.new_message(database.document.id, uuid.uuid4(), None)
    stream = _Stream(StreamEntry(entry_id="1-0", fields=message.to_fields()))
    with ThreadPoolExecutor(max_workers=1) as pool:
        consumer = IngestConsumer(
            # 只替代数据库与队列的进程外边界。
            database=cast("Database", database),
            stream=cast("StreamLike", stream),
            deps=IngestDeps(
                sources=(source,),
                embedder=NullEmbedder(can_embed=True),
                indexes=build_indexes(dimensions=4),
                pool=pool,
                store=None,
                parse_timeout_s=30.0,
            ),
            options=ConsumerOptions(target=TARGET),
        )
        stream.stop = consumer.stop
        await consumer.run()
    return database, stream


class _TimeoutStream(BytesIO):
    """真实 SDK 流读取超时的底层替身。"""

    def read(self, size: int | None = -1) -> bytes:
        del size
        raise StreamReadTimeout(
            HTTPConnectionPool("test-pool"),
            "private-endpoint",
            "private-timeout",
        )


class _StorageClient:
    """只替代 SDK 客户端；异常仍经过真实适配器与来源端口。"""

    def __init__(self, fault: str) -> None:
        self.fault = fault

    def head_object(self, **kwargs: Any) -> dict[str, object]:
        del kwargs
        if self.fault in ("denied", "503", "unknown", "missing"):
            raise _storage_error(self.fault)
        return {"ContentLength": 5, "ContentType": "text/markdown"}

    def get_object(self, **kwargs: Any) -> dict[str, object]:
        del kwargs
        if self.fault not in ("stream-timeout", "stream-reset"):
            raise _storage_error(self.fault)
        raw = (
            _ResetStream() if self.fault == "stream-reset" else _TimeoutStream()
        )
        return {"Body": StreamingBody(raw, 5)}


class _ResetStream(BytesIO):
    """真实 SDK 流读取被连接重置打断的底层替身。"""

    def read(self, size: int | None = -1) -> bytes:
        del size
        raise StreamProtocolError(
            "private-reset", ConnectionResetError("private-reset")
        )


def _storage_error(fault: str) -> Exception:
    if fault == "read-timeout":
        return ReadTimeoutError(endpoint_url="private-endpoint")
    if fault == "unknown":
        return BotoCoreError()
    code, status = {
        "denied": ("AccessDenied", 403),
        "503": ("ServiceUnavailable", 503),
        "missing": ("NoSuchKey", 404),
    }[fault]
    return ClientError(
        {
            "Error": {"Code": code},
            "ResponseMetadata": {
                "HTTPStatusCode": status,
                "RequestId": "test",
                "HostId": "test",
                "HTTPHeaders": {},
                "RetryAttempts": 0,
            },
        },
        "GetObject",
    )


@pytest.mark.parametrize("kind", [UPLOAD_KIND, PLATFORM_KIND])
@pytest.mark.parametrize(
    "fault",
    [
        "denied",
        "503",
        "read-timeout",
        "stream-timeout",
        "stream-reset",
        "unknown",
        "missing",
    ],
)
async def test_storage_faults_cross_the_real_adapter_source_pipeline_and_worker(
    kind: str, fault: str
) -> None:
    # SDK 客户端是进程外边界，存储适配器、来源与消费循环均为真实实现。
    storage = S3ObjectStore(
        cast("S3Client", _StorageClient(fault)), "test-bucket"
    )
    database, stream = await _run_source(UploadSource(storage), kind)
    if fault in ("503", "read-timeout", "stream-timeout", "stream-reset"):
        assert database.document.status == "parsing"
        assert database.document.failure_reason == ""
        assert stream.acked == []
    else:
        assert database.document.status == "failed"
        assert "private-" not in database.document.failure_reason
        assert database.document.failure_reason == (
            "原件已经不在对象存储里了"
            if fault == "missing"
            else "无法读取原件，请检查对象存储配置或权限后重新解析"
        )
        assert stream.acked == ["1-0"]
