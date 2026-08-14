/**
 * @fileoverview 收到一帧之后做什么：分发载荷、应答换票、跟随服务端退订。
 *
 * 依赖靠入参注入，与「socket 怎么连、怎么退避」彻底分开——那部分换成别的
 * 传输方式时，这里一行都不用改。
 */

import type { ClientMessage, ServerSystemFrame } from '@dt/contracts'

import { parseServerFrame } from '@/runtime/realtimeFrames'
import type { TopicRegistry } from '@/runtime/topicRegistry'

export interface DispatchPorts {
  topics: TopicRegistry
  send: (message: ClientMessage) => void
  /** 当前 access token；没有登录态时给 null。 */
  token: () => string | null
  newRequestId: () => string
}

/** system 帧只有两档需要动作，`connected` 是纯通知。 */
function handleSystem(frame: ServerSystemFrame, ports: DispatchPorts): void {
  if (frame.event === 'reauth_required') {
    const token = ports.token()
    if (token === null) return
    ports.send({ action: 'reauth', token, req_id: ports.newRequestId() })
    return
  }
  // ⚠ 服务端单方面退订后本地必须跟着删：不删的话下一次重连会把它重订一遍，
  // 而它必然再被拒——每次重连都多一条注定失败的往返，本地还以为自己订着
  if (frame.event === 'unsubscribed') ports.topics.forget(frame.topic)
}

/**
 * 处理一行原始帧。形状不对、载荷不是对象、或该档无人消费时静默返回。
 *
 * Args: raw, ports。
 */
export function dispatchFrame(raw: string, ports: DispatchPorts): void {
  const frame = parseServerFrame(raw)
  if (frame === null) return
  if (frame.type === 'system') return handleSystem(frame, ports)
  // ack 与 error 目前无人消费：本仓只有「订阅一个已登记主题」这一条路径，
  // 失败的表现就是收不到数据，与 error 帧携带的信息重合
  if (frame.type !== 'data' && frame.type !== 'event') return
  const payload = frame.payload
  if (typeof payload !== 'object' || payload === null) return
  for (const handler of ports.topics.listeners(frame.topic)) {
    handler(payload as Record<string, unknown>)
  }
}
