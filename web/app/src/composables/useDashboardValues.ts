/**
 * @fileoverview 画布上的实时值：订阅本屏绑定用到的点位，把快照喂给运行时的读取器。
 *
 * ⚠ `provideRuntimeData` 注入的是**函数不是值**：读取器在 computed 里被调用，
 * 响应式依赖由那次调用建立；传一个取好的值进来，值再变也不会重算且不报错。
 * ⚠ 换一批点位要先退旧订阅：不退的话每改一次绑定就多挂一份，
 * 大屏开一天能攒出几百份，表现是「越用越卡」。
 */

import { onUnmounted, shallowRef, watch, type Ref } from 'vue'
import type { DashboardNodeView, PointSample, Unsubscribe } from '@dt/contracts'
import { getProvider, hasProvider } from '@dt/datasources'
import { provideRuntimeData } from '@dt/runtime'

import { boundPointKeys } from '@/features/dashboard/editorDoc'
import { createBindingReader } from '@/runtime/bindingReader'

/** 实时点位这一种来源。⚠ 它是绑定的来源种类，不是模块类型。 */
const REALTIME_KIND = 'opcua'

export interface DashboardValues {
  /** 收到过读数的点位数，供状态条显示。 */
  sampleCount: Ref<number>
}

/**
 * 装上取数源并跟着绑定变化重订。须在 setup 内调用。
 * 收渲染子集：编辑器给的是全量草稿节点，公开快照页给的是窄面，都能装。
 * @param nodes 当前大屏的全部节点
 */
export function useDashboardValues(
  nodes: () => readonly DashboardNodeView[],
): DashboardValues {
  const samples = shallowRef(new Map<string, PointSample>())
  const sampleCount = shallowRef(0)
  let stop: Unsubscribe | null = null

  function record(nodeKey: string, sample: PointSample): void {
    // ⚠ 换一份 Map 而不是就地 set：shallowRef 只认引用变化，
    // 就地改的话画布上的值永远停在第一帧
    const next = new Map(samples.value)
    next.set(nodeKey, sample)
    samples.value = next
    sampleCount.value = next.size
  }

  function resubscribe(keys: readonly string[]): void {
    stop?.()
    stop = null
    if (keys.length === 0 || !hasProvider(REALTIME_KIND)) return
    stop = getProvider(REALTIME_KIND).subscribe(keys, record)
  }

  watch(
    () => boundPointKeys(nodes()).join(' '),
    () => {
      resubscribe(boundPointKeys(nodes()))
    },
    { immediate: true },
  )

  provideRuntimeData({
    readBinding: () => createBindingReader((key) => samples.value.get(key)),
  })

  onUnmounted(() => {
    stop?.()
    stop = null
  })

  return { sampleCount }
}
