/**
 * @fileoverview 模块 `values` 袋 → 场景五路实时值的那一次缝合。
 *
 * ⚠ 全仓只有这一处知道「哪个槽键喂哪一层、按什么顺序对齐」。运行态渲染器与
 * 编辑视口各写一份的话，两边迟早会在「信息牌按扁平化后的字段序对齐」这类细节上
 * 漂开——漂开之后两边都有值、都不报错，只是编辑器里核对过的对应关系到了大屏上
 * 全是错的（见 `bindingRows.ts` 的文件头）。
 */
import {
  TWIN_ANCHOR_BINDING_KEY,
  TWIN_ARROW_BINDING_KEY,
  TWIN_FLOW_BINDING_KEY,
  TWIN_HIER_BINDING_KEY,
  TWIN_PANEL_BINDING_KEY,
} from './constants'
import { flattenHierFields } from './hierTree'
import { flattenPanelFields } from './normalizeElements'
import {
  stitchAnchorValues,
  stitchArrowValues,
  stitchFlowValues,
  stitchHierValues,
  stitchPanelValues,
} from './twinMath'
import type { TwinConfig } from './types'
import type {
  TwinAnchorValues,
  TwinArrowValues,
  TwinFlowValues,
  TwinHierValues,
  TwinPanelValues,
} from './types'

/** 缝合好的五路实时值，键都是实体自己的 id。 */
export interface TwinSceneValues {
  anchors: TwinAnchorValues
  arrows: TwinArrowValues
  panels: TwinPanelValues
  flows: TwinFlowValues
  /** 钻取面板用；3D 覆盖层不消费它。 */
  hier: TwinHierValues
}

/**
 * 把一袋模块 `values` 缝成场景五路实时值。
 * @param config **归一化后**的孪生配置；喂原始配置会因为脏条目被丢弃而整体错位一格
 * @param values 模块 values 袋，键是绑定槽键
 */
export function twinSceneValues(
  config: TwinConfig,
  values: Record<string, unknown>,
): TwinSceneValues {
  return {
    anchors: stitchAnchorValues(config.anchors, values[TWIN_ANCHOR_BINDING_KEY]),
    arrows: stitchArrowValues(config.arrows, values[TWIN_ARROW_BINDING_KEY]),
    // ⚠ 必须喂扁平化后的字段序：按「第 i 张牌」对齐会让多字段的牌之后整体错位
    panels: stitchPanelValues(
      flattenPanelFields(config.panels),
      values[TWIN_PANEL_BINDING_KEY],
    ),
    flows: stitchFlowValues(config.flows, values[TWIN_FLOW_BINDING_KEY]),
    // ⚠ 同理：按「第 i 个节点」对齐会让多字段的节点之后整体错位
    hier: stitchHierValues(
      flattenHierFields(config.hierNodes),
      values[TWIN_HIER_BINDING_KEY],
    ),
  }
}
