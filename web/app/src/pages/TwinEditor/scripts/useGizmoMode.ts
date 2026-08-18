/**
 * @fileoverview 坐标轴手柄的模式，以及它跟着选中自动回落的规则。
 */
import type { GizmoMode } from '@dt/three-core'
import { ref, watch, type Ref } from 'vue'

import type { TwinSelection } from './types'

/** 只有箭头有朝向，旋转档对别的实体没有意义。 */
function canRotate(selection: TwinSelection | null): boolean {
  return (
    selection !== null && 'kind' in selection && selection.kind === 'arrows'
  )
}

/**
 * 装上手柄模式。
 * ⚠ 选中换成非箭头时必须退回平移：留在旋转档上，用户会看到三个转不出任何
 * 效果的圆环——锚点与信息牌根本没有朝向可改。
 * @param selection 取当前选中
 */
export function useGizmoMode(
  selection: () => TwinSelection | null,
): Ref<GizmoMode> {
  const mode = ref<GizmoMode>('translate')

  watch(selection, (next) => {
    if (!canRotate(next)) mode.value = 'translate'
  })

  return mode
}
