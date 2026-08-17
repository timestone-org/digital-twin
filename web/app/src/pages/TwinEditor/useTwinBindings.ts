/**
 * @fileoverview 孪生编辑器的绑定这一路：绑定表、绑定页的动作、挑点弹窗的开关，
 * 以及喂进视口的实时读数。
 *
 * ⚠ 挑到的点位落库的是 `node_key`（点位在设备上的身份）不是 `code`：写成 code 的
 * 表现是标签上有点位名、推送方却永远匹配不到这个键，读数一直是占位符。
 */
import type { BindingPayload, CollectPoint } from '@dt/contracts'
import type { SceneLayerValues } from '@dt/three-core'
import type { TwinConfig } from '@dt/twin-config'
import { computed, ref, type ComputedRef, type Ref } from 'vue'

import { createTwinBindingActions } from './twinBindingActions'
import type { TwinDoc } from './twinDoc'
import { useTwinLiveValues } from './useTwinLiveValues'

export interface TwinBindings {
  /** 当前这一份绑定，含还没保存的草稿。 */
  bindings: ComputedRef<readonly BindingPayload[]>
  write: (binding: BindingPayload) => void
  bind: (fieldKey: string) => void
  drop: (fieldKey: string) => void
  removeRow: (slotKey: string, rowIndex: number) => void
  /** 正在给哪个槽挑点位；null = 挑点弹窗没开。 */
  pickingFieldKey: Ref<string | null>
  /** 挑点弹窗回来的那一下。 */
  pickPoint: (point: CollectPoint) => void
  /** 弹窗的开关回传；关上时结束这一次挑点。 */
  closePicker: (isOpen: boolean) => void
  /** 缝合好的实时读数，喂给编辑视口；配置还没读出来时是 undefined。 */
  liveValues: ComputedRef<SceneLayerValues | undefined>
}

/**
 * 装上绑定与实时读数。须在 setup 内调用。
 * @param doc 孪生文档态；null = 还没读出来，此时全部动作都是空操作
 * @param dashboardId 这段孪生所在的大屏 id
 * @param nodeId 这段孪生所在的节点 id；新建的绑定挂在它上面
 * @param config 归一化后的孪生配置；null = 还没读出来
 */
export function useTwinBindings(
  doc: () => TwinDoc | null,
  dashboardId: () => string,
  nodeId: () => string,
  config: () => TwinConfig | null,
): TwinBindings {
  const bindings = computed<readonly BindingPayload[]>(
    () => doc()?.bindings.value ?? [],
  )

  const actions = computed(() => {
    const current = doc()
    return current === null
      ? null
      : createTwinBindingActions(current, nodeId)
  })

  const pickingFieldKey = ref<string | null>(null)

  const liveValues = useTwinLiveValues(dashboardId, config, () => bindings.value)

  return {
    bindings,
    write: (binding) => actions.value?.write(binding),
    bind: (fieldKey) => actions.value?.bind(fieldKey),
    drop: (fieldKey) => actions.value?.drop(fieldKey),
    removeRow: (slotKey, rowIndex) =>
      actions.value?.removeRow(slotKey, rowIndex),
    pickingFieldKey,
    pickPoint: (point) => {
      const fieldKey = pickingFieldKey.value
      pickingFieldKey.value = null
      if (fieldKey === null) return
      actions.value?.applyPickedPoint(fieldKey, point.node_key)
    },
    closePicker: (isOpen) => {
      if (!isOpen) pickingFieldKey.value = null
    },
    liveValues,
  }
}
