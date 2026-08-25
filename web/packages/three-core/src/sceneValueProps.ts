/**
 * @fileoverview 六路实时值的可选 prop → 一份完整的 `SceneLayerValues`。
 *
 * ⚠ 缺席的那一路必须换成**同一个**空引用：每次新建一个空对象，会让下游的
 * `watch` 每帧都判成「变了」——大屏其它槽有新值时，一条绑定都没配的孪生模块
 * 也会跟着空转重建一遍覆盖层。
 */
import {
  EMPTY_ANCHOR_VALUES,
  EMPTY_ARROW_VALUES,
  EMPTY_FLOW_VALUES,
  EMPTY_PANEL_VALUES,
  EMPTY_PART_VALUES,
  type TwinAnchorValues,
  type TwinArrowValues,
  type TwinFlowValues,
  type TwinPanelValues,
  type TwinPartValues,
} from '@dt/twin-config'

import type { SceneLayerValues } from './sceneLayers'

/** 宿主组件上那六个可选的实时值 prop。 */
export interface SceneValueProps {
  partValues?: TwinPartValues | undefined
  anchorValues?: TwinAnchorValues | undefined
  arrowValues?: TwinArrowValues | undefined
  panelValues?: TwinPanelValues | undefined
  flowValues?: TwinFlowValues | undefined
}

/**
 * 补齐缺席的几路，给出这一拍完整的六路值。
 * @param props 宿主组件的 props
 */
export function sceneValuesOf(props: SceneValueProps): SceneLayerValues {
  return {
    parts: props.partValues ?? EMPTY_PART_VALUES,
    anchors: props.anchorValues ?? EMPTY_ANCHOR_VALUES,
    arrows: props.arrowValues ?? EMPTY_ARROW_VALUES,
    panels: props.panelValues ?? EMPTY_PANEL_VALUES,
    flows: props.flowValues ?? EMPTY_FLOW_VALUES,
  }
}
