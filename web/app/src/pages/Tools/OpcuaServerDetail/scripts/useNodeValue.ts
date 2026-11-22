/**
 * @fileoverview 节点当前值的**取值源**。页面只认这个接口，不认它背后是轮询
 * 还是推送。
 *
 * 选中时读初值，重连时补读。WebSocket 只推变化，断线期间的读数保留陈旧标记。
 *
 * ⚠ 三件事必须在这里做掉，散到页面里必然漏：
 * 1. **卸载时退订**——不退的话，切走的页面仍在收消息并更新已经不在的状态。
 * 2. **防竞态**——切节点会立刻触发第二次取值，慢的那次后返回会覆盖快的那次，
 *    界面显示上一个节点的值且没有任何报错。
 * 3. **只认当前节点的推送**——一个主题推的是整台实例的值，按标识过滤。
 */

import {
  computed,
  onBeforeUnmount,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue'
import type { OpcuaNodeValue } from '@dt/contracts'

import * as opcua from '@/api/opcua'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch, type RacedFetch } from '@/composables/useRacedFetch'
import { useRealtimeChannel } from '@/composables/useRealtimeChannel'

/** 一台实例一个主题，与 opcua-server 的 `topic_of` 同形。 */
export function topicOf(instanceId: string): string {
  return `opcua:${instanceId}`
}

export interface NodeValueSource {
  value: Ref<OpcuaNodeValue | null>
  error: Ref<string | null>
  loading: Ref<boolean>
  isStale: ComputedRef<boolean>
  /** 立刻读一次。推送断了或要强制对齐时用。 */
  refresh: () => Promise<void>
}

type NodeReadState = Pick<NodeValueSource, 'value' | 'error' | 'loading'> & {
  needsRefresh: Ref<boolean>
}

/**
 * 从一批推送里挑出某个节点的新值；这批里没有它就返回 `undefined`。
 * ⚠ 逐层窄化：载荷来自另一个服务，形状真变了的时候页面只会静默显示错值。
 */
function pickValue(
  payload: Record<string, unknown>,
  identifier: string,
): unknown {
  const items = payload['items']
  if (!Array.isArray(items)) return undefined
  for (const entry of items) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (record['identifier'] === identifier) return record['value']
  }
  return undefined
}

/**
 * 订阅一个节点的当前值。节点为 null 时不读也不订。
 * @param instanceId 实例 id
 * @param nodeId 选中的节点 id，可为 null
 * @param identifier 该节点的标识，推送按它过滤
 */
export function useNodeValue(
  instanceId: Ref<string>,
  nodeId: Ref<string | null>,
  identifier: Ref<string | null>,
): NodeValueSource {
  const value = ref<OpcuaNodeValue | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)
  const needsRefresh = ref(false)
  const channel = useRealtimeChannel()
  const raced = useRacedFetch()
  const isStale = computed(
    () =>
      value.value?.is_live === true &&
      (!channel.isConnected.value || needsRefresh.value),
  )

  const state = { value, error, loading, needsRefresh }
  const refresh = (): Promise<void> =>
    readSnapshot(instanceId.value, nodeId.value, state, raced)
  const stop = useLiveUpdates(channel, instanceId, identifier, value)

  watch(
    [instanceId, nodeId, identifier],
    () => {
      // 换节点：先清旧值再读新的，否则新节点还没回来时显示的是上一个节点的值
      value.value = null
      error.value = null
      void refresh()
      if (nodeId.value === null) stop.unsubscribe()
      else stop.resubscribe()
    },
    { immediate: true },
  )

  watch(channel.isConnected, (connected) => {
    needsRefresh.value = true
    if (connected) void refresh()
  })

  onBeforeUnmount(() => {
    raced.cancel()
    stop.unsubscribe()
  })

  return { value, error, loading, isStale, refresh }
}

/**
 * 读选中节点的快照，并保留请求期间更新的推送值。
 * @param instance 实例 id
 * @param target 选中的节点 id
 * @param state 当前读数与读取状态
 * @param raced 管理请求的竞态防护
 */
async function readSnapshot(
  instance: string,
  target: string | null,
  state: NodeReadState,
  raced: RacedFetch,
): Promise<void> {
  const { value, error, loading, needsRefresh } = state
  if (target === null) {
    raced.cancel()
    value.value = null
    error.value = null
    loading.value = false
    return
  }
  const previous = value.value
  loading.value = true
  await raced.run((signal) => opcua.readNodeValue(instance, target, signal), {
    ok: (result) => {
      const pushed = value.value
      value.value =
        pushed?.is_live === true && result.is_live && pushed !== previous
          ? { ...result, value: pushed.value }
          : result
      error.value = null
      needsRefresh.value = false
    },
    fail: (caught) => {
      error.value = describeError(caught)
      value.value = null
    },
    settled: () => (loading.value = false),
  })
}

/**
 * 把该实例主题的推送叠加到 `value` 上；订阅的生死由调用方驱动。
 * @param channel 实时通道
 * @param instanceId 实例 id
 * @param identifier 当前节点的标识
 * @param value 要更新的取值
 */
function useLiveUpdates(
  channel: ReturnType<typeof useRealtimeChannel>,
  instanceId: Ref<string>,
  identifier: Ref<string | null>,
  value: Ref<OpcuaNodeValue | null>,
): { resubscribe: () => void; unsubscribe: () => void } {
  let off: (() => void) | null = null

  function unsubscribe(): void {
    off?.()
    off = null
  }

  function resubscribe(): void {
    unsubscribe()
    const target = identifier.value
    if (target === null) return
    const instance = instanceId.value
    off = channel.subscribe(topicOf(instance), (payload) => {
      if (instanceId.value !== instance || identifier.value !== target) return
      const pushed = pickValue(payload, target)
      // ⚠ undefined 表示这批里没有这个节点，不是「值变成了 undefined」。
      // 不区分的话，别的节点一变化就会把当前显示的值抹掉。
      if (pushed === undefined) return
      const current = value.value
      // ⚠ 只在已经读到过初值时才叠加：没有初值就没有数据类型等字段，
      // 凭一条推送拼不出完整的 OpcuaNodeValue
      if (current === null) return
      value.value = { ...current, value: pushed }
    })
  }

  return { resubscribe, unsubscribe }
}
