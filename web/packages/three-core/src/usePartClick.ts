/**
 * @fileoverview 把视口上的指针事件接成「点中了哪个部件」，并管好监听的装卸。
 *
 * ⚠ 三个监听必须成对装卸，且回调要具名——内联箭头的那个 `removeEventListener`
 * 摘不掉，每次挂载都会往元素上多留一个，表现是切几次大屏之后一次点击触发多回。
 */
import type { TwinPart } from '@dt/twin-config'
import type * as THREE from 'three'
import { onBeforeUnmount, onMounted } from 'vue'

import { distanceContextOf } from './distanceContext'
import {
  ClickGesture,
  resolvePartClick,
  type PartClickParts,
} from './partPicking'
import type { SceneCore } from './sceneCore'

export interface PartClickDeps {
  /** 视口元素；挂载时才有。 */
  element: () => HTMLElement | null
  /** 场景核心；WebGL 不可用时一直是 null。 */
  core: () => SceneCore | null
  /** 部件层；模型没加载时给 null。 */
  parts: () => PartClickParts | null
  /** 落在近档的那一次点击——这是一次真点击。 */
  onNearClick: (part: TwinPart) => void
  /** 落在远档：离得太远，还不算真点击。`box` 是这个部件的包围盒。 */
  onFarClick: (part: TwinPart, box: THREE.Box3 | null) => void
  /**
   * 这一下被别的工具截走了吗（如两点测量）——返回 true 就不再判部件点击。
   * ⚠ 测量开着时还去触发部件联动的话，用户量个尺寸会顺手打开一个弹窗。
   */
  intercept?: (event: PointerEvent) => boolean
}

/**
 * 装上部件点击。
 * @param deps 取视口、场景与部件层的口子，以及远近两档的回调
 */
export function usePartClick(deps: PartClickDeps): void {
  const gesture = new ClickGesture()

  function onPointerDown(event: PointerEvent): void {
    gesture.down(event)
  }

  function onPointerCancel(): void {
    gesture.cancel()
  }

  function onPointerUp(event: PointerEvent): void {
    const element = deps.element()
    const core = deps.core()
    const parts = deps.parts()
    if (element === null || core === null || parts === null) return
    if (!gesture.isClick(event)) return
    if (deps.intercept?.(event) === true) return

    const outcome = resolvePartClick({
      event,
      element,
      camera: core.camera,
      modelRoot: core.modelRoot,
      parts,
      context: distanceContextOf(core),
    })
    if (outcome.kind === 'far') deps.onFarClick(outcome.part, outcome.box)
    if (outcome.kind === 'near') deps.onNearClick(outcome.part)
  }

  onMounted(() => {
    const element = deps.element()
    if (element === null) return
    element.addEventListener('pointerdown', onPointerDown)
    element.addEventListener('pointerup', onPointerUp)
    element.addEventListener('pointercancel', onPointerCancel)
  })

  onBeforeUnmount(() => {
    const element = deps.element()
    if (element === null) return
    element.removeEventListener('pointerdown', onPointerDown)
    element.removeEventListener('pointerup', onPointerUp)
    element.removeEventListener('pointercancel', onPointerCancel)
  })
}
