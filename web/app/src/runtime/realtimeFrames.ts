/**
 * @fileoverview 把 hub 发来的一行 JSON 收窄成 `ServerFrame`，形状不对就丢。
 *
 * ⚠ 字段收窄不许写 `as`：帧是外部数据，断言只是把校验挪到运行时的第一次解引用，
 * 而那时报的错与真实原因（hub 改了帧形状）隔得很远。唯一一处断言在出口，
 * 它前面已逐档核过该类型的全部必备字段。
 */

import {
  SERVER_FRAME_TYPES,
  SERVER_SYSTEM_EVENTS,
  type ServerFrame,
  type ServerFrameType,
  type ServerSystemEvent,
} from '@dt/contracts'

/** 是普通对象（不是数组、不是 null）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function frameTypeOf(value: unknown): ServerFrameType | null {
  return SERVER_FRAME_TYPES.find((one) => one === value) ?? null
}

function systemEventOf(value: unknown): ServerSystemEvent | null {
  return SERVER_SYSTEM_EVENTS.find((one) => one === value) ?? null
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
  // 判别联合靠上面逐档核过的字段成立，TS 推不出这一步
  return decoded as unknown as ServerFrame
}
