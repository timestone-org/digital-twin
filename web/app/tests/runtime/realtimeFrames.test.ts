/**
 * @fileoverview 帧解析的收窄契约：认得出四档、缺字段一律丢。
 *
 * 守的是「帧来自另一个服务」这条——hub 改了形状时要在解析处就停下，
 * 而不是让一个缺字段的帧流进分发、在第一次解引用时才炸。
 */
import { describe, expect, it } from 'vitest'

import { parseServerFrame } from '@/runtime/realtimeFrames'

const PAYLOAD = {
  type: 'data',
  topic: 'dashboard:d1',
  ts: '2026-08-14T09:30:00.000Z',
  seq: 7,
  payload: { items: [] },
  trace_id: '0af7651916cd43dd8448eb211c80319c',
}

/** 去掉载荷帧的某一个键，用来验证「缺了就不认」。 */
function without(key: keyof typeof PAYLOAD): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...PAYLOAD }
  delete copy[key]
  return copy
}

describe('帧解析', () => {
  it('载荷帧带齐 topic/ts/seq/payload 才认', () => {
    const frame = parseServerFrame(JSON.stringify(PAYLOAD))
    expect(frame?.type).toBe('data')
  })

  it('⚠ 缺 seq 的载荷帧不认——hub 一定会发它，缺了就是形状漂了', () => {
    expect(parseServerFrame(JSON.stringify(without('seq')))).toBeNull()
  })

  it('缺 ts 的载荷帧不认', () => {
    expect(parseServerFrame(JSON.stringify(without('ts')))).toBeNull()
  })

  it('event 帧与 data 帧同形，一并认', () => {
    const frame = parseServerFrame(JSON.stringify({ ...PAYLOAD, type: 'event' }))
    expect(frame?.type).toBe('event')
  })

  it('ack 帧要有 req_id 与 action', () => {
    const raw = JSON.stringify({ type: 'ack', req_id: 'c1', action: 'subscribe' })
    expect(parseServerFrame(raw)?.type).toBe('ack')
  })

  it('⚠ error 帧只有 message 也认——帧不是合法 JSON 时 hub 就只回这两个键', () => {
    const frame = parseServerFrame(JSON.stringify({ type: 'error', message: '坏了' }))
    expect(frame?.type).toBe('error')
  })

  it('三档 system 事件都认得出', () => {
    const connected = parseServerFrame(
      JSON.stringify({
        type: 'system',
        event: 'connected',
        connection_id: 'c-1',
        reauth_before: '2026-08-14T10:00:00.000Z',
      }),
    )
    const unsubscribed = parseServerFrame(
      JSON.stringify({
        type: 'system',
        event: 'unsubscribed',
        topic: 'dashboard:d1',
        reason: 'permission_revoked',
      }),
    )
    const reauth = parseServerFrame(
      JSON.stringify({ type: 'system', event: 'reauth_required' }),
    )
    expect(connected?.type).toBe('system')
    expect(unsubscribed?.type).toBe('system')
    expect(reauth?.type).toBe('system')
  })

  it('不认识的 system 事件丢掉', () => {
    const raw = JSON.stringify({ type: 'system', event: 'something_new' })
    expect(parseServerFrame(raw)).toBeNull()
  })

  it('unsubscribed 缺 topic 就丢——没有 topic 的它无处可用', () => {
    const raw = JSON.stringify({
      type: 'system',
      event: 'unsubscribed',
      reason: 'permission_revoked',
    })
    expect(parseServerFrame(raw)).toBeNull()
  })

  it('不认识的帧类型丢掉', () => {
    expect(parseServerFrame(JSON.stringify({ type: 'heartbeat' }))).toBeNull()
  })

  it('坏 JSON、数组与 null 都丢掉，不抛', () => {
    expect(parseServerFrame('{ 不是 json')).toBeNull()
    expect(parseServerFrame('[]')).toBeNull()
    expect(parseServerFrame('null')).toBeNull()
    expect(parseServerFrame('"just a string"')).toBeNull()
  })
})
