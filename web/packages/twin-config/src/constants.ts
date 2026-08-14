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

/** 状态染色的数组绑定槽键。 */
export const TWIN_TINT_BINDING_KEY = 'tintValues'

/** 锚点读数的数组绑定槽键。 */
export const TWIN_ANCHOR_BINDING_KEY = 'anchorValues'

/** 染色行的子槽。 */
export const TWIN_TINT_ROW_SLOTS = ['value', 'status'] as const
export type TwinTintRowSlot = (typeof TWIN_TINT_ROW_SLOTS)[number]

/** 锚点行的子槽。 */
export const TWIN_ANCHOR_ROW_SLOTS = ['value'] as const
export type TwinAnchorRowSlot = (typeof TWIN_ANCHOR_ROW_SLOTS)[number]

/** 任意数组行子槽，缝合读值按它取。 */
export type TwinRowSlot = TwinTintRowSlot | TwinAnchorRowSlot

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

/** 第 index 条染色规则某个子槽的 fieldKey。 */
export function tintRowFieldKey(index: number, sub: TwinTintRowSlot): string {
  return arrayRowFieldKey(TWIN_TINT_BINDING_KEY, index, sub)
}

/** 第 index 个锚点读数的 fieldKey。 */
export function anchorRowFieldKey(index: number): string {
  return arrayRowFieldKey(TWIN_ANCHOR_BINDING_KEY, index, 'value')
}

/**
 * twin-view 模块声明的绑定槽。
 * ⚠ 模块 manifest 直接摊开它，不许再抄一份键名：槽键在清单与缝合两处各写一遍时，
 * 拼错的那一份既不报错也永远取不到值。
 */
export const TWIN_VIEW_BINDINGS: readonly BindingSpec[] = [
  {
    key: TWIN_TINT_BINDING_KEY,
    label: '状态染色',
    dataType: 'string',
    isArray: true,
    arrayFields: [
      { key: 'value', label: '数值', dataType: 'number' },
      { key: 'status', label: '状态', dataType: 'string' },
    ],
  },
  {
    key: TWIN_ANCHOR_BINDING_KEY,
    label: '锚点读数',
    dataType: 'number',
    isArray: true,
    arrayFields: [{ key: 'value', label: '数值', dataType: 'number' }],
  },
]
