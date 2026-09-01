"""摄取任务的信封：traceparent 必须带上，读不懂的消息不许当成跑完了。"""

import uuid
from collections.abc import Mapping

from knowledge_server.apps.knowledge.services import ingest_queue
from lib.stream import StreamGroup

DOC = uuid.UUID("00000000-0000-7000-8000-000000000002")
BASE = uuid.UUID("00000000-0000-7000-8000-000000000001")
TARGET = StreamGroup(stream="s", group="g", consumer="c")


class _Stream:
    def __init__(self, *, is_failing: bool = False) -> None:
        self.sent: list[tuple[str, Mapping[str, str]]] = []
        self._is_failing = is_failing

    async def publish(self, stream: str, fields: Mapping[str, str]) -> str:
        if self._is_failing:
            raise RuntimeError("队列此刻不可达")
        self.sent.append((stream, fields))
        return "1-0"


def test_the_envelope_always_carries_a_traceparent() -> None:
    """⚠ 队列是异步的，不带它链路在这一跳齐断，而每一段单看都是完整的。"""
    fields = ingest_queue.new_message(DOC, BASE).to_fields()
    assert "traceparent" in fields
    assert fields["document_id"] == str(DOC)
    assert fields["base_id"] == str(BASE)


def test_a_round_trip_keeps_every_field() -> None:
    message = ingest_queue.IngestMessage(
        document_id=DOC, base_id=BASE, traceparent="tp"
    )
    assert ingest_queue.decode(message.to_fields()) == message


def test_an_older_envelope_version_is_refused() -> None:
    """⚠ 拒掉读不懂的消息而不是猜：猜错的表现是把一份文档解成另一份。"""
    fields = dict(ingest_queue.IngestMessage(DOC, BASE, "tp").to_fields())
    fields["envelope_version"] = "0"
    assert ingest_queue.decode(fields) is None


def test_a_malformed_id_is_refused() -> None:
    fields = dict(ingest_queue.IngestMessage(DOC, BASE, "tp").to_fields())
    fields["document_id"] = "不是 uuid"
    assert ingest_queue.decode(fields) is None


def test_a_missing_traceparent_is_refused() -> None:
    fields = dict(ingest_queue.IngestMessage(DOC, BASE, "tp").to_fields())
    fields["traceparent"] = ""
    assert ingest_queue.decode(fields) is None


async def test_dispatch_puts_the_message_on_the_stream() -> None:
    stream = _Stream()
    await ingest_queue.dispatch_ingest(
        stream,  # pyright: ignore[reportArgumentType]
        TARGET,
        ingest_queue.new_message(DOC, BASE),
    )
    assert stream.sent[0][0] == "s"


async def test_a_failed_dispatch_never_raises() -> None:
    """⚠ 文档本身已经登记好了（原件在桶里、行在库里 pending）。投递失败只
    意味着它停在待处理，由界面上的「重新解析」兜底——为此把整个登记回滚掉
    才是真损失。这条链路上没有任何一层在重试，故失败必须记 error。"""
    stream = _Stream(is_failing=True)
    await ingest_queue.dispatch_ingest(
        stream,  # pyright: ignore[reportArgumentType]
        TARGET,
        ingest_queue.new_message(DOC, BASE),
    )
    assert stream.sent == []
