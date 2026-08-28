/**
 * @fileoverview 那条实时连接的连线常量、重连节奏与**连接态**。
 *
 * ⚠ 连接态全仓只有这一份判定，别在别处再判一次 `readyState`：两份判定一定会漂，
 * 而漂开之后「屏上标没标数据可能过期」与「通道到底通不通」会各说各的
 * （docs/agents/runtime-resilience.md「返回陈旧数据必须标注为陈旧」）。
 */
import {
  REALTIME_AUTH_EXPIRED_CLOSE_CODE,
  type ModuleConnectionState,
} from '@dt/contracts'
import { computed, ref, type ComputedRef, type Ref } from 'vue'

/** hub 的对外前缀，与 server/services/realtime-hub 的 API_PREFIX 同值。 */
export const REALTIME_WS_PATH = '/api/v1/realtime/ws'

/**
 * 令牌过期时服务端用的关闭码。收到它要换票重连，而不是当成网络故障。
 * ⚠ 取自 `@dt/contracts` 而不是就地再写一个 4001：两份同值常量一定会漂，
 * 而漂开之后「换票重连」这条路径会安静地退化成普通重连。
 */
export const CLOSE_TOKEN_EXPIRED = REALTIME_AUTH_EXPIRED_CLOSE_CODE

/** 重连退避的起点与上限。⚠ 不退避的话，hub 一挂全站客户端会一起打它。 */
const RECONNECT_MIN_MS = 1_000
const RECONNECT_MAX_MS = 30_000

let reconnectMs = RECONNECT_MIN_MS

/**
 * 通道此刻的连接态。没有凭据、还没连过、主动关掉都是 `closed`。
 * ⚠ 这是 `ModuleMeta.connectionState` 的真源，模块的「数据可能过期」由它推。
 */
export const connectionState: Ref<ModuleConnectionState> = ref('closed')

/** 只有 `open` 算连上：握手期与重连期屏上挂的都是最后已知值。 */
export const isConnected: ComputedRef<boolean> = computed(
  () => connectionState.value === 'open',
)

/**
 * 记一次握手开始。
 * ⚠ 重连期间保持 `reconnecting` 不退回 `connecting`：「还没连上过」与
 * 「连上过、掉了、正在回来」在界面上的说法不一样。
 */
export function markConnecting(): void {
  if (connectionState.value === 'reconnecting') return
  connectionState.value = 'connecting'
}

/** 取这一次该等多久，并把退避翻倍夹在上限内。 */
export function nextBackoffMs(): number {
  const current = reconnectMs
  reconnectMs = Math.min(current * 2, RECONNECT_MAX_MS)
  return current
}

/**
 * 退避归零。
 * ⚠ 不归零的话，攒到的退避值会被下一次握手继承——表现是「重新登录后要等半分钟
 * 才有实时数据」，而那与网络无关。
 */
export function resetBackoff(): void {
  reconnectMs = RECONNECT_MIN_MS
}
