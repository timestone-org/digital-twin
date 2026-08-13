/**
 * @fileoverview 契约：WS 信封的帧类型、动作集合与按 `type` 判别的窄化。
 * ⚠ 帧类型少一档，客户端就会把它当未知帧丢掉——连接是通的、数据不再更新。
 */
import { describe, expect, it } from 'vitest'

import {
  CLIENT_ACTIONS,
  REALTIME_AUTH_EXPIRED_CLOSE_CODE,
  SERVER_FRAME_TYPES,
} from '../src/index'
import type { ClientAction, ClientMessage, ServerFrame } from '../src/index'

const CLIENT_ACTION_MEMBERS: Record<ClientAction, true> = {
  subscribe: true,
  unsubscribe: true,
  reauth: true,
}

describe('服务端帧', () => {
  it('帧类型是这五档', () => {
    expect([...SERVER_FRAME_TYPES]).toEqual([
      'data',
      'event',
      'error',
      'ack',
      'system',
    ])
  })

  it('data 帧按 type 判别后拿得到主题与 seq', () => {
    const frame: ServerFrame<{ items: number[] }> = {
      type: 'data',
      topic: 'dashboard:0198c0f6-1c2f-7a10-9f3d-2c9b6b3a5e41',
      ts: '2026-08-14T09:30:00.000Z',
      seq: 128,
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      payload: { items: [1, 2] },
    }
    expect(frame.type === 'data' ? frame.seq : -1).toBe(128)
    expect(frame.type === 'data' ? frame.topic : '').toBe(
      'dashboard:0198c0f6-1c2f-7a10-9f3d-2c9b6b3a5e41',
    )
  })

  it('error 帧带错误码与文案，按码分支', () => {
    const frame: ServerFrame = {
      type: 'error',
      ts: '2026-08-14T09:30:01.000Z',
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      code: 40106,
      message: '缺少 dashboard:view',
      req_id: 'c1',
    }
    expect(frame.type === 'error' ? frame.code : 0).toBe(40106)
  })

  it('ack 帧回带 req_id 与该主题当前的 seq', () => {
    const frame: ServerFrame = {
      type: 'ack',
      topic: 'dashboard:0198c0f6-1c2f-7a10-9f3d-2c9b6b3a5e41',
      ts: '2026-08-14T09:30:00.500Z',
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      req_id: 'c1',
      seq: 127,
    }
    expect(frame.type === 'ack' ? frame.req_id : '').toBe('c1')
    expect(frame.type === 'ack' ? frame.seq : -1).toBe(127)
  })
})

describe('客户端消息', () => {
  it('动作是订阅、退订、重新鉴权三种', () => {
    expect([...CLIENT_ACTIONS]).toEqual([
      'subscribe',
      'unsubscribe',
      'reauth',
    ])
  })

  it('动作的类型成员与运行时常量对齐', () => {
    expect(Object.keys(CLIENT_ACTION_MEMBERS).sort()).toEqual(
      [...CLIENT_ACTIONS].sort(),
    )
  })

  it('订阅带主题，重新鉴权带新令牌而不带主题', () => {
    const subscribe: ClientMessage = {
      action: 'subscribe',
      topic: 'dashboard:0198c0f6-1c2f-7a10-9f3d-2c9b6b3a5e41',
      req_id: 'c1',
    }
    const reauth: ClientMessage = {
      action: 'reauth',
      req_id: 'c2',
      token: 'new-access-token',
    }
    expect(subscribe.topic).toBe(
      'dashboard:0198c0f6-1c2f-7a10-9f3d-2c9b6b3a5e41',
    )
    expect(reauth.topic).toBeUndefined()
    expect(reauth.token).toBe('new-access-token')
  })
})

describe('关闭码', () => {
  it('令牌过期用 4001，与网络断开分开处理', () => {
    expect(REALTIME_AUTH_EXPIRED_CLOSE_CODE).toBe(4001)
  })
})
