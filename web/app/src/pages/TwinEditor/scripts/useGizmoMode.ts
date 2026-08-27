/**
 * @fileoverview 坐标轴手柄的模式，以及它跟着选中自动回落的规则。
 */
import type { GizmoMode } from '@dt/three-core'
import type { TwinConfig } from '@dt/twin-config'
import { ref, watch, type Ref } from 'vue'

import type { TwinSelection } from './types'

/**
 * 箭头有朝向、钉死朝向的信息牌有旋转，其余实体旋转档转不出任何效果——
 * 跟随相机那两档的信息牌也一样，朝向每帧被相机接管。
 */
function canRotate(
  selection: TwinSelection | null,
  config: TwinConfig | null,
): boolean {
  if (selection === null || !('kind' in selection)) return false
  if (selection.kind === 'arrows') return true
  if (selection.kind !== 'panels') return false
  const panel = config?.panels.find((item) => item.id === selection.id)
  return panel?.billboard === 'fixed'
}

/**
 * 装上手柄模式。
 * ⚠ 选中换成转不动的实体时必须退回平移：留在旋转档上，用户会看到三个
 * 转不出任何效果的圆环。信息牌的朝向档改离「钉死」时同理，所以配置也要盯。
 * @param selection 取当前选中
 * @param config 取当前配置，用来判断信息牌的朝向档
 */
export function useGizmoMode(
  selection: () => TwinSelection | null,
  config: () => TwinConfig | null,
): Ref<GizmoMode> {
  const mode = ref<GizmoMode>('translate')

  watch([selection, config], ([nextSelection, nextConfig]) => {
    if (!canRotate(nextSelection, nextConfig)) mode.value = 'translate'
  })

  return mode
}
