/** @fileoverview 大纲类别与配置状态筛选，保留原始行号和绑定身份。 */
import type { BindingPayload } from '@dt/contracts'
import {
  twinRowsOfEntity,
  twinBindingRows,
  type TwinConfig,
} from '@dt/twin-config'
import type { TwinOutlineView, TwinOutlineRowView } from './outlineFilter'
export const OUTLINE_KINDS = [
  'all',
  'scene',
  'animations',
  'parts',
  'anchors',
  'cameras',
  'panels',
  'arrows',
  'flows',
] as const
export type OutlineKind = (typeof OUTLINE_KINDS)[number]
export type OutlineStatus = 'all' | 'issues' | 'unbound'
export function bindingConfigured(binding: BindingPayload): boolean {
  if (binding.sourceKind === 'opcua')
    return (binding.nodeKey ?? '').trim() !== ''
  if (binding.sourceKind === 'static') return binding.staticValueJson !== null
  if (binding.sourceKind === 'computed') return binding.computeJson !== null
  return binding.detailJson !== null
}
export function scopeOutline(
  view: TwinOutlineView,
  config: TwinConfig,
  bindings: readonly BindingPayload[],
  kind: OutlineKind,
  status: OutlineStatus,
): TwinOutlineView {
  const bound = new Set(
    bindings.filter(bindingConfigured).map((binding) => binding.fieldKey),
  )
  const missing = twinBindingRows(config).filter(
    (row) => !bound.has(row.fieldKey),
  )
  const keep = (row: TwinOutlineRowView): boolean => {
    if (status === 'all') return true
    if (status === 'issues') return row.row.flagged
    const own = twinRowsOfEntity(config, row.row.kind, row.row.id)
    return missing.some((item) => own?.[item.slotKey]?.includes(item.index))
  }
  const sections = view.sections
    .filter((section) => kind === 'all' || kind === section.section.kind)
    .map((section) => {
      const folders = section.folders
        .map((folder) => ({ ...folder, rows: folder.rows.filter(keep) }))
        .filter((folder) => status === 'all' || folder.rows.length > 0)
      const rows = section.rows.filter(keep)
      return {
        ...section,
        folders,
        rows,
        hitCount: folders.reduce(
          (sum, folder) => sum + folder.rows.length,
          rows.length,
        ),
      }
    })
    .filter((section) => status === 'all' || section.hitCount > 0)
  return {
    ...view,
    active: view.active || status !== 'all',
    sections,
    scene:
      (kind === 'all' || kind === 'scene') && status === 'all'
        ? view.scene
        : [],
  }
}
