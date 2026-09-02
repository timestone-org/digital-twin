"""到 FunASR 的那条腿：握手、init、送 PCM、收口、把回帧拼成整段转写。

协议的三条硬事实（子协议 `binary` / 先发 init JSON / 收口前补足够长的尾部
静音）见 ADR-0038。每一次 recv 都带超时；出错一律翻成 `AsrUnavailable`，
**不重试**。
"""

import asyncio
import json
from dataclasses import dataclass, field
from typing import cast

from websockets.asyncio.client import ClientConnection, connect
from websockets.exceptions import WebSocketException
from websockets.typing import Subprotocol

from knowledge_server.apps.speech.errors import AsrUnavailable
from knowledge_server.apps.speech.services.protocol import (
    STAGE_FINAL,
    STAGE_PARTIAL,
    Transcript,
)
from lib.logging import get_logger

_logger = get_logger("knowledge.speech.funasr")

# 握手必须报的子协议。⚠ 不报它服务端直接 400「missing subprotocol」
FUNASR_SUBPROTOCOL = Subprotocol("binary")
# 识别模式：在线增量 + 离线整句修正
MODE_2PASS = "2pass"
# 音频形状：16 kHz 单声道 int16 小端
SAMPLE_RATE = 16_000
BYTES_PER_SAMPLE = 2
# 一帧 60 ms
FRAME_BYTES = SAMPLE_RATE * BYTES_PER_SAMPLE * 60 // 1000
# 收口前补的尾部静音缺省时长。⚠ FunASR 靠 VAD 判「说完了」，静音不够长它判
# 不出来、不给终稿，连最后一个字都丢；本部署实测 1.5 s 不够、3 s 够
TAIL_SILENCE_S = 3.0
# 往 FunASR 发一帧最多等多久。⚠ 对端假死时发送会挂在背压上，这条腿收不了口
SEND_TIMEOUT_S = 5.0
# 回帧 `mode` 的两种尾巴：`2pass-online` 是增量、`2pass-offline` 是整句
OFFLINE_SUFFIX = "offline"

ASR_UNREACHABLE = "这套部署的语音识别此刻不可用"
ASR_DROPPED = "语音识别服务中途断开了"


@dataclass(frozen=True)
class FunAsrConfig:
    """连 FunASR 要的几样。"""

    url: str
    hotwords: str = ""
    connect_timeout_s: float = 5.0
    tail_silence_s: float = TAIL_SILENCE_S


@dataclass(frozen=True)
class AsrFrame:
    """FunASR 回的一帧。"""

    mode: str
    text: str
    is_final: bool


@dataclass
class Stitcher:
    """把在线增量与离线整句拼成整段：已定稿各句 + 当前句的在线增量。

    ⚠ 在线帧的 `text` 是**新增的一截**，要拼接；离线帧是**整句**，替换掉
    这一句攒下的全部在线增量。两种帧同一个字段名，认错的表现是字重复出现
    或整句丢失。
    """

    committed: list[str] = field(default_factory=list[str])
    pending: str = ""
    # 已经告诉服务端说完了。⚠ 之后到的第一帧离线整句就是终稿，不看它自报的
    # `is_final`：FunASR 的 python 服务端把那一格填成 `is_speaking`，收口之后
    # 回的整句反而带着 false——只认那一格的表现是明明拿到了终稿还要干等超时
    is_ending: bool = False

    def absorb(self, frame: AsrFrame) -> Transcript:
        """吃进一帧，给出此刻的整段。

        Args: frame。
        """
        if frame.mode.endswith(OFFLINE_SUFFIX):
            self.committed.append(frame.text)
            self.pending = ""
            is_final = frame.is_final or self.is_ending
            stage = STAGE_FINAL if is_final else STAGE_PARTIAL
        else:
            self.pending += frame.text
            stage = STAGE_PARTIAL
        return Transcript(stage=stage, text=self.text())

    def text(self) -> str:
        return "".join(self.committed) + self.pending


def init_message(config: FunAsrConfig, wav_name: str) -> dict[str, object]:
    """连上之后要先发的那条 JSON。

    Args: config, wav_name。
    """
    return {
        "mode": MODE_2PASS,
        # 在线一档每次看多少块、多少块回一次：FunASR 的缺省，单位是它自己的块
        "chunk_size": [5, 10, 5],
        "chunk_interval": 10,
        "wav_name": wav_name,
        "is_speaking": True,
        "wav_format": "pcm",
        "audio_fs": SAMPLE_RATE,
        "hotwords": config.hotwords,
        "itn": True,
    }


def silence_bytes(seconds: float) -> bytes:
    """给定时长的零值 PCM。

    Args: seconds。
    """
    return bytes(int(SAMPLE_RATE * BYTES_PER_SAMPLE * seconds))


def parse_frame(raw: str | bytes) -> AsrFrame | None:
    """解 FunASR 的一帧；形状不对给 None。

    Args: raw。
    """
    try:
        parsed = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(parsed, dict):
        return None
    fields = cast("dict[str, object]", parsed)
    mode = fields.get("mode")
    text = fields.get("text", "")
    if not isinstance(mode, str) or not isinstance(text, str):
        return None
    return AsrFrame(
        mode=mode, text=text, is_final=bool(fields.get("is_final", False))
    )


async def open_leg(config: FunAsrConfig, *, wav_name: str) -> "FunAsrLeg":
    """连上 FunASR 并发 init。连不上、握手被拒、超时都翻成 `AsrUnavailable`。

    Args: config, wav_name。
    """
    try:
        connection = await connect(
            config.url,
            subprotocols=[FUNASR_SUBPROTOCOL],
            open_timeout=config.connect_timeout_s,
        )
    except (OSError, TimeoutError, WebSocketException) as error:
        _logger.warning(
            "speech_asr_connect_failed", "连不上语音识别服务", error=error
        )
        raise AsrUnavailable(ASR_UNREACHABLE) from error
    leg = FunAsrLeg(connection, tail_silence_s=config.tail_silence_s)
    await leg.send_text(json.dumps(init_message(config, wav_name)))
    return leg


class FunAsrLeg:
    """一条已经握手、发过 init 的 FunASR 连接。"""

    def __init__(
        self,
        connection: ClientConnection,
        *,
        tail_silence_s: float = TAIL_SILENCE_S,
    ) -> None:
        self._connection = connection
        self._tail = silence_bytes(tail_silence_s)
        self._stitcher = Stitcher()

    async def send_audio(self, pcm: bytes) -> None:
        """转发一帧 PCM。

        Args: pcm。
        """
        await self._send(pcm)

    async def send_text(self, text: str) -> None:
        """发一帧文本（init 与收口用）。

        Args: text。
        """
        await self._send(text)

    async def finish(self) -> None:
        """补尾部静音、告诉服务端说完了。

        静音按 60 ms 一帧送、帧间不等：与真实音频同形，而 3 s 也只有 50 帧。
        """
        self._stitcher.is_ending = True
        tail = self._tail
        for offset in range(0, len(tail), FRAME_BYTES):
            await self._send(tail[offset : offset + FRAME_BYTES])
        await self._send(json.dumps({"is_speaking": False}))

    async def next_transcript(self, *, timeout_s: float) -> Transcript | None:
        """等下一帧并拼进整段；`timeout_s` 内没来就给 None。

        Args: timeout_s。
        """
        try:
            async with asyncio.timeout(timeout_s):
                return await self._next()
        except TimeoutError:
            return None

    def transcript(self) -> str:
        """到目前为止的整段。"""
        return self._stitcher.text()

    async def aclose(self) -> None:
        await self._connection.close()

    async def _next(self) -> Transcript:
        while True:
            try:
                raw = await self._connection.recv()
            except (OSError, WebSocketException) as error:
                raise AsrUnavailable(ASR_DROPPED) from error
            frame = parse_frame(raw)
            if frame is None:
                _logger.debug("speech_asr_frame_ignored", "认不出的回帧")
                continue
            return self._stitcher.absorb(frame)

    async def _send(self, payload: bytes | str) -> None:
        try:
            async with asyncio.timeout(SEND_TIMEOUT_S):
                await self._connection.send(payload)
        except (OSError, TimeoutError, WebSocketException) as error:
            raise AsrUnavailable(ASR_DROPPED) from error
