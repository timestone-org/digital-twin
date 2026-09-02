"""中继编排的契约：ready 前的帧不丢、信封形状、stop/cancel 的收口、三道时限、
FunASR 断了怎么关。假浏览器 socket + 假 FunASR 腿，不起 ASGI。
"""

import asyncio
from collections.abc import Callable
from time import monotonic

from knowledge_server.apps.speech.errors import AsrUnavailable
from knowledge_server.apps.speech.services.bridge import (
    BrowserGone,
    ClientFrame,
    RelayLimits,
    relay,
)
from knowledge_server.apps.speech.services.protocol import (
    CLOSE_ASR_UNAVAILABLE,
    CLOSE_BAD_FRAME,
    CLOSE_INTERNAL_ERROR,
    CLOSE_NORMAL,
    STAGE_FINAL,
    STAGE_PARTIAL,
    Transcript,
)

STOP = '{"action":"stop"}'
CANCEL = '{"action":"cancel"}'
READY = {"type": "system", "event": "ready"}
DONE = {"type": "system", "event": "done"}
GONE = object()
LIMITS = RelayLimits(
    final_timeout_s=0.3, idle_timeout_s=0.2, max_utterance_s=60.0, poll_s=0.02
)


class FakeSocket:
    """假浏览器：帧从队列里来，空着就一直等（像一个开着麦但没送帧的页面）。"""

    def __init__(self, *frames: ClientFrame) -> None:
        self._queue: asyncio.Queue[ClientFrame | object] = asyncio.Queue()
        for one in frames:
            self._queue.put_nowait(one)
        self.sent: list[dict[str, object]] = []
        self.closed_with: int | None = None
        self.on_frame: Callable[[int], None] | None = None
        self._delivered = 0

    def push(self, frame: ClientFrame | object) -> None:
        self._queue.put_nowait(frame)

    async def receive(self) -> ClientFrame:
        item = await self._queue.get()
        if item is GONE:
            raise BrowserGone
        if self.on_frame is not None:
            self.on_frame(self._delivered)
        self._delivered += 1
        return item  # type: ignore[return-value]  # 队列里除 GONE 只放帧

    async def send_json(self, message: dict[str, object]) -> None:
        self.sent.append(message)

    async def close(self, code: int) -> None:
        self.closed_with = code

    def stages(self) -> list[tuple[object, object]]:
        return [
            (one["payload"]["stage"], one["payload"]["text"])  # type: ignore[index]  # 只挑 data 帧
            for one in self.sent
            if one["type"] == "data"
        ]


class FakeLeg:
    """假 FunASR 腿：按帧序号回放剧本，收口时给终稿（或不给）。"""

    def __init__(
        self,
        *,
        partials: dict[int, str] | None = None,
        final: str | None = None,
        error_after: int | None = None,
        raise_on_audio: Exception | None = None,
        final_delay_s: float = 0.0,
    ) -> None:
        self._partials = partials or {}
        self._final = final
        self._error_after = error_after
        self._raise_on_audio = raise_on_audio
        self._final_delay_s = final_delay_s
        self._queue: asyncio.Queue[Transcript | Exception] = asyncio.Queue()
        self._text = ""
        self.audio: list[bytes] = []
        self.is_finished = False
        self.is_closed = False

    async def send_audio(self, pcm: bytes) -> None:
        if self._raise_on_audio is not None:
            raise self._raise_on_audio
        self.audio.append(pcm)
        index = len(self.audio)
        if index in self._partials:
            self._text = self._partials[index]
            self._queue.put_nowait(Transcript(STAGE_PARTIAL, self._text))
        if self._error_after is not None and index >= self._error_after:
            self._queue.put_nowait(AsrUnavailable("语音识别服务中途断开了"))

    async def finish(self) -> None:
        self.is_finished = True
        if self._final is None:
            return
        if self._final_delay_s <= 0:
            self._deliver_final(self._final)
            return
        # 像真 FunASR 那样：终稿在收口之后过一会儿才到，到之前整段还是旧的
        asyncio.get_running_loop().call_later(
            self._final_delay_s, self._deliver_final, self._final
        )

    def _deliver_final(self, text: str) -> None:
        self._text = text
        self._queue.put_nowait(Transcript(STAGE_FINAL, text))

    async def next_transcript(self, *, timeout_s: float) -> Transcript | None:
        try:
            async with asyncio.timeout(timeout_s):
                item = await self._queue.get()
        except TimeoutError:
            return None
        if isinstance(item, Exception):
            raise item
        return item

    def transcript(self) -> str:
        return self._text

    async def aclose(self) -> None:
        self.is_closed = True


async def _run(socket: FakeSocket, leg: FakeLeg, **overrides: float) -> None:
    async def open_leg() -> FakeLeg:
        return leg

    limits = LIMITS
    if overrides:
        limits = RelayLimits(
            **{
                **LIMITS.__dict__,
                **overrides,
            }  # pyright: ignore[reportArgumentType]
        )
    await relay(socket, open_leg, limits)


async def test_frames_sent_before_ready_are_forwarded_in_order() -> None:
    """⚠ 浏览器开麦比中继连 FunASR 快是常态，先到的帧照收不丢。"""
    socket = FakeSocket(b"a", b"b", STOP)
    leg = FakeLeg(final="好")
    await _run(socket, leg)
    assert leg.audio == [b"a", b"b"]
    assert socket.sent[0] == READY


async def test_partial_and_final_frames_carry_the_whole_text() -> None:
    socket = FakeSocket(b"a", b"b", STOP)
    leg = FakeLeg(partials={1: "冷", 2: "冷却"}, final="冷却水。")
    await _run(socket, leg)
    assert socket.stages() == [
        (STAGE_PARTIAL, "冷"),
        (STAGE_PARTIAL, "冷却"),
        (STAGE_FINAL, "冷却水。"),
    ]
    assert socket.sent[1] == {
        "type": "data",
        "payload": {"stage": STAGE_PARTIAL, "text": "冷"},
    }


async def test_stop_ends_with_final_then_done_then_a_normal_close() -> None:
    socket = FakeSocket(b"a", STOP)
    leg = FakeLeg(final="好")
    await _run(socket, leg)
    assert socket.sent[-2:] == [
        {"type": "data", "payload": {"stage": STAGE_FINAL, "text": "好"}},
        DONE,
    ]
    assert socket.closed_with == CLOSE_NORMAL
    assert leg.is_finished
    assert leg.is_closed


async def test_cancel_skips_the_final_and_closes_normally() -> None:
    socket = FakeSocket(b"a", CANCEL)
    leg = FakeLeg(final="不该出现")
    await _run(socket, leg)
    assert DONE not in socket.sent
    assert socket.stages() == []
    assert socket.closed_with == CLOSE_NORMAL
    assert leg.is_finished is False
    assert leg.is_closed


async def test_a_browser_that_goes_quiet_is_closed_without_done() -> None:
    socket = FakeSocket(b"a")
    leg = FakeLeg(final="不该出现")
    await _run(socket, leg)
    assert DONE not in socket.sent
    assert socket.closed_with == CLOSE_NORMAL
    assert leg.is_finished is False


async def test_the_utterance_cap_acts_as_stop() -> None:
    """一句话到了上限就当 stop：补静音、要终稿、发 done，不再转发音频。"""
    socket = FakeSocket(b"a", b"b", b"c")
    leg = FakeLeg(final="到此为止")
    shift = [0.0]

    def jump(index: int) -> None:
        if index == 1:
            shift[0] = 100.0

    socket.on_frame = jump

    async def open_leg() -> FakeLeg:
        return leg

    await relay(socket, open_leg, LIMITS, clock=lambda: monotonic() + shift[0])
    assert leg.audio == [b"a"]
    assert leg.is_finished
    assert socket.sent[-1] == DONE
    assert socket.closed_with == CLOSE_NORMAL


async def test_a_late_final_is_not_preempted_by_the_streaming_poll() -> None:
    """⚠ 收口之前就在等的那一轮 poll 到期，不等于终稿超时：终稿常在 stop 后
    半秒多才到，被节拍抢先的表现是每一句都拿到不带标点的在线整段。"""
    socket = FakeSocket(b"a")
    # 没有任何在线增量（一句很短的话），poll 只会一轮轮空转到期；stop 要等
    # 收帧循环已经在等着时才到，否则复现不了「上一轮 poll 抢先到期」
    asyncio.get_running_loop().call_later(0.03, socket.push, STOP)
    leg = FakeLeg(final="好。", final_delay_s=0.08)
    await _run(socket, leg, final_timeout_s=0.5, poll_s=0.02)
    assert socket.stages() == [(STAGE_FINAL, "好。")]
    assert socket.sent[-1] == DONE


async def test_final_timeout_hands_over_what_we_have() -> None:
    """服务端不给终稿时，到点把手头的当 final 发出去，再发 done。"""
    socket = FakeSocket(b"a", STOP)
    leg = FakeLeg(partials={1: "冷却"})
    await _run(socket, leg, final_timeout_s=0.1)
    assert socket.stages() == [(STAGE_PARTIAL, "冷却"), (STAGE_FINAL, "冷却")]
    assert socket.sent[-1] == DONE
    assert socket.closed_with == CLOSE_NORMAL


async def test_a_dropped_asr_leg_yields_an_error_frame_and_1013() -> None:
    socket = FakeSocket(b"a")
    leg = FakeLeg(error_after=1)
    await _run(socket, leg)
    error = socket.sent[-1]
    assert error["type"] == "error"
    assert error["code"] == AsrUnavailable.code
    assert socket.closed_with == CLOSE_ASR_UNAVAILABLE
    assert leg.is_closed


async def test_an_unreachable_asr_yields_an_error_frame_and_1013() -> None:
    socket = FakeSocket(b"a")

    async def open_leg() -> FakeLeg:
        raise AsrUnavailable("这套部署的语音识别此刻不可用")

    await relay(socket, open_leg, LIMITS)
    assert READY not in socket.sent
    assert socket.sent[-1]["type"] == "error"
    assert socket.closed_with == CLOSE_ASR_UNAVAILABLE


async def test_an_unknown_action_is_refused_with_an_error_frame() -> None:
    socket = FakeSocket('{"action":"jump"}')
    leg = FakeLeg()
    await _run(socket, leg)
    assert socket.sent[-1]["type"] == "error"
    assert socket.closed_with == CLOSE_BAD_FRAME


async def test_a_relay_failure_is_reported_as_1011() -> None:
    socket = FakeSocket(b"a")
    leg = FakeLeg(raise_on_audio=RuntimeError("boom"))
    await _run(socket, leg)
    assert socket.sent[-1]["type"] == "error"
    assert socket.closed_with == CLOSE_INTERNAL_ERROR
    assert leg.is_closed


async def test_a_browser_that_vanishes_leaves_nothing_half_open() -> None:
    socket = FakeSocket(b"a", GONE)  # type: ignore[arg-type]  # 哨兵
    leg = FakeLeg()
    await _run(socket, leg)
    assert socket.closed_with is None
    assert leg.is_closed
