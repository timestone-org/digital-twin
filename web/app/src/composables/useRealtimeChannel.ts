/**
 * @fileoverview realtime-hub 的 WebSocket 连接：一个应用一条，按主题分发。
 *
 * 模块级单例。一条连接承载全部主题——每个页面各开一条的话，切页面会反复
 * 握手，而握手要走一次验签；连接数也会随打开的面板数线性涨。
 *
 * ⚠ token 走**子协议**（`dt.auth` + token 两个值），不是 `Authorization` 头：
 * 浏览器的 WebSocket API 根本不允许自定义头。服务端只回 `dt.auth`。
 */

import {
  REALTIME_AUTH_EXPIRED_CLOSE_CODE,
  REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE,
  type ClientMessage,
} from '@dt/contracts'
import { ref, type Ref } from 'vue'

import { newClientUuid } from '@/api/idempotency'
import { dispatchFrame } from '@/runtime/realtimeDispatch'
import { createTopicRegistry, type TopicHandler } from '@/runtime/topicRegistry'
import type { DispatchPorts } from '@/runtime/realtimeDispatch'
import { useAuthStore } from '@/stores/auth'

/** hub 的对外前缀，与 server/services/realtime-hub 的 API_PREFIX 同值。 */
export const REALTIME_WS_PATH = '/api/v1/realtime/ws'
/** 握手要报的第一个子协议，服务端回它。 */
export const AUTH_SUBPROTOCOL = 'dt.auth'
/**
 * 令牌过期时服务端用的关闭码。收到它要换票重连，而不是当成网络故障。
 * ⚠ 取自 `@dt/contracts` 而不是就地再写一个 4001：两份同值常量一定会漂，
 * 而漂开之后「换票重连」这条路径会安静地退化成普通重连。
 */
export const CLOSE_TOKEN_EXPIRED = REALTIME_AUTH_EXPIRED_CLOSE_CODE
/** 重连退避的起点与上限。⚠ 不退避的话，hub 一挂全站客户端会一起打它。 */
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000

interface Channel {
  isConnected: Ref<boolean>
  subscribe: (topic: string, handler: TopicHandler) => () => void
}

const isConnected = ref(false)
const topics = createTopicRegistry()
const ports: DispatchPorts = {
  topics,
  send: (message) => send(message),
  token: () => useAuthStore().accessToken,
  newRequestId: newClientUuid,
}
let socket: WebSocket | null = null
let reconnectMs = RECONNECT_MIN_MS
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let isClosing = false

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
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, reconnectMs)
  // 指数退避，夹在上限内
  reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS)
}

function connect(): void {
  const token = useAuthStore().accessToken
  if (token === null || socket !== null) return
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${scheme}//${window.location.host}${REALTIME_WS_PATH}`
  // ⚠ 两个子协议一起报：服务端只认「dt.auth 之后的那一个」这种固定形状
  const opened = new WebSocket(url, [AUTH_SUBPROTOCOL, token])
  socket = opened

  opened.addEventListener('open', () => {
    isConnected.value = true
    reconnectMs = RECONNECT_MIN_MS
    resubscribeAll()
  })
  opened.addEventListener('message', (event: MessageEvent<string>) => {
    dispatchFrame(event.data, ports)
  })
  opened.addEventListener('close', (event: CloseEvent) => {
    socket = null
    isConnected.value = false
    // ⚠ 1008 是「票压根验不过」，换票没用：再重连也是拿同一张票被拒，
    // 那会退化成一个打满退避上限的空转循环。停下，等登录态那条路把票换掉
    if (event.code === REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE) return
    // ⚠ 4001 是「票过期了」：由 store 的刷新逻辑保证下次握手带的是新票，
    // 所以退避归零、立刻重连
    if (event.code === CLOSE_TOKEN_EXPIRED) reconnectMs = RECONNECT_MIN_MS
    scheduleReconnect()
  })
}

/** 关掉连接并停掉重连。登出时用。 */
export function closeRealtimeChannel(): void {
  isClosing = true
  if (reconnectTimer !== null) clearTimeout(reconnectTimer)
  reconnectTimer = null
  socket?.close()
  socket = null
  topics.clear()
  // ⚠ 退避也要归零：不归零的话，登出前攒到的退避值会被下一次登录继承——
  // 表现是「重新登录后要等半分钟才有实时数据」，而那与网络无关
  reconnectMs = RECONNECT_MIN_MS
  isConnected.value = false
}

/**
 * 取全局唯一的实时通道。
 *
 * ⚠ `subscribe` 返回退订函数，调用方**必须**在卸载时调它：不退的话，切走的
 * 页面仍会收到消息并更新已经不在的组件的状态。
 */
export function useRealtimeChannel(): Channel {
  isClosing = false
  connect()

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

  return { isConnected, subscribe }
}
