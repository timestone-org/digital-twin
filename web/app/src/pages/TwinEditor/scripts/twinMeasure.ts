/**
 * @fileoverview 右栏的距离字段问视口「现在离它多远」的那条缝。
 *
 * ⚠ 走 provide 而不是 prop：字段藏在「右栏 → 检查器 → 显隐面板 → 距离字段」
 * 四层之下，一路串下去要给沿途每个组件都加一个与它无关的 prop，
 * 而 `TwinRightPane` 的 props 本来就快顶到闸门的上限了。
 */
import type { TwinDistanceRef } from '@dt/twin-config'
import { inject, provide, type InjectionKey } from 'vue'

/** 按参考系量当前相机离选中实体多远；量不出给 null。 */
export type TwinMeasureDistance = (ref: TwinDistanceRef) => number | null

const TWIN_MEASURE_KEY: InjectionKey<TwinMeasureDistance> =
  Symbol('twin:measure')

/**
 * 把视口的测距能力放出去。须在 setup 内调用。
 * @param measure 按参考系取当前距离
 */
export function provideTwinMeasure(measure: TwinMeasureDistance): void {
  provide(TWIN_MEASURE_KEY, measure)
}

/** 没人 provide 时的替身：一律量不出。 */
const NO_MEASURE: TwinMeasureDistance = () => null

/**
 * 取测距能力。
 * ⚠ 没人 provide 时给替身而不是抛错：距离字段在孪生编辑器之外（挂载测试、
 * 将来别的宿主）照样要画得出来，只是那颗按钮量不出东西。
 */
export function useTwinMeasure(): TwinMeasureDistance {
  return inject(TWIN_MEASURE_KEY, NO_MEASURE)
}
