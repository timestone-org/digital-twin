/**
 * @fileoverview 2D 孪生子编辑器的实时读数：装配取数来源、订这张大屏的推送主题，
 * 把点位快照缝成一个绑定读取器，交给运行态画中画自己求值。
 *
 * ⚠ 这一页不是大屏运行时，没人替它装 provider——`installDashboardDataSources`
 * 必须在这里自己调一次；不调的表现是每条实时绑定都读成「没有装配取数源」，
 * 而画面上一切照旧、只是每个读数都是占位符。
 * ⚠ 与运行态走**同一条链路**：同一个推送主题、同一份绑定求值。各走各的话，在编辑器里
 * 核对过的对应关系到大屏上就接错了对象，且两边都不报错。
 * ⚠ 只有**已落库**的绑定会有推送：推送方按大屏行版本重读绑定计划，内存里的草稿它看不见。
 * 所以刚绑上的点位在保存之前一直取不到值——这一档要说出口，见 `Twin2dLiveState`。
 * ⚠ 历史与台账两路刻意不注入：这一页上没有任何时序图元，注一个取不到数的通道
 * 只会在诊断时多一条假线索。
 */
import type { BindingView } from '@dt/contracts'
import type { BindingValueReader } from '@dt/runtime'
import { computed } from 'vue'
import type { ComputedRef } from 'vue'

import { installDashboardDataSources } from '@/bootstrap/dashboard'
import { usePointSamples } from '@/composables/usePointSamples'
import { useRealtimeChannel } from '@/composables/useRealtimeChannel'
import { boundPointKeysOf } from '@/features/dashboard/editorDoc'
import { createBindingReader } from '@/runtime/bindingReader'
import type { ReadPointSample } from '@/runtime/bindingReader'
import { dashboardTopic } from '@/runtime/pointFrames'
import { createPointSubscribe } from '@/runtime/pointStream'

/**
 * 实时读数当下的处境。
 *
 * ⚠ 四档必须各说各的，不许合并成「有值 / 没值」：都画成一块空白时，「这张图压根没绑
 * 实时点位」与「绑了但一帧都没来」看着一模一样，而后者几乎总是绑定还没保存或推送方
 * 没在推——把没数据说成没配置，人就永远查不到那一步。
 */
export type Twin2dLiveState = 'unwired' | 'idle' | 'waiting' | 'live'

/** 四档各自在画中画上说的那一句。 */
export const TWIN_2D_LIVE_STATE_TEXT: Readonly<
  Record<Twin2dLiveState, string>
> = {
  unwired: '还不知道是哪张大屏，订不到实时读数',
  idle: '这张图没有绑实时点位',
  waiting: '已绑点位，还没收到读数：未保存的绑定不会有推送',
  live: '实时读数在推',
}

/** 绑上的实时点位数，与其中已经收到过读数的个数。 */
export interface Twin2dLiveTally {
  bound: number
  received: number
}

export interface Twin2dLiveValues {
  /**
   * 取一个绑定读取器。
   * ⚠ 每次求值都要重新调它：对快照缓存的响应式依赖由那一次调用建立，把它取好存下来
   * 反复用的话，值再变也不会重算，而且不报任何错。
   */
  readBinding: () => BindingValueReader
  /** 当下取不取得到数；界面照它明说，不留白。 */
  state: ComputedRef<Twin2dLiveState>
  tally: ComputedRef<Twin2dLiveTally>
}

/**
 * 数一数这批点位里已经收到过读数的有几个。
 *
 * ⚠ 逐个查当前这批点位，而不是读快照缓存的条目数：缓存跨绑定改动是保留的（换点位表
 * 不清，否则整屏的值会闪一下），直接读条目数会把已经不绑了的点位一起数进来，于是
 * 「已收到」比「已绑」还多。
 * @param keys 当前绑上的点位身份
 * @param read 快照缓存的查询函数
 */
function tallyOf(
  keys: readonly string[],
  read: ReadPointSample,
): Twin2dLiveTally {
  const received = keys.filter((key) => read(key) !== undefined).length
  return { bound: keys.length, received }
}

/**
 * 装上实时读数。须在 setup 内调用。
 *
 * ⚠ 退订归 `usePointSamples`（它在自己的 `onUnmounted` 里退），这里不另存一份句柄：
 * 存第二份就有第二处要记得清，而漏清一次只表现为「越用越卡」。
 * @param dashboardId 这段孪生所在的大屏 id；空串 = 还没读出来，此时一个主题都不订
 * @param bindings 当前这一份绑定，含还没保存的草稿
 */
export function useTwin2dLiveValues(
  dashboardId: () => string,
  bindings: () => readonly BindingView[],
): Twin2dLiveValues {
  installDashboardDataSources({
    subscribe: createPointSubscribe(useRealtimeChannel(), () => {
      const id = dashboardId()
      return id === '' ? null : dashboardTopic(id)
    }),
  })

  // ⚠ `boundPointKeysOf` 出的是**定序**的去重表：次序一抖，`usePointSamples`
  //   会把「同一批点位」认成换了一批，于是每改一次绑定就退订重订一轮
  const keys = computed(() => boundPointKeysOf(bindings()))
  const samples = usePointSamples(() => keys.value, dashboardId)

  const tally = computed(() => tallyOf(keys.value, samples.read))

  const state = computed<Twin2dLiveState>(() => {
    if (dashboardId() === '') return 'unwired'
    const { bound, received } = tally.value
    if (bound === 0) return 'idle'
    return received === 0 ? 'waiting' : 'live'
  })

  return {
    readBinding: () => createBindingReader(samples.read),
    state,
    tally,
  }
}
