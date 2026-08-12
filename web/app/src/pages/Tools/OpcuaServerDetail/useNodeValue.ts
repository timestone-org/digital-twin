/**
 * @fileoverview 节点当前值的**取值源**。页面只认这个接口，不认它背后是轮询还是推送。
 *
 * 现在是轮询：realtime-hub 还没建（issue #5 的 PR-5），PR-7 会把实现换成
 * WebSocket 订阅。换实现时页面一行不用改——这正是把定时器收在这里的理由，
 * 页面自己管 `setInterval` 的话，换推送要改的地方会散在每个用到值的组件里。
 *
 * ⚠ 两件事必须在这里做掉，散到页面里必然漏：
 * 1. **卸载清理定时器**——大屏一开几天，漏一个就持续累积。
 * 2. **防竞态**——切节点会立刻触发第二次取值，慢的那次后返回会覆盖快的那次，
 *    界面显示上一个节点的值且没有任何报错。
 */

import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { OpcuaNodeValue } from '@dt/contracts'

import * as opcua from '@/api/opcua'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'

/** 轮询间隔。比合并窗口（服务端默认 1s）稍慢，避免空转。 */
export const NODE_VALUE_POLL_MS = 2000

/** 一个可反复起停的定时器。抽出来是为了让调用处只剩「什么时候起停」。 */
function makeTicker(
  tick: () => void,
  intervalMs: number,
): { start: () => void; stop: () => void } {
  let timer: ReturnType<typeof setInterval> | null = null
  const stop = (): void => {
    if (timer !== null) clearInterval(timer)
    timer = null
  }
  return {
    stop,
    start: () => {
      stop()
      timer = setInterval(tick, intervalMs)
    },
  }
}

export interface NodeValueSource {
  value: Ref<OpcuaNodeValue | null>
  error: Ref<string | null>
  loading: Ref<boolean>
  /** 立刻取一次，不等下一个轮询周期。 */
  refresh: () => Promise<void>
}

/**
 * 订阅一个节点的当前值。节点为 null 时不发请求也不起定时器。
 * @param instanceId 实例 id
 * @param nodeId 当前选中的节点 id，可为 null
 * @param intervalMs 轮询间隔
 */
export function useNodeValue(
  instanceId: Ref<string>,
  nodeId: Ref<string | null>,
  intervalMs: number = NODE_VALUE_POLL_MS,
): NodeValueSource {
  const value = ref<OpcuaNodeValue | null>(null)
  const error = ref<string | null>(null)
  const loading = ref(false)
  const raced = useRacedFetch()

  async function refresh(): Promise<void> {
    const target = nodeId.value
    if (target === null) {
      value.value = null
      error.value = null
      return
    }
    loading.value = true
    await raced.run(() => opcua.readNodeValue(instanceId.value, target), {
      ok: (result) => {
        value.value = result
        error.value = null
      },
      fail: (caught) => {
        error.value = describeError(caught)
        value.value = null
      },
      settled: () => (loading.value = false),
    })
  }

  const ticker = makeTicker(() => void refresh(), intervalMs)

  // 换节点：先把旧值清掉再取新的，否则新节点还没回来时显示的是上一个节点的值
  watch(
    nodeId,
    () => {
      value.value = null
      error.value = null
      void refresh()
      if (nodeId.value === null) ticker.stop()
      else ticker.start()
    },
    { immediate: true },
  )

  onBeforeUnmount(ticker.stop)

  return { value, error, loading, refresh }
}
