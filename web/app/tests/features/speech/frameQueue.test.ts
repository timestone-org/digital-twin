/**
 * @fileoverview ready 之前攒帧的队列契约：按序取走、超上限丢最旧但至少留最新一帧。
 */
import { describe, expect, it } from 'vitest'

import { createFrameQueue } from '@/features/speech/frameQueue'

function pcm(bytes: number): ArrayBuffer {
  return new ArrayBuffer(bytes)
}

describe('帧队列', () => {
  it('取走时按进入的顺序，取完队列就空了', () => {
    const queue = createFrameQueue(100)
    queue.push(pcm(2))
    queue.push(pcm(4))

    const drained = queue.drain()

    expect(drained.map((one) => one.byteLength)).toEqual([2, 4])
    expect(queue.byteLength()).toBe(0)
    expect(queue.drain()).toEqual([])
  })

  it('超过上限从最旧的丢起', () => {
    const queue = createFrameQueue(10)
    queue.push(pcm(4))
    queue.push(pcm(4))
    queue.push(pcm(4))

    expect(queue.drain().map((one) => one.byteLength)).toEqual([4, 4])
  })

  it('单帧就超上限时也留着它：丢光了等于 ready 之后什么都送不出', () => {
    const queue = createFrameQueue(3)
    queue.push(pcm(8))

    expect(queue.byteLength()).toBe(8)
    expect(queue.drain()).toHaveLength(1)
  })

  it('清空之后字节数归零', () => {
    const queue = createFrameQueue(100)
    queue.push(pcm(6))
    queue.clear()

    expect(queue.byteLength()).toBe(0)
    expect(queue.drain()).toEqual([])
  })
})
