/**
 * @fileoverview 一批点位的实时快照缓存：跟着要订的点位表重订，收到就记一份。
 *
 * ⚠ 换一批点位要先退旧订阅：不退的话每改一次绑定就多挂一份，
 * 一张开一天的大屏能攒出几百份，表现是「越用越卡」。
 * ⚠ 没装实时 provider 时一条都不订（公开快照页走这条）：假装订上会让
 * 界面一直停在「等首帧」，而首帧永远不会来。
 */

import { onUnmounted, shallowRef, watch, type Ref } from 'vue'
import type { PointSample, Unsubscribe } from '@dt/contracts'
import { getProvider, hasProvider } from '@dt/datasources'

import type { ReadPointSample } from '@/runtime/bindingReader'

/** 实时点位这一种来源。⚠ 它是绑定的来源种类，不是模块类型。 */
const REALTIME_KIND = 'opcua'

export interface PointSamples {
  /** 收到过读数的点位数，供状态条显示。 */
  sampleCount: Ref<number>
  /**
   * 取一个点位当前的快照；没收到过给 undefined。
   * ⚠ 每次调用都现取：把它在 computed 外面取好再传下去，值再变也不会重算。
   */
  read: ReadPointSample
}

/**
 * 订上这批点位并缓存它们的快照。须在 setup 内调用。
 * @param keys 当前要订的点位身份，**定序**——次序抖动会让这里反复退订重订
 */
export function usePointSamples(keys: () => readonly string[]): PointSamples {
  const samples = shallowRef(new Map<string, PointSample>())
  const sampleCount = shallowRef(0)
  let stop: Unsubscribe | null = null

  function record(nodeKey: string, sample: PointSample): void {
    // ⚠ 换一份 Map 而不是就地 set：shallowRef 只认引用变化，
    // 就地改的话画面上的值永远停在第一帧
    const next = new Map(samples.value)
    next.set(nodeKey, sample)
    samples.value = next
    sampleCount.value = next.size
  }

  function resubscribe(wanted: readonly string[]): void {
    stop?.()
    stop = null
    if (wanted.length === 0 || !hasProvider(REALTIME_KIND)) return
    stop = getProvider(REALTIME_KIND).subscribe(wanted, record)
  }

  watch(
    () => keys().join(' '),
    () => {
      resubscribe(keys())
    },
    { immediate: true },
  )

  onUnmounted(() => {
    stop?.()
    stop = null
  })

  return { sampleCount, read: (nodeKey) => samples.value.get(nodeKey) }
}
