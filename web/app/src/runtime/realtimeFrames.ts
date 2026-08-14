/**
 * @fileoverview 把 hub 发来的一行 JSON 收窄成 `ServerFrame`，形状不对就丢。
 *
 * ⚠ 这里不许写 `as`：帧是外部数据，断言只是把校验挪到运行时的第一次解引用，
 * 而那时报的错与真实原因（hub 改了帧形状）隔得很远。
 */

import {
  SERVER_FRAME_TYPES,
  SERVER_SYSTEM_EVENTS,
  type ServerFrame,
  type ServerFrameType,
  type ServerSystemEvent,
} from '@dt/contracts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function frameTypeOf(value: unknown): ServerFrameType | null {
  const types: readonly string[] = SERVER_FRAME_TYPES
  return typeof value === 'string' && types.includes(value)
    ? (value as ServerFrameType)
    : null
}

function systemEventOf(value: unknown): ServerSystemEvent | null {
  const events: readonly string[] = SERVER_SYSTEM_EVENTS
  return typeof value === 'string' && events.includes(value)
    ? (value as ServerSystemEvent)
    : null
}

/** 载荷帧的必备字段都在且类型对。 */
function isPayloadFrame(frame: Record<string, unknown>): boolean {
  return (
    typeof frame['topic'] === 'string' &&
    typeof frame['ts'] === 'string' &&
    typeof frame['seq'] === 'number' &&
    'payload' in frame
  )
}

/** system 帧按 `event` 判别，逐档核它自己那几个字段。 */
function isSystemFrame(frame: Record<string, unknown>): boolean {
  const event = systemEventOf(frame['event'])
  if (event === 'connected') {
    return (
      typeof frame['connection_id'] === 'string' &&
      typeof frame['reauth_before'] === 'string'
    )
  }
  if (event === 'unsubscribed') {
    return (
      typeof frame['topic'] === 'string' && typeof frame['reason'] === 'string'
    )
  }
  return event === 'reauth_required'
}

function matchesType(frame: Record<string, unknown>, kind: ServerFrameType) {
  if (kind === 'data' || kind === 'event') return isPayloadFrame(frame)
  if (kind === 'system') return isSystemFrame(frame)
  if (kind === 'ack') {
    return (
      typeof frame['req_id'] === 'string' && typeof frame['action'] === 'string'
    )
  }
  return typeof frame['message'] === 'string'
}

/**
 * 解析一行帧；不是合法 JSON 对象、类型不认识、或该档的必备字段缺失都返回 null。
 *
 * Args: raw。
 */
export function parseServerFrame(raw: string): ServerFrame | null {
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    // ⚠ 静默丢弃：一条坏帧不该把整条连接带下去，后续帧仍然有效
    return null
  }
  if (!isRecord(decoded)) return null
  const kind = frameTypeOf(decoded['type'])
  if (kind === null) return null
  if (!matchesType(decoded, kind)) return null
  return decoded as unknown as ServerFrame
}
