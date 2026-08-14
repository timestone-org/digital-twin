/**
 * @fileoverview 契约：WS 信封的帧形状与 realtime-hub 实际发出的字典逐字一致
 * （`services/session.py` / `services/publisher.py` / `api/ws.py`）。
 * ⚠ 帧类型少一档，客户端会把它当未知帧丢掉——连接是通的、数据不再更新；
 * 把只有载荷帧才有的键标成每帧必有，会让 `frame.ts` 类型是 string、运行时是 undefined。
 */
import { describe, expect, it } from 'vitest'

import {
  CLIENT_ACTIONS,
  REALTIME_AUTH_EXPIRED_CLOSE_CODE,
  REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE,
  SERVER_FRAME_TYPES,
  SERVER_SYSTEM_EVENTS,
} from '../src/index'
import type {
  ClientAction,
  ClientMessage,
  ServerFrame,
  ServerFrameType,
  ServerSystemEvent,
} from '../src/index'

const SERVER_FRAME_TYPE_MEMBERS: Record<ServerFrameType, true> = {
  data: true,
  event: true,
  error: true,
  ack: true,
  system: true,
}
const CLIENT_ACTION_MEMBERS: Record<ClientAction, true> = {
  subscribe: true,
  unsubscribe: true,
  reauth: true,
}
const SYSTEM_EVENT_MEMBERS: Record<ServerSystemEvent, true> = {
  connected: true,
  unsubscribed: true,
  reauth_required: true,
}

const TOPIC = 'dashboard:0198c0f6-1c2f-7a10-9f3d-2c9b6b3a5e41'

describe('服务端帧的取值集合', () => {
  it('帧类型是这五档', () => {
    expect([...SERVER_FRAME_TYPES]).toEqual([
      'data',
      'event',
      'error',
      'ack',
      'system',
    ])
  })

  it('帧类型的类型成员与运行时常量对齐', () => {
    expect(Object.keys(SERVER_FRAME_TYPE_MEMBERS).sort()).toEqual(
      [...SERVER_FRAME_TYPES].sort(),
    )
  })

  it('system 帧的子类是这三档', () => {
    expect([...SERVER_SYSTEM_EVENTS]).toEqual([
      'connected',
      'unsubscribed',
      'reauth_required',
    ])
  })

  it('system 子类的类型成员与运行时常量对齐', () => {
    expect(Object.keys(SYSTEM_EVENT_MEMBERS).sort()).toEqual(
      [...SERVER_SYSTEM_EVENTS].sort(),
    )
  })
})

describe('hub 发出的帧', () => {
  it('data 帧带主题、时刻、seq、载荷与 trace_id', () => {
    const frame: ServerFrame<{ items: number[] }> = {
      type: 'data',
      topic: TOPIC,
      ts: '2026-08-14T09:30:00.000Z',
      seq: 128,
      payload: { items: [1, 2] },
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    }

    expect(Object.keys(frame).sort()).toEqual([
      'payload',
      'seq',
      'topic',
      'trace_id',
      'traceparent',
      'ts',
      'type',
    ])
    expect(frame.type === 'data' ? frame.seq : -1).toBe(128)
  })

  it('ack 帧只回带 req_id 与 action，没有 topic 也没有 seq', () => {
    const frame: ServerFrame = {
      type: 'ack',
      req_id: 'c1',
      action: 'subscribe',
    }

    expect(Object.keys(frame).sort()).toEqual(['action', 'req_id', 'type'])
    expect(frame.type === 'ack' ? frame.action : '').toBe('subscribe')
  })

  it('error 帧带错误码与文案，按码分支', () => {
    const frame: ServerFrame = {
      type: 'error',
      req_id: 'c1',
      code: 42007,
      message: '缺少 topic',
    }

    expect(frame.type === 'error' ? frame.code : 0).toBe(42007)
  })

  it('帧本身不是合法 JSON 对象时只有 type 与 message', () => {
    const frame: ServerFrame = {
      type: 'error',
      message: '消息不是合法的 JSON 对象',
    }

    expect(frame.type === 'error' ? frame.code : 'absent').toBeUndefined()
    expect(frame.type === 'error' ? frame.req_id : 'absent').toBeUndefined()
  })

  it('握手完成的 system 帧带连接 id 与该换票的时刻', () => {
    const frame: ServerFrame = {
      type: 'system',
      event: 'connected',
      connection_id: '0198c0f6-1c2f-7a10-9f3d-2c9b6b3a5e41',
      reauth_before: '2026-08-14T10:30:00+00:00',
    }

    expect(Object.keys(frame).sort()).toEqual([
      'connection_id',
      'event',
      'reauth_before',
      'type',
    ])
  })

  it('权限复核退订的 system 帧带主题与原因', () => {
    const frame: ServerFrame = {
      type: 'system',
      event: 'unsubscribed',
      topic: TOPIC,
      reason: 'permission_revoked',
    }

    expect(
      frame.type === 'system' && frame.event === 'unsubscribed'
        ? frame.topic
        : '',
    ).toBe(TOPIC)
  })

  it('催换票的 system 帧只有 type 与 event', () => {
    const frame: ServerFrame = { type: 'system', event: 'reauth_required' }

    expect(Object.keys(frame).sort()).toEqual(['event', 'type'])
  })

  it('system 帧只能按 event 判别，三档都要认得出来', () => {
    const frames: ServerFrame[] = [
      {
        type: 'system',
        event: 'connected',
        connection_id: 'c',
        reauth_before: '2026-08-14T10:30:00+00:00',
      },
      {
        type: 'system',
        event: 'unsubscribed',
        topic: TOPIC,
        reason: 'permission_revoked',
      },
      { type: 'system', event: 'reauth_required' },
    ]

    expect(
      frames.map((frame) => (frame.type === 'system' ? frame.event : '')),
    ).toEqual(['connected', 'unsubscribed', 'reauth_required'])
  })
})

describe('客户端消息', () => {
  it('动作是订阅、退订、重新鉴权三种', () => {
    expect([...CLIENT_ACTIONS]).toEqual(['subscribe', 'unsubscribe', 'reauth'])
  })

  it('动作的类型成员与运行时常量对齐', () => {
    expect(Object.keys(CLIENT_ACTION_MEMBERS).sort()).toEqual(
      [...CLIENT_ACTIONS].sort(),
    )
  })

  it('订阅带主题，重新鉴权带新令牌而不带主题', () => {
    const subscribe: ClientMessage = {
      action: 'subscribe',
      topic: TOPIC,
      req_id: 'c1',
    }
    const reauth: ClientMessage = {
      action: 'reauth',
      req_id: 'c2',
      token: 'new-access-token',
    }

    expect(subscribe.topic).toBe(TOPIC)
    expect(reauth.topic).toBeUndefined()
    expect(reauth.token).toBe('new-access-token')
  })
})

describe('关闭码', () => {
  it('令牌过期用 4001，握手被拒用 1008，两档处置不同', () => {
    expect(REALTIME_AUTH_EXPIRED_CLOSE_CODE).toBe(4001)
    expect(REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE).toBe(1008)
    expect(REALTIME_AUTH_EXPIRED_CLOSE_CODE).not.toBe(
      REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE,
    )
  })
})
