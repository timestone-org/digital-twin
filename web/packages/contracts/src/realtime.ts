/**
 * @fileoverview realtime-hub 的 WebSocket 信封，逐字对应它实际发出的四种帧
 * （`services/session.py` 与 `services/publisher.py`）；主题命名空间开放、
 * 订阅授权由推送方登记时声明权限码（ADR-0007）。
 * ⚠ 字段名保留线上原名（`trace_id` / `req_id`），且**只有载荷帧带 `ts` / `trace_id`**：
 * 会话层那三种帧是就地拼的字典，把它们标成必有会让 `frame.ts` 类型是 string、
 * 运行时是 undefined。
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

/**
 * `system` 帧的子类。
 * ⚠ `system` 只能按 `event` 判别，不能按有没有 `topic`：`connected` 与
 * `reauth_required` 都没有 topic，混在一起就区分不出「连上了」和「该换票了」。
 */
export const SERVER_SYSTEM_EVENTS = [
  'connected',
  'unsubscribed',
  'reauth_required',
] as const
export type ServerSystemEvent = (typeof SERVER_SYSTEM_EVENTS)[number]

/** 客户端动作。 */
export const CLIENT_ACTIONS = ['subscribe', 'unsubscribe', 'reauth'] as const
export type ClientAction = (typeof CLIENT_ACTIONS)[number]

/**
 * token 过期未按时 reauth 时服务端的关闭码。
 * ⚠ 收到它要**换票再连**：这一档重连解决不了，拿同一张过期票重试只会再被关一次。
 */
export const REALTIME_AUTH_EXPIRED_CLOSE_CODE = 4001

/**
 * 握手就被拒时服务端的关闭码（`api/ws.py` 的 `CLOSE_UNAUTHENTICATED`）。
 * ⚠ 与 4001 的处置完全不同：这一档是「压根没给票 / 票验不过」，
 * 换票没用，要回到登录态；4001 才是「票过期了，换一张再来」。
 */
export const REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE = 1008

/**
 * 公开票据没有（或不再有）授权时服务端的关闭码（ADR-0021）。
 * ⚠ 与 1008 分开，且这一档**可重试**：撤回与「推送方还没把这枚新票据对账到
 * hub」在客户端看来一模一样，而后者只要等一轮对账。当成 1008 处理的话，
 * 刚发布出去的公开链接会在那几秒的窗口里被判成永久失败，此后一次也不再连。
 */
export const REALTIME_PUBLIC_GRANT_CLOSE_CODE = 4003

/**
 * 匿名连接名额用尽时服务端的关闭码（ADR-0021）。
 * ⚠ 它是拥挤不是拒绝：照常退避重连。
 */
export const REALTIME_QUOTA_CLOSE_CODE = 4029

/** 握手时报的第一个子协议：登录态。凭据是 access token。 */
export const REALTIME_AUTH_SUBPROTOCOL = 'dt.auth'

/**
 * 握手时报的第一个子协议：公开链接。凭据是公开令牌本身（ADR-0021）。
 * ⚠ 与上面分成两个标记而不是「先当 token 试、不行再当票据试」：试探式的鉴权
 * 会让一次形状变化静默地走进另一条路径。
 */
export const REALTIME_PUBLIC_SUBPROTOCOL = 'dt.public'

/**
 * 载荷帧：hub 的推送路径拼出来的那一种。
 * ⚠ 目前 hub 只发 `data`（`publisher.py` 的 `MESSAGE_TYPE_DATA`）；
 * `event` 是 api-contract §10 预留的同形状帧，客户端按同一条分支处理即可。
 */
export interface ServerPayloadFrame<TPayload = unknown> {
  type: 'data' | 'event'
  /**
   * 主题，形状 `<域>:<标识>`，大屏是 `dashboard:{dashboardId}`。
   * ⚠ hub 只把它当不透明键，订阅未登记的主题一律拒绝——放行的话，
   * 一个拼错名字的客户端会安静地永远收不到数据。
   */
  topic: string
  /** 发出时刻，UTC RFC3339。 */
  ts: string
  /**
   * 每个主题单调递增且跨重启不倒退。
   * ⚠ 客户端只能据它**发现**丢帧：hub 不在任何回执里回带当前 seq，
   * 所以重连后唯一的对齐手段是「收到的第一帧即新基准」，不许自己推断下一个值。
   */
  seq: number
  payload: TPayload
  trace_id: string
  /** W3C 链路上下文。⚠ 少了它，链路在异步推送这一处齐断。 */
  traceparent?: string
}

/**
 * 订阅类动作的回执。
 * ⚠ 只有 `req_id` 与原样回带的 `action`——**没有 topic、没有 seq**。
 * 一次 `subscribe` 成没成，只能靠 `req_id` 与自己发出去的那条对上。
 */
export interface ServerAckFrame {
  type: 'ack'
  /** 原样回带发起方的 `req_id`。 */
  req_id: string
  /** 原样回带发起方的 `action`。 */
  action: ClientAction
}

/** 错误帧。按 `code` 分支，不要按 `message` 分支——文案会改、会翻译。 */
export interface ServerErrorFrame {
  type: 'error'
  message: string
  /**
   * 与 HTTP 面同一套分段十进制错误码（api-contract §4.1）。
   * ⚠ 可缺：帧本身不是合法 JSON 对象时 hub 只回 `{type, message}`，
   * 那条路径连 `req_id` 都没有（`api/ws.py` 的 `_pump`）。
   */
  code?: number
  /** 由某条客户端消息触发时才有。 */
  req_id?: string
}

/** 握手完成：这条连接的身份与该换票的时刻。 */
export interface ServerConnectedFrame {
  type: 'system'
  event: 'connected'
  connection_id: string
  /** 该换票的时刻，UTC RFC3339。客户端据它排期，不必自己解 token。 */
  reauth_before: string
}

/**
 * 权限复核后某个主题被退订。
 * ⚠ 这是**服务端单方面**退的，客户端本地的订阅表要跟着删，
 * 否则重连时会再订一次同一个必然被拒的主题。
 */
export interface ServerUnsubscribedFrame {
  type: 'system'
  event: 'unsubscribed'
  topic: string
  /** 稳定字面量，例 `permission_revoked`。 */
  reason: string
}

/** 催换票：到期前 hub 会在每条消息之后带一帧。 */
export interface ServerReauthRequiredFrame {
  type: 'system'
  event: 'reauth_required'
}

export type ServerSystemFrame =
  ServerConnectedFrame | ServerUnsubscribedFrame | ServerReauthRequiredFrame

export type ServerFrame<TPayload = unknown> =
  | ServerPayloadFrame<TPayload>
  | ServerAckFrame
  | ServerErrorFrame
  | ServerSystemFrame

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
