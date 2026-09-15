/** @fileoverview 批量配置的纯变更计划，保留目标对象身份和几何关系。 */
import type { BindingPayload } from '@dt/contracts'
import {
  normalizeTwinConfig,
  twinBindingRows,
  twinRowsOfEntity,
  type TwinConfig,
  type TwinPart,
} from '@dt/twin-config'
export type CopySetting =
  'look' | 'tint' | 'detailStyle' | 'detailFields' | 'click'
export type BatchKind =
  'parts' | 'panels' | 'anchors' | 'arrows' | 'flows' | 'animations'
export interface PointReplacement {
  bindingId: string
  fieldKey: string
  label: string
  before: string
  after: string
}
export const COPY_SETTINGS: readonly { value: CopySetting; label: string }[] = [
  { value: 'look', label: '常态外观' },
  { value: 'tint', label: '状态染色规则' },
  { value: 'detailStyle', label: '详情样式' },
  { value: 'detailFields', label: '详情字段' },
  { value: 'click', label: '点击行为与距离限制' },
]
function copiedPart(
  source: TwinPart,
  target: TwinPart,
  settings: readonly CopySetting[],
): TwinPart {
  const next = { ...target }
  if (settings.includes('look')) next.look = { ...source.look }
  if (settings.includes('tint')) next.tint = source.tint
  if (settings.includes('detailStyle'))
    next.detail = {
      ...source.detail,
      title: target.detail.title,
      subtitle: target.detail.subtitle,
      fields: target.detail.fields,
    }
  if (settings.includes('detailFields'))
    next.detail = { ...next.detail, fields: source.detail.fields }
  if (settings.includes('click')) {
    next.click = {
      ...source.click,
      view: target.click.view,
      cameraId: target.click.cameraId,
    }
    next.clickDistance = source.clickDistance
  }
  return next
}
export function copyPartSettings(
  config: TwinConfig,
  sourceId: string,
  targetIds: readonly string[],
  settings: readonly CopySetting[],
): TwinConfig {
  const source = config.parts.find((part) => part.id === sourceId)
  if (source === undefined || settings.length === 0) return config
  const template = normalizeTwinConfig({ parts: [source] }).parts[0] ?? source
  let changed = false
  const parts = config.parts.map((part) => {
    if (part.id === sourceId || !targetIds.includes(part.id)) return part
    const next = copiedPart(template, part, settings)
    if (JSON.stringify(next) !== JSON.stringify(part)) changed = true
    return next
  })
  return changed ? { ...config, parts } : config
}
export function batchCandidates(
  config: TwinConfig,
  kind: BatchKind,
): { id: string; name: string }[] {
  return kind === 'animations'
    ? config.model.animations.controls.map((control) => ({
        id: control.clip,
        name: control.name || control.clip,
      }))
    : config[kind].map((item) => ({ id: item.id, name: item.name || item.id }))
}
export function replacementPlan(
  config: TwinConfig,
  bindings: readonly BindingPayload[],
  kind: BatchKind,
  ids: readonly string[],
  replacement: { find: string; replace: string },
): PointReplacement[] {
  const { find, replace } = replacement
  if (find === '' || find === replace) return []
  const prefixes = new Set(
    ids.flatMap((id) =>
      Object.entries(twinRowsOfEntity(config, kind, id) ?? {}).flatMap(
        ([slot, indexes]) => indexes.map((index) => `${slot}[${index}].`),
      ),
    ),
  )
  const rows = twinBindingRows(config)
  return bindings.flatMap((binding) => {
    if (binding.sourceKind !== 'opcua' || !binding.nodeKey?.includes(find))
      return []
    const prefix = [...prefixes].find((prefix) =>
      binding.fieldKey.startsWith(prefix),
    )
    if (prefix === undefined) return []
    const row = rows.find((row) =>
      binding.fieldKey.startsWith(`${row.slotKey}[${row.index}].`),
    )
    return [
      {
        bindingId: binding.id,
        fieldKey: binding.fieldKey,
        label: row?.label ?? binding.fieldKey,
        before: binding.nodeKey,
        after: binding.nodeKey.split(find).join(replace),
      },
    ]
  })
}
export function replacedBindings(
  bindings: readonly BindingPayload[],
  plan: readonly PointReplacement[],
): BindingPayload[] {
  return bindings.map((binding) => {
    const row = plan.find(
      (row) =>
        row.bindingId === binding.id &&
        row.fieldKey === binding.fieldKey &&
        row.before === binding.nodeKey,
    )
    return row === undefined ? binding : { ...binding, nodeKey: row.after }
  })
}
