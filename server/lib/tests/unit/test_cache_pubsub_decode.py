"""解码与 traceparent 的单元用例——不打 Redis 的那一半。

⚠ 这里守的是「一条坏消息不该掀翻整条订阅循环」：解不出来的载荷跳过并记日志，
不抛。抛的话，该副本上所有连接会一起停止收数据，而起因只是别人发错了一条。
"""

import json

from lib.cache.pubsub import TRACEPARENT_KEY, PubSub, _decode, _traceparent
from lib.logging.context import bind_log_context, reset_log_context

VALID = {"channel": "t.demo", "data": '{"seq": 3}'}
EXPLICIT_TRACEPARENT = f"00-{'c' * 32}-{'d' * 16}-01"


class _RecordingRedis:
    """记下发布内容的假 Redis。"""

    def __init__(self) -> None:
        self.published: list[str] = []

    async def publish(self, _channel: str, message: str) -> int:
        self.published.append(message)
        return 1


def _pubsub(client: _RecordingRedis) -> PubSub:
    pubsub = PubSub(url="redis://unused:6379/0")
    pubsub._client = client  # type: ignore[assignment]  # 测试注入
    return pubsub


def test_decodes_a_well_formed_message() -> None:
    assert _decode(VALID) == ("t.demo", {"seq": 3})


def test_skips_a_message_that_is_not_a_mapping() -> None:
    assert _decode("not a dict") is None


def test_skips_a_message_whose_channel_or_data_is_not_text() -> None:
    assert _decode({"channel": 1, "data": "{}"}) is None
    assert _decode({"channel": "t", "data": None}) is None


def test_skips_a_payload_that_is_not_valid_json() -> None:
    assert _decode({"channel": "t", "data": "{ not json"}) is None


def test_skips_a_payload_that_is_json_but_not_an_object() -> None:
    # ⚠ `[1,2]` 是合法 JSON，但信封约定是对象；放行会让消费方拿到列表下标
    assert _decode({"channel": "t", "data": "[1, 2]"}) is None


def test_traceparent_is_all_zero_when_there_is_no_trace() -> None:
    # 全零仍是合法格式：订阅方照常解析，而「全零」说明发送侧没有链路
    parts = _traceparent().split("-")
    assert parts[0] == "00"
    assert set(parts[1]) == {"0"}
    assert len(parts[1]) == 32
    assert len(parts[2]) == 16


def test_traceparent_carries_the_current_trace() -> None:
    token = bind_log_context(trace_id="a" * 32, span_id="b" * 16)
    try:
        assert _traceparent() == f"00-{'a' * 32}-{'b' * 16}-01"
    finally:
        reset_log_context(token)


def test_the_envelope_key_is_the_contract_name() -> None:
    # 与 api-contract §10 的消息契约同名，改名即是破坏性变更
    assert TRACEPARENT_KEY == "traceparent"


async def test_publish_keeps_the_callers_traceparent() -> None:
    # ⚠ 推送方的 span 经 HTTP 头跨服务而来，本进程的上下文顶替它就断了链
    client = _RecordingRedis()
    payload = {"seq": 1, TRACEPARENT_KEY: EXPLICIT_TRACEPARENT}
    await _pubsub(client).publish("t.demo", payload)
    assert json.loads(client.published[0])[TRACEPARENT_KEY] == (
        EXPLICIT_TRACEPARENT
    )


async def test_publish_fills_in_the_traceparent_when_it_is_absent() -> None:
    client = _RecordingRedis()
    token = bind_log_context(trace_id="e" * 32, span_id="f" * 16)
    try:
        await _pubsub(client).publish("t.demo", {"seq": 1})
    finally:
        reset_log_context(token)
    assert json.loads(client.published[0])[TRACEPARENT_KEY] == (
        f"00-{'e' * 32}-{'f' * 16}-01"
    )
