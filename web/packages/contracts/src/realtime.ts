/**
 * @fileoverview realtime-hub 的 WebSocket 信封，逐字对应
 * docs/agents/api-contract.md §10；主题命名空间开放、订阅授权由推送方登记时
 * 声明权限码（ADR-0007）。⚠ 字段名保留线上原名（`trace_id` / `req_id`）。
 */

/** 服务端帧的类型。 */
export const SERVER_FRAME_TYPES = [
  'data',
  'event',
  'error',
  'ack',
  'system',
] as const
export type ServerFrameType = (typeof SERVER_FRAME_TYPES)[number]

/** 客户端动作。 */
export const CLIENT_ACTIONS = ['subscribe', 'unsubscribe', 'reauth'] as const
export type ClientAction = (typeof CLIENT_ACTIONS)[number]

/**
 * token 过期未按时 reauth 时服务端的关闭码。
 * ⚠ 客户端必须把它与网络断开分开处理：这一档要重新取 token，重连解决不了。
 */
export const REALTIME_AUTH_EXPIRED_CLOSE_CODE = 4001

/** 每一帧都有的头。 */
export interface ServerFrameHead {
  type: ServerFrameType
  /** 发出时刻，UTC RFC3339。 */
  ts: string
  trace_id: string
  /** W3C 链路上下文。⚠ 少了它，链路在异步推送这一处齐断。 */
  traceparent?: string
}

/**
 * 载荷帧。
 * `data` 是业务数据，`event` 是业务事件，`system` 是连接级通知
 * （要求 reauth、权限复核后撤销某个主题）。hub 从不解释 `payload`。
 */
export interface ServerPayloadFrame<TPayload = unknown>
  extends ServerFrameHead {
  type: 'data' | 'event' | 'system'
  /**
   * 主题，形状 `<域>:<标识>`，大屏是 `dashboard:{dashboardId}`。
   * ⚠ hub 只把它当不透明键，订阅未登记的主题一律拒绝——放行的话，
   * 一个拼错名字的客户端会安静地永远收不到数据。
   */
  topic: string
  /**
   * 每个主题单调递增且跨重启不倒退。
   * ⚠ 客户端只能据它**发现**丢帧，不许自己推断下一个值：主题重新登记、
   * 副本切换都由服务端在 ack 里重新告知当前值。
   */
  seq: number
  payload: TPayload
}

/** 订阅类动作的回执。 */
export interface ServerAckFrame extends ServerFrameHead {
  type: 'ack'
  topic: string
  /** 原样回带发起方的 `req_id`。 */
  req_id: string
  /** 该主题当前的 seq，重连后据它对齐。 */
  seq: number
}

/** 错误帧。按 `code` 分支，不要按 `message` 分支——文案会改、会翻译。 */
export interface ServerErrorFrame extends ServerFrameHead {
  type: 'error'
  /** 与 HTTP 面同一套分段十进制错误码（api-contract §4.1）。 */
  code: number
  message: string
  /** 与某个主题相关时才有；连接级错误没有。 */
  topic?: string
  /** 由某条客户端消息触发时才有。 */
  req_id?: string
}

export type ServerFrame<TPayload = unknown> =
  | ServerPayloadFrame<TPayload>
  | ServerAckFrame
  | ServerErrorFrame

/** 客户端发给 hub 的一条消息。 */
export interface ClientMessage {
  action: ClientAction
  /** `subscribe` / `unsubscribe` 必带；`reauth` 是整条连接的事，不带。 */
  topic?: string
  /** 本次请求的关联键，服务端在 `ack` / `error` 里原样回带。 */
  req_id: string
  /**
   * `reauth` 用的新 access token。
   * ⚠ WS 的鉴权路径与 HTTP 不同：token 走子协议与本字段，
   * HTTP 头上的鉴权中间件对它不生效。
   */
  token?: string
}
