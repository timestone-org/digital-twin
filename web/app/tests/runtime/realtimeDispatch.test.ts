/** @fileoverview 帧分发：载荷必须是对象（不是数组）才交给订阅者。 */
import { describe, expect, it, vi } from 'vitest'

import { dispatchFrame } from '@/runtime/realtimeDispatch'
import { createTopicRegistry } from '@/runtime/topicRegistry'

function ports() {
  const topics = createTopicRegistry()
  const handler = vi.fn()
  topics.add('t1', handler)
  return {
    handler,
    ports: {
      topics,
      send: vi.fn(),
      token: () => null,
      newRequestId: () => 'r1',
    },
  }
}

function dataFrame(payload: unknown): string {
  return JSON.stringify({
    type: 'data',
    topic: 't1',
    ts: '2026-11-09T00:00:00Z',
    seq: 1,
    payload,
  })
}

describe('dispatchFrame', () => {
  it('对象载荷交给订阅者', () => {
    const { handler, ports: given } = ports()
    dispatchFrame(dataFrame({ a: 1 }), given)
    expect(handler).toHaveBeenCalledWith({ a: 1 })
  })

  it('数组载荷不当成对象分发', () => {
    const { handler, ports: given } = ports()
    dispatchFrame(dataFrame([1, 2]), given)
    expect(handler).not.toHaveBeenCalled()
  })
})
