"""压缩任务信封的编解码。

⚠ 读不懂的消息**不能当成跑完了**：那会把一条本该被人看见的坏消息静默吞掉。
⚠ 信封必须带 traceparent，否则链路在这一跳齐断（observability §4.2）。
"""

import uuid
from typing import cast

import pytest

from platform_server.apps.assets.services import compress_queue
from platform_server.stream import StreamGroup, StreamLike

ASSET_ID = uuid.UUID("0192f0aa-0000-7000-8000-000000000001")
TRACE = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"


def message() -> compress_queue.CompressMessage:
    return compress_queue.CompressMessage(asset_id=ASSET_ID, traceparent=TRACE)


def test_a_message_survives_a_round_trip() -> None:
    decoded = compress_queue.decode(message().to_fields())

    assert decoded == message()


def test_the_envelope_carries_the_traceparent() -> None:
    # 漏了它，worker 那一跳就从链路上掉下来，而没有任何一处会报错
    assert message().to_fields()["traceparent"] == TRACE


def test_a_message_from_a_future_envelope_version_is_refused() -> None:
    fields = dict(message().to_fields())
    fields["envelope_version"] = "2"

    # 读不懂就拒，不猜：猜错的那次会去压一个不相干的素材
    assert compress_queue.decode(fields) is None


@pytest.mark.parametrize("missing", ["asset_id", "traceparent"])
def test_a_message_missing_a_required_field_is_refused(missing: str) -> None:
    fields = dict(message().to_fields())
    fields[missing] = ""

    assert compress_queue.decode(fields) is None


def test_a_message_with_an_unparseable_id_is_refused() -> None:
    fields = dict(message().to_fields())
    fields["asset_id"] = "not-a-uuid"

    assert compress_queue.decode(fields) is None


def test_new_message_stamps_the_current_trace() -> None:
    fresh = compress_queue.new_message(ASSET_ID)

    assert fresh.asset_id == ASSET_ID
    assert fresh.traceparent != ""


class _BrokenStream:
    """投递永远失败的流，并记下被试过几次。"""

    def __init__(self) -> None:
        self.attempts = 0

    async def publish(self, stream: str, fields: dict[str, str]) -> str:
        del stream, fields
        self.attempts += 1
        raise RuntimeError("队列不可达")


class _RecordingStream:
    """记下投进去的东西。"""

    def __init__(self) -> None:
        self.sent: list[dict[str, str]] = []

    async def publish(self, stream: str, fields: dict[str, str]) -> str:
        del stream
        self.sent.append(dict(fields))
        return "1-1"


TARGET = StreamGroup(stream="s", group="g", consumer="c")


async def test_dispatch_puts_the_message_on_the_stream() -> None:
    stream = _RecordingStream()

    # ⚠ 用 cast 而不是 `type: ignore`：替身只实现 publish（dispatch 也只用得到
    # 它），而抑制指令会把这一处的**全部**类型检查一起关掉
    await compress_queue.dispatch_compression(
        cast(StreamLike, stream), target=TARGET, message=message()
    )

    assert stream.sent[0]["asset_id"] == str(ASSET_ID)


async def test_dispatch_swallows_queue_failures() -> None:
    """⚠ 投递失败不许把已经落库的素材连累掉。

    原件在桶里、行在库里，素材本身可用；那几档停在 pending，由界面上的
    「重压」兜底。这里断言的就是「它不往外抛」。
    """
    stream = _BrokenStream()

    await compress_queue.dispatch_compression(
        cast(StreamLike, stream), target=TARGET, message=message()
    )

    assert stream.attempts == 1
