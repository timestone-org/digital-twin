"""浏览器 socket 与 FunASR 腿之间的中继编排：双向泵、两道定时、收口。

协议与关闭码在 `protocol.py`，设计见 ADR-0038。⚠ 这里**不重试**：一条链路
只有一层负责重试，而这条链上那一层是用户再按一次麦克风。
"""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from time import monotonic
from typing import Protocol

from knowledge_server.apps.speech.errors import (
    AsrUnavailable,
    SpeechBadFrame,
    SpeechRelayFailed,
)
from knowledge_server.apps.speech.services.protocol import (
    ACTION_CANCEL,
    ACTION_STOP,
    CLOSE_ASR_UNAVAILABLE,
    CLOSE_BAD_FRAME,
    CLOSE_INTERNAL_ERROR,
    CLOSE_NORMAL,
    STAGE_FINAL,
    Transcript,
    client_action,
    done_frame,
    error_frame,
    ready_frame,
    transcript_frame,
)
from lib.errors import AppError
from lib.logging import get_logger

_logger = get_logger("knowledge.speech.bridge")

# 流式阶段一次等回帧多久。⚠ 不是 FunASR 的超时：用户不说话时它本来就不回，
# 这一格只是让收帧循环定期回头看 stop 到了没有
RECV_POLL_S = 1.0

type ClientFrame = bytes | str
Clock = Callable[[], float]


class BrowserGone(Exception):
    """浏览器那头已经断了：没人可以再收任何一帧。"""


class BrowserSocket(Protocol):
    """浏览器那一侧的连接。抽象掉 Starlette，编排层的用例才不必起 ASGI。"""

    async def receive(self) -> ClientFrame:
        """收一帧：二进制是 PCM，文本是动作；浏览器断了抛 `BrowserGone`。"""
        ...

    async def send_json(self, message: dict[str, object]) -> None:
        """发一帧信封。

        Args: message。
        """
        ...

    async def close(self, code: int) -> None:
        """关连接。

        Args: code。
        """
        ...


class AsrLeg(Protocol):
    """到 FunASR 的那条腿。"""

    async def send_audio(self, pcm: bytes) -> None:
        """转发一帧 PCM。

        Args: pcm。
        """
        ...

    async def finish(self) -> None:
        """补静音、告诉服务端说完了。"""
        ...

    async def next_transcript(self, *, timeout_s: float) -> Transcript | None:
        """等下一帧；`timeout_s` 内没来就给 None。

        Args: timeout_s。
        """
        ...

    def transcript(self) -> str:
        """到目前为止的整段。"""
        ...

    async def aclose(self) -> None:
        """断掉这条腿。"""
        ...


OpenLeg = Callable[[], Awaitable[AsrLeg]]


@dataclass(frozen=True)
class RelayLimits:
    """一条中继的三道时限与收帧节拍。"""

    # stop 之后等终稿多久；到点就把手头的当 final 发出去
    final_timeout_s: float
    # 浏览器多久不送帧就当它走了
    idle_timeout_s: float
    # 一句话最长多久，超了当 stop
    max_utterance_s: float
    poll_s: float = RECV_POLL_S


async def relay(
    socket: BrowserSocket,
    open_leg: OpenLeg,
    limits: RelayLimits,
    *,
    clock: Clock = monotonic,
) -> None:
    """一条已 accept 的浏览器连接从 ready 到关闭的全部。

    Args: socket, open_leg, limits, clock。
    """
    await _Relay(socket, limits, clock).run(open_leg)


class _Relay:
    """一条中继的状态：两个截止时刻。"""

    def __init__(
        self, socket: BrowserSocket, limits: RelayLimits, clock: Clock
    ) -> None:
        self._socket = socket
        self._limits = limits
        self._clock = clock
        self._utterance_deadline_s = clock() + limits.max_utterance_s
        # 非 None 即已收口（stop 或到了最长时长），值是等终稿的截止时刻
        self._final_deadline_s: float | None = None

    async def run(self, open_leg: OpenLeg) -> None:
        """连 FunASR → ready → 双向泵 → 收口 → 关。

        Args: open_leg。
        """
        try:
            leg = await open_leg()
        except AsrUnavailable as error:
            await self._fail(error, CLOSE_ASR_UNAVAILABLE)
            return
        try:
            await self._serve(leg)
        finally:
            await leg.aclose()

    async def _serve(self, leg: AsrLeg) -> None:
        try:
            await self._socket.send_json(ready_frame())
            self._utterance_deadline_s = (
                self._clock() + self._limits.max_utterance_s
            )
            code = await self._pump(leg)
        except BrowserGone:
            return
        except AsrUnavailable as error:
            _logger.warning(
                "speech_asr_dropped", "语音识别那条腿断了", error=error
            )
            await self._fail(error, CLOSE_ASR_UNAVAILABLE)
            return
        except Exception as error:
            _logger.error("speech_relay_failed", "中继自己出错", error=error)
            await self._fail(
                SpeechRelayFailed("语音中继出错了"), CLOSE_INTERNAL_ERROR
            )
            return
        await self._close(code)

    async def _pump(self, leg: AsrLeg) -> int:
        """两个方向各一个任务；先结束的那个决定关闭码。

        ⚠ 流式阶段只有出错才会让 FunASR 那一头先结束；stop 之后浏览器那一头
        交出收口，由 FunASR 那一头等终稿、发 done。

        Args: leg。
        """
        up = asyncio.create_task(self._pump_up(leg))
        down = asyncio.create_task(self._pump_down(leg))
        try:
            done, _pending = await asyncio.wait(
                {up, down}, return_when=asyncio.FIRST_COMPLETED
            )
            if down in done:
                return down.result()
            code = up.result()
            return code if code is not None else await down
        finally:
            for task in (up, down):
                task.cancel()
            await asyncio.gather(up, down, return_exceptions=True)

    async def _pump_up(self, leg: AsrLeg) -> int | None:
        """浏览器 → FunASR。给关闭码；收口之后给 None，把收尾交给另一头。

        Args: leg。
        """
        while True:
            frame = await self._receive()
            if frame is None:
                return CLOSE_NORMAL
            if isinstance(frame, str):
                return await self._act(leg, frame)
            if self._clock() >= self._utterance_deadline_s:
                _logger.info(
                    "speech_utterance_capped", "一句话到了上限，按 stop 处理"
                )
                await self._finish(leg)
                return None
            await leg.send_audio(frame)

    async def _receive(self) -> ClientFrame | None:
        try:
            async with asyncio.timeout(self._limits.idle_timeout_s):
                return await self._socket.receive()
        except TimeoutError:
            _logger.info("speech_browser_idle", "浏览器不再送帧，按离开处理")
            return None

    async def _act(self, leg: AsrLeg, raw: str) -> int | None:
        """处理一帧动作。

        Args: leg, raw。
        """
        action = client_action(raw)
        if action == ACTION_CANCEL:
            return CLOSE_NORMAL
        if action == ACTION_STOP:
            await self._finish(leg)
            return None
        bad = SpeechBadFrame("认不出这一帧：只收 stop 与 cancel")
        await self._socket.send_json(error_frame(bad.code, bad.message))
        return CLOSE_BAD_FRAME

    async def _finish(self, leg: AsrLeg) -> None:
        """收口：定下等终稿的截止时刻，再让那条腿补静音、报结束。

        ⚠ 先定截止再发：反过来的话，终稿在两步之间到了会被当成流式阶段的
        普通一帧，收帧循环不结束。

        Args: leg。
        """
        self._final_deadline_s = self._clock() + self._limits.final_timeout_s
        await leg.finish()

    async def _pump_down(self, leg: AsrLeg) -> int:
        """FunASR → 浏览器。收口之后收到终稿（或等到超时）就发 done。

        Args: leg。
        """
        while True:
            got = await leg.next_transcript(timeout_s=self._recv_timeout_s())
            if got is not None:
                await self._socket.send_json(transcript_frame(got))
                if got.stage == STAGE_FINAL and self._is_finishing:
                    break
                continue
            if not self._is_finishing:
                continue
            # ⚠ 这一次 None 多半来自收口**之前**就在等的那一轮 poll：它到期
            # 不等于终稿超时。截止没到就接着等——终稿常在 stop 后半秒多才到，
            # 被 1 s 的节拍抢先判成超时的表现是每一句都拿到不带标点的在线整段
            if self._recv_timeout_s() > 0:
                continue
            _logger.info("speech_final_timed_out", "等终稿超时，以手头的当终稿")
            final = Transcript(stage=STAGE_FINAL, text=leg.transcript())
            await self._socket.send_json(transcript_frame(final))
            break
        await self._socket.send_json(done_frame())
        return CLOSE_NORMAL

    @property
    def _is_finishing(self) -> bool:
        return self._final_deadline_s is not None

    def _recv_timeout_s(self) -> float:
        if self._final_deadline_s is None:
            return self._limits.poll_s
        return max(self._final_deadline_s - self._clock(), 0.0)

    async def _fail(self, error: AppError, code: int) -> None:
        """一帧 error，随后按给定关闭码关掉。

        Args: error, code。
        """
        try:
            await self._socket.send_json(error_frame(error.code, error.message))
            await self._socket.close(code)
        except BrowserGone:
            return

    async def _close(self, code: int) -> None:
        try:
            await self._socket.close(code)
        except BrowserGone:
            return
