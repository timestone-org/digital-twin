"""抽取队列的套接字超时必须盖住每条消费循环的阻塞读。

⚠ 四条消费循环各有自己的 `*_block_ms`：只按其中一条定超时，别的循环调大
阻塞时长后队列一空就被报成 Redis 故障。
"""

import pytest

from lib.stream import RedisStream
from platform_server.container import STREAM_READ_MARGIN_S, _build_stream
from unit.wiring_fakes import build_settings

BLOCK_KNOBS = (
    "acstartup_block_ms",
    "acmodel_block_ms",
    "modeling_block_ms",
    "acdaily_block_ms",
)


def _socket_timeout_of(stream: RedisStream) -> float:
    """取装配出的套接字超时。Args: stream。"""
    # 理由 —— 断言装配结果，只能读私有客户端
    kwargs = stream._client.connection_pool.connection_kwargs
    timeout = kwargs["socket_timeout"]
    assert isinstance(timeout, float)
    return timeout


@pytest.mark.parametrize("knob", BLOCK_KNOBS)
def test_timeout_covers_the_longest_block(knob: str) -> None:
    settings = build_settings().model_copy(update={knob: 20_000})
    timeout = _socket_timeout_of(_build_stream(settings))
    assert timeout == pytest.approx(20.0 + STREAM_READ_MARGIN_S)
