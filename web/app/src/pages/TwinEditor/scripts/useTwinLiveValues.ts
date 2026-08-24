/**
 * @fileoverview 孪生子编辑器的实时读数：订这张大屏的推送主题，把绑定求值成
 * 五路场景值喂进编辑视口。
 *
 * ⚠ 与运行态走的是**同一条链路**：同一个推送主题、同一份绑定求值、同一份
 * `twinSceneValues` 缝合。所以在编辑器里核对过的对应关系，到大屏上就是那个结果；
 * 各走各的话，编辑器绿灯而大屏接错对象，且两边都不报错。
 * ⚠ 只有**已落库**的绑定会有推送：推送方按大屏行版本重读绑定计划，内存里的
 * 草稿它看不见。所以刚绑上的点位在保存之前一直是占位符（绑定页上已摆明）。
 */
import type { BindingPayload } from '@dt/contracts'
import type { SceneLayerValues } from '@dt/three-core'
import { computeModuleValues, type BindingValueReader } from '@dt/runtime'
import {
  TWIN_VIEW_BINDINGS,
  twinSceneValues,
  type TwinConfig,
} from '@dt/twin-config'
import { computed, type ComputedRef } from 'vue'

import { installDashboardDataSources } from '@/bootstrap/dashboard'
import { usePointSamples } from '@/composables/usePointSamples'
import { useRealtimeChannel } from '@/composables/useRealtimeChannel'
import { boundPointKeysOf } from '@/features/dashboard/editorDoc'
import { createBindingReader } from '@/runtime/bindingReader'
import { dashboardTopic } from '@/runtime/pointFrames'
import { createPointSubscribe } from '@/runtime/pointStream'

export interface TwinLiveValues {
  /** 缝合好的五路场景值；配置还没读出来时是 undefined。 */
  scene: ComputedRef<SceneLayerValues | undefined>
  /**
   * 取一个绑定读取器。
   * ⚠ 每次求值都要重新调它：对快照缓存的响应式依赖由那一次调用建立，
   * 拿一个存下来的读取器反复用，值再变也不会重算，且不报任何错。
   */
  readBinding: () => BindingValueReader
}

/**
 * 装上实时读数。须在 setup 内调用。
 * @param dashboardId 这段孪生所在的大屏 id；空串 = 还没读出来，不订任何主题
 * @param config 归一化后的孪生配置；null = 还没读出来
 * @param bindings 当前这一份绑定（含还没保存的草稿）
 */
export function useTwinLiveValues(
  dashboardId: () => string,
  config: () => TwinConfig | null,
  bindings: () => readonly BindingPayload[],
): TwinLiveValues {
  // ⚠ 历史序列不注入：编辑视口上没有任何时序图元，注了也没人读，
  //   而注一个取不到数的通道只会在诊断时多一条假线索
  installDashboardDataSources({
    subscribe: createPointSubscribe(useRealtimeChannel(), () => {
      const id = dashboardId()
      return id === '' ? null : dashboardTopic(id)
    }),
  })

  const samples = usePointSamples(
    () => boundPointKeysOf(bindings()),
    dashboardId,
  )

  const readBinding = (): BindingValueReader =>
    createBindingReader(samples.read)

  // ⚠ 在 computed 里调用读取器：对快照缓存的响应式依赖由这次调用建立
  const values = computed(
    () =>
      computeModuleValues({
        specs: TWIN_VIEW_BINDINGS,
        bindings: bindings(),
        read: readBinding(),
      }).values,
  )

  const scene = computed(() => {
    const current = config()
    if (current === null) return undefined
    const stitched = twinSceneValues(current, values.value)
    return {
      parts: stitched.parts,
      anchors: stitched.anchors,
      arrows: stitched.arrows,
      panels: stitched.panels,
      flows: stitched.flows,
    }
  })

  return { scene, readBinding }
}
