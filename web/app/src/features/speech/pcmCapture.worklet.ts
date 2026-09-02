/**
 * @fileoverview 跑在音频线程里的采集处理器：把每个渲染块降到 16 kHz int16，
 * 攒够一帧就整块交给主线程（`pcmCapture.ts`）。
 *
 * ⚠ 这里没有 window，也进不了 vitest（happy-dom 没有 AudioWorklet）：算法全在
 * `pcm.ts` 那几个纯函数里，这个文件只负责搬运。
 */
import { downsampleSpan, downsampleToInt16, PCM_CAPTURE_PROCESSOR } from './pcm'

interface ProcessorOptions {
  targetRate?: number
  frameBytes?: number
}

interface NodeOptions {
  processorOptions?: ProcessorOptions
}

// AudioWorkletGlobalScope 的三样东西；lib.dom 里没有它们的声明
declare const sampleRate: number
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: NodeOptions)
}
declare function registerProcessor(
  name: string,
  processor: new (options: NodeOptions) => AudioWorkletProcessor,
): void

const DEFAULT_TARGET_RATE = 16_000
const DEFAULT_FRAME_BYTES = 1920
const BYTES_PER_SAMPLE = 2

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly targetRate: number
  private readonly frameSamples: number
  /** 还没凑成整数个输出样本的输入尾巴。 */
  private carry: Float32Array = new Float32Array(0)
  private frame: Int16Array<ArrayBuffer>
  private filled = 0

  constructor(options: NodeOptions) {
    super(options)
    const given = options.processorOptions ?? {}
    this.targetRate = given.targetRate ?? DEFAULT_TARGET_RATE
    this.frameSamples =
      (given.frameBytes ?? DEFAULT_FRAME_BYTES) / BYTES_PER_SAMPLE
    this.frame = new Int16Array(this.frameSamples)
  }

  /** 每个渲染块（128 样本）来一次；返回 true 让节点一直活着。 */
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (channel === undefined || channel.length === 0) return true
    const joined = new Float32Array(this.carry.length + channel.length)
    joined.set(this.carry)
    joined.set(channel, this.carry.length)
    const { consumed } = downsampleSpan(
      joined.length,
      sampleRate,
      this.targetRate,
    )
    this.push(
      downsampleToInt16(
        joined.subarray(0, consumed),
        sampleRate,
        this.targetRate,
      ),
    )
    this.carry = joined.slice(consumed)
    return true
  }

  private push(samples: Int16Array): void {
    let offset = 0
    while (offset < samples.length) {
      const take = Math.min(
        this.frameSamples - this.filled,
        samples.length - offset,
      )
      this.frame.set(samples.subarray(offset, offset + take), this.filled)
      this.filled += take
      offset += take
      if (this.filled === this.frameSamples) this.flush()
    }
  }

  private flush(): void {
    const buffer = this.frame.buffer
    this.port.postMessage(buffer, [buffer])
    this.frame = new Int16Array(this.frameSamples)
    this.filled = 0
  }
}

registerProcessor(PCM_CAPTURE_PROCESSOR, PcmCaptureProcessor)
