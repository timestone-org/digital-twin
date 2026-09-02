"""到 FunASR 那条腿的契约：握手形状、init、PCM 原样到达、收口补静音、增量拼接。

对着一台进程内的假 FunASR 跑，真服务的三条协议硬事实见 ADR-0038。
"""

import pytest
from unit.funasr_fakes import FakeFunAsr, Script

from knowledge_server.apps.speech.errors import AsrUnavailable
from knowledge_server.apps.speech.services.funasr import (
    SAMPLE_RATE,
    TAIL_SILENCE_S,
    AsrFrame,
    FunAsrConfig,
    Stitcher,
    open_leg,
    parse_frame,
    silence_bytes,
)
from knowledge_server.apps.speech.services.protocol import (
    STAGE_FINAL,
    STAGE_PARTIAL,
    Transcript,
)

PCM = bytes(range(256)) * 8
WAIT_S = 2.0
END = '{"is_speaking": false}'


async def test_the_handshake_offers_binary_and_sends_init_first() -> None:
    fake = FakeFunAsr()
    async with fake.serving() as url:
        leg = await open_leg(
            FunAsrConfig(url=url, hotwords="冷却水"), wav_name="t1"
        )
        await leg.send_audio(PCM)
        await leg.aclose()
    assert fake.subprotocol == "binary"
    assert isinstance(fake.messages[0], str)
    init = fake.init()
    assert init["mode"] == "2pass"
    assert init["audio_fs"] == SAMPLE_RATE
    assert init["wav_format"] == "pcm"
    assert init["is_speaking"] is True
    assert init["hotwords"] == "冷却水"


async def test_audio_arrives_verbatim_and_finish_pads_silence_then_ends() -> (
    None
):
    """⚠ 尾部静音不够长，FunASR 的 VAD 判不出说完、不给终稿。缺省 3 s：
    本部署实测 1.5 s 不够。"""
    fake = FakeFunAsr()
    async with fake.serving() as url:
        leg = await open_leg(FunAsrConfig(url=url), wav_name="t2")
        await leg.send_audio(PCM)
        await leg.finish()
        await leg.aclose()
    audio = fake.audio()
    assert audio[0] == PCM
    tail = b"".join(audio[1:])
    assert tail == silence_bytes(TAIL_SILENCE_S)
    assert len(tail) == SAMPLE_RATE * 2 * 3.0
    assert fake.messages[-1] == END


async def test_the_tail_silence_length_follows_the_config() -> None:
    """现场 VAD 的尾部判定各不相同，静音长短要能按部署调。"""
    fake = FakeFunAsr()
    async with fake.serving() as url:
        leg = await open_leg(
            FunAsrConfig(url=url, tail_silence_s=0.5), wav_name="t2b"
        )
        await leg.finish()
        await leg.aclose()
    assert b"".join(fake.audio()) == silence_bytes(0.5)
    assert len(fake.audio()) == 9


async def test_online_increments_concatenate_and_offline_replaces() -> None:
    fake = FakeFunAsr(Script(online=("冷", "却水"), offline="冷却水出口温度？"))
    async with fake.serving() as url:
        leg = await open_leg(FunAsrConfig(url=url), wav_name="t3")
        await leg.send_audio(PCM)
        first = await leg.next_transcript(timeout_s=WAIT_S)
        await leg.send_audio(PCM)
        second = await leg.next_transcript(timeout_s=WAIT_S)
        await leg.finish()
        final = await leg.next_transcript(timeout_s=WAIT_S)
        await leg.aclose()
    assert first == Transcript(STAGE_PARTIAL, "冷")
    assert second == Transcript(STAGE_PARTIAL, "冷却水")
    assert final == Transcript(STAGE_FINAL, "冷却水出口温度？")
    assert leg.transcript() == "冷却水出口温度？"


async def test_no_final_within_the_timeout_is_reported_as_none() -> None:
    """服务端不回终稿时如实给 None，由编排层决定拿手头的当终稿。"""
    fake = FakeFunAsr(Script(online=("冷",), has_final=False))
    async with fake.serving() as url:
        leg = await open_leg(FunAsrConfig(url=url), wav_name="t4")
        await leg.send_audio(PCM)
        assert await leg.next_transcript(timeout_s=WAIT_S) is not None
        await leg.finish()
        assert await leg.next_transcript(timeout_s=0.1) is None
        await leg.aclose()
    assert leg.transcript() == "冷"


async def test_an_unreachable_server_surfaces_as_unavailable() -> None:
    with pytest.raises(AsrUnavailable):
        await open_leg(
            FunAsrConfig(url="ws://127.0.0.1:1", connect_timeout_s=0.5),
            wav_name="t5",
        )


async def test_a_mid_stream_drop_surfaces_as_unavailable() -> None:
    fake = FakeFunAsr(Script(drop_after=1))
    async with fake.serving() as url:
        leg = await open_leg(FunAsrConfig(url=url), wav_name="t6")
        await leg.send_audio(PCM)
        with pytest.raises(AsrUnavailable):
            await leg.next_transcript(timeout_s=WAIT_S)
        await leg.aclose()


def test_the_stitcher_keeps_committed_sentences_across_segments() -> None:
    """⚠ 中途的离线整句是 `is_final=false` 的：它替换当前句、不结束整段。"""
    stitcher = Stitcher()
    stitcher.absorb(AsrFrame("2pass-online", "第一", is_final=False))
    stitcher.absorb(AsrFrame("2pass-offline", "第一句。", is_final=False))
    stitcher.absorb(AsrFrame("2pass-online", "第二", is_final=False))
    assert stitcher.text() == "第一句。第二"
    final = stitcher.absorb(
        AsrFrame("2pass-offline", "第二句。", is_final=True)
    )
    assert final == Transcript(STAGE_FINAL, "第一句。第二句。")


def test_after_finish_the_first_offline_sentence_is_final_regardless() -> None:
    """⚠ FunASR 的 python 服务端把 `is_final` 填成 `is_speaking`：收口之后回的
    整句带着 false。只认那一格的表现是明明拿到了终稿还要干等超时。"""
    stitcher = Stitcher()
    stitcher.absorb(AsrFrame("2pass-online", "冷却", is_final=False))
    stitcher.is_ending = True
    final = stitcher.absorb(
        AsrFrame("2pass-offline", "冷却水。", is_final=False)
    )
    assert final == Transcript(STAGE_FINAL, "冷却水。")


def test_frames_that_are_not_transcripts_are_ignored() -> None:
    assert parse_frame("[1]") is None
    assert parse_frame("nope") is None
    assert parse_frame('{"text": "x"}') is None
    assert parse_frame('{"mode": "2pass-online"}') == AsrFrame(
        "2pass-online", "", is_final=False
    )
