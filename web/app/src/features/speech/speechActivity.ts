/** @fileoverview 基于 PCM 能量的静音收尾与录音时限，不保存音频帧。 */
import { TARGET_SAMPLE_RATE } from './pcm'

const INITIAL_SILENCE_MS = 8_000
const TRAILING_SILENCE_MS = 2_000
const MAX_RECORDING_MS = 60_000
const MIN_VOICE_MS = 120
const MIN_RMS = 500

export type AutoStopReason = 'no-speech' | 'silence' | 'limit'
export interface SpeechActivity {
  accept: (frame: ArrayBuffer) => void
  dispose: () => void
}

/** 检测去除直流偏移后的声音能量。 */
function isAudible(frame: ArrayBuffer): boolean {
  const samples = new Int16Array(frame, 0, Math.floor(frame.byteLength / 2))
  if (samples.length === 0) return false
  let sum = 0
  let squares = 0
  for (const sample of samples) {
    sum += sample
    squares += sample * sample
  }
  const mean = sum / samples.length
  return squares / samples.length - mean * mean >= MIN_RMS * MIN_RMS
}

/**
 * 麦克风就绪后启动时限；结束或取消时释放全部计时器。
 * @param onEnd 自动收尾原因
 */
export function createSpeechActivity(
  onEnd: (reason: AutoStopReason) => void,
): SpeechActivity {
  let disposed = false
  let hasVoice = false
  let voicedMs = 0
  let silenceTimer: ReturnType<typeof setTimeout> | undefined
  const dispose = (): void => {
    disposed = true
    clearTimeout(initialTimer)
    clearTimeout(limitTimer)
    if (silenceTimer !== undefined) clearTimeout(silenceTimer)
  }
  const end = (reason: AutoStopReason): void => {
    if (disposed) return
    dispose()
    onEnd(reason)
  }
  const initialTimer = setTimeout(() => end('no-speech'), INITIAL_SILENCE_MS)
  const limitTimer = setTimeout(() => end('limit'), MAX_RECORDING_MS)
  const accept = (frame: ArrayBuffer): void => {
    if (disposed) return
    if (!isAudible(frame)) {
      voicedMs = 0
      return
    }
    voicedMs += (frame.byteLength / 2 / TARGET_SAMPLE_RATE) * 1000
    if (!hasVoice && voicedMs < MIN_VOICE_MS) return
    hasVoice = true
    clearTimeout(initialTimer)
    if (silenceTimer !== undefined) clearTimeout(silenceTimer)
    silenceTimer = setTimeout(() => end('silence'), TRAILING_SILENCE_MS)
  }
  return { accept, dispose }
}
