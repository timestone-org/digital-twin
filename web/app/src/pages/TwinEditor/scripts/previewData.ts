/** @fileoverview 选中对象的模拟数据行，覆盖与实时值分开保存。 */
import {
  twinBindingRows,
  twinRowsOfEntity,
  type TwinConfig,
  type TwinSceneValues,
} from '@dt/twin-config'
import type { TwinSelection } from './types'
export type PreviewSample = string | number | boolean | null
export interface PreviewDataRow {
  key: string
  label: string
  slot:
    | 'parts'
    | 'anchors'
    | 'panels'
    | 'arrows'
    | 'flows'
    | 'partFields'
    | 'animations'
  entityId: string
}
const SLOTS: Readonly<Record<string, PreviewDataRow['slot']>> = {
  partValues: 'parts',
  anchorValues: 'anchors',
  panelValues: 'panels',
  arrowValues: 'arrows',
  flowValues: 'flows',
  partFieldValues: 'partFields',
  animationValues: 'animations',
}
export function previewDataRows(
  config: TwinConfig,
  selection: TwinSelection,
  animation: string | null,
): PreviewDataRow[] {
  const scope =
    animation !== null
      ? twinRowsOfEntity(config, 'animations', animation)
      : 'id' in selection
        ? twinRowsOfEntity(config, selection.kind, selection.id)
        : null
  if (scope === null) return []
  return twinBindingRows(config).flatMap((row) => {
    const slot = SLOTS[row.slotKey]
    if (slot === undefined || !scope[row.slotKey]?.includes(row.index))
      return []
    return [
      {
        key: `${slot}:${row.entityId}`,
        label: row.label,
        slot,
        entityId: row.entityId,
      },
    ]
  })
}
export function sampleText(value: unknown): string {
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? String(value)
    : ''
}
export function previewSample(value: string): PreviewSample {
  const text = value.trim()
  if (text === '') return null
  if (text === 'true' || text === 'false') return text === 'true'
  return Number.isFinite(Number(text)) ? Number(text) : text
}
export function rowSample(
  values: TwinSceneValues,
  row: PreviewDataRow,
): unknown {
  if (row.slot === 'animations') return values.animations?.[row.entityId]
  if (row.slot === 'flows') return values.flows[row.entityId]?.intensity
  return values[row.slot][row.entityId]?.value
}
export function applyPreviewData(
  values: TwinSceneValues,
  rows: readonly PreviewDataRow[],
  samples: Readonly<Record<string, PreviewSample>>,
): TwinSceneValues {
  const result = { ...values }
  for (const row of rows) {
    if (!Object.hasOwn(samples, row.key)) continue
    const value = samples[row.key] ?? null
    if (row.slot === 'animations')
      result.animations = { ...result.animations, [row.entityId]: value }
    else if (row.slot === 'flows')
      result.flows = {
        ...result.flows,
        [row.entityId]: {
          intensity: value,
          active: result.flows[row.entityId]?.active ?? true,
        },
      }
    else result[row.slot] = { ...result[row.slot], [row.entityId]: { value } }
  }
  return result
}
