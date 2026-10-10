/** @fileoverview 信息牌多状态配置的归一化、两态兼容与精确值匹配。 */
import { oneOf } from './normalizeShared'
import { isRecord, trimmedString } from './sanitize'
import { TWIN_PANEL_STATE_TONES } from './types'
import type {
  TwinPanelFieldKind,
  TwinPanelState,
  TwinPanelStateItem,
  TwinPanelStateTone,
} from './types'

export const DEFAULT_PANEL_STATE: Readonly<TwinPanelState> = {
  onValue: '1',
  offValue: '0',
  onLabel: '开启',
  offLabel: '关闭',
  unknownLabel: '未知',
  onTone: 'success',
  offTone: 'neutral',
}

export interface PanelStateReading {
  state: 'on' | 'off' | 'matched' | 'unknown'
  label: string
  tone: TwinPanelStateTone
}

/** 字段是否显示状态映射。 */
export function panelKindUsesState(kind: TwinPanelFieldKind): boolean {
  return kind === 'status' || kind === 'switch'
}

function stateCode(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw === 'boolean') return String(raw)
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return fallback
}

/** 归一化状态列表与两态文案，保留空编码供编辑器诊断。 */
export function normalizePanelState(raw: unknown): TwinPanelState {
  const source = isRecord(raw) ? raw : {}
  return {
    onValue: stateCode(source.onValue, DEFAULT_PANEL_STATE.onValue),
    offValue: stateCode(source.offValue, DEFAULT_PANEL_STATE.offValue),
    onLabel: trimmedString(source.onLabel) || DEFAULT_PANEL_STATE.onLabel,
    offLabel: trimmedString(source.offLabel) || DEFAULT_PANEL_STATE.offLabel,
    unknownLabel:
      trimmedString(source.unknownLabel) || DEFAULT_PANEL_STATE.unknownLabel,
    onTone: oneOf(
      source.onTone,
      TWIN_PANEL_STATE_TONES,
      DEFAULT_PANEL_STATE.onTone,
    ),
    offTone: oneOf(
      source.offTone,
      TWIN_PANEL_STATE_TONES,
      DEFAULT_PANEL_STATE.offTone,
    ),
    ...(Array.isArray(source.states)
      ? { states: normalizeStateItems(source.states) }
      : {}),
  }
}

function normalizeStateItems(items: unknown[]): TwinPanelStateItem[] {
  const taken = new Set<string>()
  return items.flatMap((item, index) => {
    if (!isRecord(item)) return []
    let id = trimmedString(item.id) || `state-${index + 1}`
    let serial = index + 1
    while (taken.has(id)) id = `state-${++serial}`
    taken.add(id)
    return [
      {
        id,
        value: stateCode(item.value, ''),
        label: trimmedString(item.label) || `状态 ${index + 1}`,
        tone: oneOf(item.tone, TWIN_PANEL_STATE_TONES, 'neutral'),
      },
    ]
  })
}

/** 读取显式列表；没有列表的配置按两态映射展开。 */
export function panelStateItems(
  config: TwinPanelState | undefined,
): readonly TwinPanelStateItem[] {
  const state = config ?? DEFAULT_PANEL_STATE
  return (
    state.states ?? [
      {
        id: 'on',
        value: state.onValue,
        label: state.onLabel,
        tone: state.onTone,
      },
      {
        id: 'off',
        value: state.offValue,
        label: state.offLabel,
        tone: state.offTone,
      },
    ]
  )
}

/** 不经 Number 的编码规范化，避免两个大整数误判为同一状态。 */
function valueKey(raw: unknown): string | null {
  const text = stateCode(raw, '')
  if (text === '') return null
  if (text.toLowerCase() === 'true') return '1'
  if (text.toLowerCase() === 'false') return '0'
  return numericKey(text)
}

function numericKey(text: string): string {
  const numeric = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text)
  if (numeric === null) return text
  const integer = (numeric[2] ?? '').replace(/^0+(?=\d)/, '')
  const fraction = (numeric[3] ?? '').replace(/0+$/, '')
  const sign =
    numeric[1] === '-' && (integer !== '0' || fraction !== '') ? '-' : ''
  return `${sign}${integer}${fraction === '' ? '' : `.${fraction}`}`
}

/** 编码为空或规范化后重合时无法区分状态，空列表也需提示。 */
export function panelStateValuesConflict(config: TwinPanelState): boolean {
  const items = panelStateItems(config)
  const seen = new Set<string>()
  if (items.length === 0) return true
  return items.some((item) => {
    const key = valueKey(item.value)
    if (key === null || seen.has(key)) return true
    seen.add(key)
    return false
  })
}

/** 按显式编码匹配状态；不把缺失值或其他非零值猜成开关状态。 */
export function panelFieldState(
  config: TwinPanelState | undefined,
  value: unknown,
): PanelStateReading {
  const state = config ?? DEFAULT_PANEL_STATE
  const key = valueKey(value)
  if (key !== null && !panelStateValuesConflict(state)) {
    const item = panelStateItems(state).find(
      (item) => key === valueKey(item.value),
    )
    if (item !== undefined) {
      return {
        state: item.id === 'on' || item.id === 'off' ? item.id : 'matched',
        label: item.label,
        tone: item.tone,
      }
    }
  }
  return { state: 'unknown', label: state.unknownLabel, tone: 'neutral' }
}
