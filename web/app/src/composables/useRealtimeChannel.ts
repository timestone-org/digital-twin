/**
 * @fileoverview realtime-hub 的 WebSocket 连接：一个应用一条，按主题分发。
 *
 * 模块级单例。一条连接承载全部主题——每个页面各开一条的话，切页面会反复
 * 握手，而握手要走一次验签；连接数也会随打开的面板数线性涨。
 *
 * ⚠ 凭据走**子协议**（标记 + 凭据两个值），不是 `Authorization` 头：
 * 浏览器的 WebSocket API 根本不允许自定义头。服务端回它收到的那个标记。
 * ⚠ 两种凭据、两个标记：登录态报 `dt.auth` + access token，公开链接报
 * `dt.public` + 公开令牌（ADR-0021）。公开面那条**必须显式接管**——它没有
 * 登录态，沿用登录态那条的话 `accessToken` 恒为 null，表现是「一条连接都不建、
 * 页面一直是静态快照」，而且没有任何报错。
 */

import {
  REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE,
  REALTIME_PUBLIC_GRANT_CLOSE_CODE,
  type ClientMessage,
  type ModuleConnectionState,
} from '@dt/contracts'
import { ref, type Ref } from 'vue'

import { newClientUuid } from '@/api/idempotency'
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
  /**
   * 服务端明确拒绝了这条连接：票据无效、已被撤回，或标记形状不对。
   * ⚠ 与「断了」分开：断了要等它自己回来，被拒了要去问一句「这张屏还公开吗」。
   */
  isRejected: Ref<boolean>
  subscribe: (topic: string, handler: TopicHandler) => () => void
}

const isRejected = ref(false)
const topics = createTopicRegistry()
const ports: DispatchPorts = {
  topics,
  send: (message) => send(message),
  // ⚠ 换票用的也是当前这条连接的凭据：公开连接换成 access token 等于在一条
  // 已建立的连接上换主体，服务端会拒，而客户端看不出来自己送错了东西
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
    connectionState.value = 'open'
    isRejected.value = false
    resetBackoff()
    resubscribeAll()
  })
  opened.addEventListener('message', (event: MessageEvent<string>) => {
    dispatchFrame(event.data, ports)
  })
  opened.addEventListener('close', (event: CloseEvent) => {
    socket = null
    // ⚠ 1008 是「票压根验不过」，换票没用：再重连也是拿同一张票被拒，
    // 那会退化成一个打满退避上限的空转循环。停下，等登录态那条路把票换掉；
    // 停下也要把态说出来，否则屏上一切照旧显示成活值
    if (event.code === REALTIME_HANDSHAKE_REJECTED_CLOSE_CODE) {
      isRejected.value = true
      connectionState.value = 'error'
      return
    }
    // ⚠ 4003 是「这枚公开票据没有授权」：要么链接被撤回了，要么推送方还没把
    // 它对账到 hub。后者只要等一轮对账，所以照常退避重连；同时把「被拒」说
    // 出来，页面据它去问一句「这张屏还公开吗」
    if (event.code === REALTIME_PUBLIC_GRANT_CLOSE_CODE) isRejected.value = true
    // ⚠ 4001 是「票过期了」：由 store 的刷新逻辑保证下次握手带的是新票，
    // 所以退避归零、立刻重连
    if (event.code === CLOSE_TOKEN_EXPIRED) resetBackoff()
    scheduleReconnect()
  })
}

/**
 * 订一个主题，返回退订函数。
 * ⚠ 调用方**必须**在卸载时调那个退订函数：不退的话，切走的页面仍会收到消息
 * 并更新已经不在的组件的状态。
 */
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

/** 关掉连接并停掉重连。登出与离开公开页时用。 */
export function closeRealtimeChannel(): void {
  isClosing = true
  if (reconnectTimer !== null) clearTimeout(reconnectTimer)
  reconnectTimer = null
  socket?.close()
  socket = null
  topics.clear()
  // ⚠ 票据也要清：不清的话回到登录态之后，下一次握手仍会报公开那条子协议，
  // 而那条连接看什么都被拒
  setPublicTicket(null)
  resetBackoff()
  connectionState.value = 'closed'
  isRejected.value = false
}

/** 取全局唯一的实时通道。 */
export function useRealtimeChannel(): Channel {
  isClosing = false
  connect()
  return { isConnected, connectionState, isRejected, subscribe }
}

/**
 * 取通道，并让它用一枚公开令牌握手（公开大屏页专用）。
 *
 * ⚠ 必须在页面 setup 的最前面调：`useRealtimeChannel()` 一被调用就去连，
 * 而连接用的凭据在那一刻就定死了。晚一步调，先建起来的是一条没有凭据、
 * 于是根本没建立的连接。
 * ⚠ 换票据要重连：一条连接的授权在握手那一刻定死，服务端不接受在连上之后
 * 换成另一枚票据。
 * @param ticket 公开令牌，就是地址里的那一段
 */
export function usePublicRealtimeChannel(ticket: string): Channel {
  if (setPublicTicket(ticket)) {
    socket?.close()
    socket = null
    resetBackoff()
    connectionState.value = 'closed'
    isRejected.value = false
  }
  // ⚠ 刻意**不**清主题登记表：换屏时退订旧主题是取数那一侧的事（它按屏重订），
  // 在这里清会与它的重订抢顺序——清在后面就把刚登记好的处理器一起抹掉了，
  // 表现是「跳过去那一屏永远没有值」，而且没有任何报错
  return useRealtimeChannel()
}
