/**
 * @fileoverview 一袋六路实时值 → 覆盖层要的那五路，缺席的补空引用。
 *
 * ⚠ 六路收成**一个** prop 而不是六个：宿主的 prop 数有上限（闸门
 * `check_ts_style`），而这几路本就是同一拍缝出来的一整份，拆开只会让调用方
 * 在六个地方各写一遍同一个来源。
 * ⚠ 缺席的那一路必须换成**同一个**空引用：每次新建一个空对象，会让下游的
 * `watch` 每帧都判成「变了」——大屏其它槽有新值时，一条绑定都没配的孪生模块
 * 也会跟着空转重建一遍覆盖层。
 */
import {
  EMPTY_ANCHOR_VALUES,
  EMPTY_ARROW_VALUES,
  EMPTY_FLOW_VALUES,
  EMPTY_PANEL_VALUES,
  EMPTY_PART_FIELD_VALUES,
  EMPTY_PART_VALUES,
  type TwinPartFieldValues,
  type TwinSceneValues,
} from '@dt/twin-config'

import type { SceneLayerValues } from './sceneLayers'

/** 宿主组件上那一个可选的实时值 prop。 */
export interface SceneValueProps {
  values?: Partial<TwinSceneValues> | undefined
}

/**
 * 补齐缺席的几路，给出这一拍完整的五路覆盖层值。
 * ⚠ 部件详情字段不在覆盖层里：它由画布边上的详情卡片消费，见 `partFieldValuesOf`。
 * @param props 宿主组件的 props
 */
export function sceneValuesOf(props: SceneValueProps): SceneLayerValues {
  const values = props.values ?? {}
  return {
    parts: values.parts ?? EMPTY_PART_VALUES,
    anchors: values.anchors ?? EMPTY_ANCHOR_VALUES,
    arrows: values.arrows ?? EMPTY_ARROW_VALUES,
    panels: values.panels ?? EMPTY_PANEL_VALUES,
    flows: values.flows ?? EMPTY_FLOW_VALUES,
  }
}

/**
 * 详情卡片那一路；缺席时给同一个空引用。
 * @param props 宿主组件的 props
 */
export function partFieldValuesOf(props: SceneValueProps): TwinPartFieldValues {
  return props.values?.partFields ?? EMPTY_PART_FIELD_VALUES
}
