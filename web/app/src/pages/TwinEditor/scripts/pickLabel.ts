/** @fileoverview 挑点位弹窗的副标题：给人看的「哪一项 · 哪个实体 · 哪个读数」。 */
import {
  TWIN_VIEW_BINDINGS,
  twinBindingRows,
  type TwinConfig,
} from '@dt/twin-config'

/**
 * 一个绑定槽给人看的名字；认不出这一行时退回 fieldKey 原样。
 * ⚠ 不直接显示 fieldKey：`partValues[0].value` 这种内部键用户对不上号，
 * 只能退出去再一行行认自己点的是哪一个。
 * @param config 当前草稿配置
 * @param fieldKey 正在挑点位的那一行
 */
export function twinPickLabel(config: TwinConfig, fieldKey: string): string {
  const row = twinBindingRows(config).find((item) => item.fieldKey === fieldKey)
  if (row === undefined) return fieldKey
  const spec = TWIN_VIEW_BINDINGS.find((item) => item.key === row.slotKey)
  const sub = fieldKey.slice(fieldKey.lastIndexOf('.') + 1)
  const field = spec?.arrayFields?.find((item) => item.key === sub)
  return [spec?.label, row.label, field?.label]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ')
}
