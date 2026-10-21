/** @fileoverview 共用的 WebSocket 连接、主题订阅与凭据生命周期，见 ADR-0014、0049。 */

import {
  REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE,
  REALTIME_PUBLIC_GRANT_CLOSE_CODE,
  type ClientMessage,
  type ModuleConnectionState,
} from '@dt/contracts'
import { ref, type Ref } from 'vue'

import { newClientUuid } from '@/api/idempotency'
import { clearPointSnapshots, resetPointSnapshots } from '@/runtime/pointStream'
import {
  CLOSE_TOKEN_EXPIRED,
  REALTIME_WS_PATH,
  connectionState,
  isConnected,
  markConnecting,
  nextBackoffMs,
  resetBackoff,
} from '@/runtime/realtimeConnection'
import {
  currentCredential,
  setPublicTicket,
} from '@/runtime/realtimeCredential'
import { dispatchFrame } from '@/runtime/realtimeDispatch'
import { createTopicRegistry, type TopicHandler } from '@/runtime/topicRegistry'
import type { DispatchPorts } from '@/runtime/realtimeDispatch'
import { useAuthStore } from '@/stores/auth'

interface Channel {
  isConnected: Ref<boolean>
  /** 连接态；模块的「数据可能过期」由它推，判定只此一份。 */
  connectionState: Ref<ModuleConnectionState>
  /** 服务端明确拒绝连接，公开页据此重新检查发布状态。 */
  isRejected: Ref<boolean>
  subscribe: (topic: string, handler: TopicHandler) => () => void
  requestSnapshot: (topic: string) => void
}

const isRejected = ref(false)
const topics = createTopicRegistry()
const ports: DispatchPorts = {
  topics,
  send: (message) => send(message),
  // ⚠ 公开连接换票不能改用登录态凭据，否则服务端会拒绝主体切换。
  token: () => credential()?.token ?? null,
  newRequestId: newClientUuid,
}
let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let isClosing = false

/** 当前该拿什么去握手；没有任何凭据时给 null。 */
function credential() {
  return currentCredential(useAuthStore().accessToken)
}

/** 往服务端发一条动作。连接没就绪时丢弃——重连后会重订。 */
function send(message: ClientMessage): void {
  if (socket?.readyState !== WebSocket.OPEN) return
  socket.send(JSON.stringify(message))
}

/** 把当前登记的全部主题重订一遍。重连后必须做，否则连上了却收不到数据。 */
function resubscribeAll(): void {
  for (const topic of topics.topics()) {
    send({ action: 'subscribe', topic, req_id: newClientUuid() })
  }
}

function scheduleReconnect(): void {
  if (isClosing || reconnectTimer !== null) return
  connectionState.value = 'reconnecting'
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, nextBackoffMs())
}

function connect(): void {
  const offered = credential()
  if (offered === null || socket !== null) return
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${scheme}//${window.location.host}${REALTIME_WS_PATH}`
  // ⚠ 两个子协议一起报：服务端只认「标记之后的那一个」这种固定形状
  const opened = new WebSocket(url, [offered.marker, offered.token])
  socket = opened
  markConnecting()

  opened.addEventListener('open', () => {
    if (socket !== opened) return
    connectionState.value = 'open'
    isRejected.value = false
    resetBackoff()
    resubscribeAll()
  })
  opened.addEventListener('message', (event: MessageEvent<string>) => {
    if (socket !== opened) return
    dispatchFrame(event.data, ports)
  })
  opened.addEventListener('close', (event: CloseEvent) => {
    if (socket !== opened) return
    socket = null
    clearPointSnapshots(subscribe)
    // ⚠ 握手被拒后必须停止重连并报告错误，不能让旧值仍显示为实时。
    if (event.code === REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE) {
      isRejected.value = true
      connectionState.value = 'error'
      return
    }
    // ⚠ 公开授权尚未对账也会报 4003，须保留退避重连并检查发布状态。
    if (event.code === REALTIME_PUBLIC_GRANT_CLOSE_CODE) isRejected.value = true
    // ⚠ 票过期时刷新归 store，通道只重置退避并用新票重连。
    if (event.code === CLOSE_TOKEN_EXPIRED) resetBackoff()
    scheduleReconnect()
  })
}

/** 订一个主题；调用方卸载时须调用返回的退订函数。 */
function subscribe(topic: string, handler: TopicHandler): () => void {
  if (topics.add(topic, handler)) {
    send({ action: 'subscribe', topic, req_id: newClientUuid() })
  }
  return () => {
    if (topics.remove(topic, handler)) {
      send({ action: 'unsubscribe', topic, req_id: newClientUuid() })
    }
  }
}

/** 更新订阅身份，让发布器为当前观看者补发全量。 */
function requestSnapshot(topic: string): void {
  if (
    socket?.readyState !== WebSocket.OPEN ||
    topics.listeners(topic).length === 0
  )
    return
  send({ action: 'unsubscribe', topic, req_id: newClientUuid() })
  send({ action: 'subscribe', topic, req_id: newClientUuid() })
}

/** 关掉连接并停掉重连。登出与离开公开页时用。 */
export function closeRealtimeChannel(): void {
  isClosing = true
  if (reconnectTimer !== null) clearTimeout(reconnectTimer)
  reconnectTimer = null
  socket?.close()
  socket = null
  topics.clear()
  resetPointSnapshots(subscribe)
  // ⚠ 残留公开票据会让回到登录态后的握手仍使用公开子协议。
  setPublicTicket(null)
  resetBackoff()
  connectionState.value = 'closed'
  isRejected.value = false
}

/** 取全局唯一的实时通道。 */
export function useRealtimeChannel(): Channel {
  isClosing = false
  connect()
  return {
    isConnected,
    connectionState,
    isRejected,
    subscribe,
    requestSnapshot,
  }
}

/**
 * 使用公开票据建立通道，须在页面 setup 的其它取通道操作之前调用。
 * @param ticket 公开令牌
 */
export function usePublicRealtimeChannel(ticket: string): Channel {
  if (setPublicTicket(ticket)) {
    clearPointSnapshots(subscribe)
    socket?.close()
    socket = null
    resetBackoff()
    connectionState.value = 'closed'
    isRejected.value = false
  }
  // ⚠ 换屏由取数层重订，清主题表会误删它刚登记的处理器。
  return useRealtimeChannel()
}
