/**
 * @fileoverview 这条 WebSocket 该拿什么去握手：登录态的 access token，还是
 * 一枚公开令牌（ADR-0021）。
 *
 * ⚠ 两种凭据各有自己的**标记**，且服务端只认「标记之后的那一个」这种固定形状。
 * 试探式的鉴权（先当 token 试、不行再当票据试）会让一次形状变化静默地走进
 * 另一条路径。
 * ⚠ 公开票据是模块级状态：一个应用同一时刻只连一条，而那条连接的授权在握手
 * 那一刻就定死了。
 */

import {
  REALTIME_AUTH_SUBPROTOCOL,
  REALTIME_PUBLIC_SUBPROTOCOL,
} from '@dt/contracts'

/** 一次握手要报的两个子协议。 */
export interface RealtimeCredential {
  marker: string
  token: string
}

let ticket: string | null = null

/**
 * 改用一枚公开令牌握手；传 null 回到登录态那条路。
 * @param next 公开令牌
 * @returns 是否真的换了——换了就必须重连，授权在握手那一刻定死
 */
export function setPublicTicket(next: string | null): boolean {
  if (ticket === next) return false
  ticket = next
  return true
}

/**
 * 当前该拿什么去握手；一样都没有时给 null（此时**不该**建连接）。
 * @param accessToken 登录态的访问令牌，没登录给 null
 */
export function currentCredential(
  accessToken: string | null,
): RealtimeCredential | null {
  if (ticket !== null) {
    return { marker: REALTIME_PUBLIC_SUBPROTOCOL, token: ticket }
  }
  return accessToken === null
    ? null
    : { marker: REALTIME_AUTH_SUBPROTOCOL, token: accessToken }
}
