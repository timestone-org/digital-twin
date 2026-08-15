/**
 * @fileoverview twin-view 的绑定槽键、数组行 fieldKey 构造与文档格式版本。
 * 编辑器派生绑定行、服务端校验 fieldKey、运行时缝合读值三处共用这一批字面量；
 * 数组绑定的落库形状见 docs/DASHBOARD_DESIGN.md §4.2。
 */
import type { BindingSpec } from '@dt/contracts'

/** 节点 `configJson` 里孪生配置所在的键。 */
export const TWIN_CONFIG_KEY = 'twin'

/**
 * 孪生配置的文档格式版本。
 * ⚠ 版本只认这个显式整数，不许靠「坐标是不是整数」这类结构启发式判断（ADR-0012 六）。
 */
export const TWIN_CONFIG_VERSION = 1

/** 锚点读数的数组绑定槽键。 */
export const TWIN_ANCHOR_BINDING_KEY = 'anchorValues'
/** 信息牌字段读数的数组绑定槽键。 */
export const TWIN_PANEL_BINDING_KEY = 'panelValues'
/** 箭头读数的数组绑定槽键。 */
export const TWIN_ARROW_BINDING_KEY = 'arrowValues'
/** 能量流读数的数组绑定槽键。 */
export const TWIN_FLOW_BINDING_KEY = 'flowValues'
/** 层级钻取字段读数的数组绑定槽键。 */
export const TWIN_HIER_BINDING_KEY = 'hierValues'

/** 只有一个数值的那三类元素共用这一份子槽。 */
export const TWIN_VALUE_ROW_SLOTS = ['value'] as const
export type TwinValueRowSlot = (typeof TWIN_VALUE_ROW_SLOTS)[number]

/** 能量流行的子槽：强度驱动粒子，激活决定流不流。 */
export const TWIN_FLOW_ROW_SLOTS = ['intensity', 'active'] as const
export type TwinFlowRowSlot = (typeof TWIN_FLOW_ROW_SLOTS)[number]

/** 任意数组行子槽，缝合读值按它取。 */
export type TwinRowSlot = TwinValueRowSlot | TwinFlowRowSlot

/** 锚点行的子槽（历史名字，与 `TWIN_VALUE_ROW_SLOTS` 同一份）。 */
export const TWIN_ANCHOR_ROW_SLOTS = TWIN_VALUE_ROW_SLOTS
export type TwinAnchorRowSlot = TwinValueRowSlot

/**
 * 数组绑定第 index 行、第 sub 个子槽的 fieldKey。
 * ⚠ index 是 `normalizeTwinConfig` **输出**里的文档序：派生绑定行与缝合读值必须喂
 * 同一份归一化结果，喂原始配置会因为脏条目被丢弃而让其后每一行整体错位一格。
 * @param slotKey 数组槽键
 * @param index 归一化后的文档序下标
 * @param sub 行内子槽
 */
export function arrayRowFieldKey(
  slotKey: string,
  index: number,
  sub: TwinRowSlot,
): string {
  return `${slotKey}[${index}].${sub}`
}

/** 第 index 个锚点读数的 fieldKey。 */
export function anchorRowFieldKey(index: number): string {
  return arrayRowFieldKey(TWIN_ANCHOR_BINDING_KEY, index, 'value')
}

/** 扁平化后第 index 个信息牌字段的 fieldKey。 */
export function panelRowFieldKey(index: number): string {
  return arrayRowFieldKey(TWIN_PANEL_BINDING_KEY, index, 'value')
}

/** 第 index 个箭头读数的 fieldKey。 */
export function arrowRowFieldKey(index: number): string {
  return arrayRowFieldKey(TWIN_ARROW_BINDING_KEY, index, 'value')
}

/** 第 index 条能量流某个子槽的 fieldKey。 */
export function flowRowFieldKey(index: number, sub: TwinFlowRowSlot): string {
  return arrayRowFieldKey(TWIN_FLOW_BINDING_KEY, index, sub)
}

/** 扁平化后第 index 个钻取节点字段的 fieldKey。 */
export function hierRowFieldKey(index: number): string {
  return arrayRowFieldKey(TWIN_HIER_BINDING_KEY, index, 'value')
}

/**
 * twin-view 模块声明的绑定槽。
 * ⚠ 模块 manifest 直接摊开它，不许再抄一份键名：槽键在清单与缝合两处各写一遍时，
 * 拼错的那一份既不报错也永远取不到值。
 *
 * ⚠ 这里只许登记**渲染层真正消费的槽**：没有图元就摆槽位，用户绑完点位看到的
 * 是「绑了没反应」，那比缺一个功能更难查。加槽必须与渲染层同一轮落地。
 */
export const TWIN_VIEW_BINDINGS: readonly BindingSpec[] = [
  {
    key: TWIN_ANCHOR_BINDING_KEY,
    label: '锚点读数',
    dataType: 'number',
    isArray: true,
    arrayFields: [{ key: 'value', label: '数值', dataType: 'number' }],
  },
  {
    key: TWIN_PANEL_BINDING_KEY,
    label: '信息牌字段',
    dataType: 'number',
    isArray: true,
    arrayFields: [{ key: 'value', label: '数值', dataType: 'number' }],
  },
  {
    key: TWIN_ARROW_BINDING_KEY,
    label: '箭头读数',
    dataType: 'number',
    isArray: true,
    arrayFields: [{ key: 'value', label: '数值', dataType: 'number' }],
  },
  {
    key: TWIN_FLOW_BINDING_KEY,
    label: '能量流',
    dataType: 'number',
    isArray: true,
    arrayFields: [
      { key: 'intensity', label: '强度', dataType: 'number' },
      { key: 'active', label: '激活', dataType: 'boolean' },
    ],
  },
  {
    key: TWIN_HIER_BINDING_KEY,
    label: '钻取节点字段',
    dataType: 'number',
    isArray: true,
    arrayFields: [{ key: 'value', label: '数值', dataType: 'number' }],
  },
]
