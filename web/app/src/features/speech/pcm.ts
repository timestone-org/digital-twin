/**
 * @fileoverview PCM 采集里不碰浏览器对象的那一半：目标采样率、帧大小、处理器名，
 * 以及 float32 → 16 kHz int16 的降采样。主线程与 AudioWorklet 两边共用，所以
 * 这里不许出现 window / AudioContext。
 */

/** FunASR 要的采样率。 */
export const TARGET_SAMPLE_RATE = 16_000

/** 一帧 60 ms：16000 × 2 字节 × 0.06。 */
export const FRAME_BYTES = 1920

/** worklet 里登记的处理器名；`pcmCapture.ts` 按它建节点，两边必须同一个串。 */
export const PCM_CAPTURE_PROCESSOR = 'dt-pcm-capture'

const INT16_MAX = 0x7fff
const INT16_SPAN = 0x8000

/** 一次降采样能产出多少样本、会吃掉多少输入。 */
export interface DownsampleSpan {
  produced: number
  /** 输入里被用掉的样本数；余下的尾巴要留给下一段。 */
  consumed: number
}

function toInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value))
  return Math.round(clamped < 0 ? clamped * INT16_SPAN : clamped * INT16_MAX)
}

/**
 * 这一段输入按整数个输出样本切到哪。
 * ⚠ 吃不完的尾巴必须留给下一段：44.1k → 16k 的比率是 2.75625，每个 128 样本
 * 的渲染块各自取整会各丢半个样本，攒一秒就是几十毫秒的漂移。
 * @param inputLength 输入样本数
 * @param fromRate 输入采样率
 * @param toRate 目标采样率
 */
export function downsampleSpan(
  inputLength: number,
  fromRate: number,
  toRate: number,
): DownsampleSpan {
  if (fromRate <= toRate) {
    return { produced: inputLength, consumed: inputLength }
  }
  const ratio = fromRate / toRate
  const produced = Math.floor(inputLength / ratio)
  return { produced, consumed: Math.floor(produced * ratio) }
}

/**
 * 相邻样本取平均的降采样，结果是 int16 小端。
 * ⚠ 比率 ≤ 1 时原样量化、不插值：采样率低于 16 kHz 的麦克风几乎不存在，
 * 为它加一条插值路径只是多一处没人测的分支。
 * @param input 单声道 float32 样本
 * @param fromRate 输入采样率
 * @param toRate 目标采样率
 */
export function downsampleToInt16(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Int16Array<ArrayBuffer> {
  const { produced } = downsampleSpan(input.length, fromRate, toRate)
  const out = new Int16Array(produced)
  if (fromRate <= toRate) {
    for (let index = 0; index < produced; index += 1) {
      out[index] = toInt16(input[index] ?? 0)
    }
    return out
  }
  const ratio = fromRate / toRate
  for (let index = 0; index < produced; index += 1) {
    const start = Math.floor(index * ratio)
    const end = Math.max(start + 1, Math.floor((index + 1) * ratio))
    let sum = 0
    for (let at = start; at < end; at += 1) sum += input[at] ?? 0
    out[index] = toInt16(sum / (end - start))
  }
  return out
}

/** 一个渲染块降采样之后的产出与留给下一块的状态。 */
export interface DownsampleStep {
  samples: Int16Array<ArrayBuffer>
  /** 还没凑成整数个输出样本的输入尾巴。 */
  carry: Float32Array
  /** 下一个输出样本在 `carry` 里的小数起点，取值 [0, 1)。 */
  phase: number
}

/**
 * 把上一块的尾巴接上这一块再降采样，相位跨块连续。
 * ⚠ 小数相位必须带到下一块：只按整数样本切尾巴的话，每块都从 0 相位重算，
 * 44.1 kHz 下要么每块少出一个样本、要么每个输出覆盖得偏短，攒一秒就漂出百分之几。
 * @param previous 上一块留下的尾巴与相位
 * @param block 这一块的单声道 float32 样本
 * @param fromRate 输入采样率
 * @param toRate 目标采样率
 */
export function downsampleBlock(
  previous: Pick<DownsampleStep, 'carry' | 'phase'>,
  block: Float32Array,
  fromRate: number,
  toRate: number,
): DownsampleStep {
  const joined = new Float32Array(previous.carry.length + block.length)
  joined.set(previous.carry)
  joined.set(block, previous.carry.length)
  if (fromRate <= toRate) {
    const carry = new Float32Array(0)
    return {
      samples: downsampleToInt16(joined, fromRate, toRate),
      carry,
      phase: 0,
    }
  }
  const ratio = fromRate / toRate
  const phase = previous.phase
  const produced = Math.max(0, Math.floor((joined.length - phase) / ratio))
  const samples = new Int16Array(produced)
  for (let index = 0; index < produced; index += 1) {
    const start = Math.floor(phase + index * ratio)
    const end = Math.max(start + 1, Math.floor(phase + (index + 1) * ratio))
    let sum = 0
    for (let at = start; at < end; at += 1) sum += joined[at] ?? 0
    samples[index] = toInt16(sum / (end - start))
  }
  const next = phase + produced * ratio
  const consumed = Math.floor(next)
  return { samples, carry: joined.slice(consumed), phase: next - consumed }
}
