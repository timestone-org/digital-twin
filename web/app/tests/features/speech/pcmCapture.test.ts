/**
 * @fileoverview 采集里能在 happy-dom 下验的两样：降采样纯函数的数学，与
 * 「不安全上下文 / 没有 mediaDevices」那两句能定位问题的错误。
 * AudioWorklet 与 getUserMedia 本身 happy-dom 没有，那条路只能在浏览器里跑。
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  downsampleSpan,
  downsampleToInt16,
  microphoneBlocker,
  startPcmCapture,
} from '@/features/speech/pcmCapture'

const INT16_MAX = 32767
const INT16_MIN = -32768

describe('downsampleToInt16', () => {
  it('48k → 16k：每三个相邻样本取平均', () => {
    const input = new Float32Array([0, 0.3, 0.6, 1, 1, 1])

    const out = downsampleToInt16(input, 48_000, 16_000)

    expect(Array.from(out)).toEqual([Math.round(0.3 * INT16_MAX), INT16_MAX])
  })

  it('44.1k → 16k：产出数按比率下取整，吃剩的尾巴不到一个输出样本', () => {
    const ratio = 44_100 / 16_000
    const span = downsampleSpan(128, 44_100, 16_000)

    expect(span.produced).toBe(Math.floor(128 / ratio))
    expect(span.consumed).toBeLessThanOrEqual(128)
    expect(128 - span.consumed).toBeLessThan(ratio)
    expect(
      downsampleToInt16(new Float32Array(128), 44_100, 16_000),
    ).toHaveLength(span.produced)
  })

  it('越界的样本夹到 int16 两端，不回绕', () => {
    const out = downsampleToInt16(new Float32Array([2, -2]), 16_000, 16_000)

    expect(Array.from(out)).toEqual([INT16_MAX, INT16_MIN])
  })

  it('比率 ≤ 1 时原样量化，不插值', () => {
    const out = downsampleToInt16(new Float32Array([0.5, -0.5]), 8_000, 16_000)

    expect(Array.from(out)).toEqual([16384, -16384])
    expect(downsampleSpan(2, 8_000, 16_000)).toEqual({
      produced: 2,
      consumed: 2,
    })
  })

  it('空输入给空输出', () => {
    expect(downsampleToInt16(new Float32Array(0), 48_000, 16_000)).toHaveLength(
      0,
    )
  })
})

describe('开不了麦的原因', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'isSecureContext')
  })

  it('http 页面说清是安全上下文的事，并带上当前协议', async () => {
    Object.defineProperty(window, 'isSecureContext', {
      value: false,
      configurable: true,
    })

    expect(microphoneBlocker()).toContain('HTTPS 或 localhost')
    expect(microphoneBlocker()).toContain('http://')
    await expect(startPcmCapture(() => undefined)).rejects.toThrow(
      'HTTPS 或 localhost',
    )
  })

  it('安全上下文里没有 mediaDevices 时说浏览器不支持，而不是无声失败', () => {
    Object.defineProperty(window, 'isSecureContext', {
      value: true,
      configurable: true,
    })

    // happy-dom 没有 navigator.mediaDevices，正好就是这条路
    expect(microphoneBlocker()).toBe('这个浏览器不支持麦克风采集')
  })
})
