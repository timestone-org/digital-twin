/** @fileoverview 信息牌开关状态的配置归一化与精确值匹配。 */
import { oneOf } from './normalizeShared'
import { isRecord, trimmedString } from './sanitize'
import { TWIN_PANEL_STATE_TONES } from './types'
import type {
  TwinPanelFieldKind,
  TwinPanelState,
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
  state: 'on' | 'off' | 'unknown'
  label: string
  tone: TwinPanelStateTone
}

/** 字段是否显示开关状态。 */
export function panelKindUsesState(kind: TwinPanelFieldKind): boolean {
  return kind === 'status' || kind === 'switch'
}

function stateCode(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw === 'boolean') return String(raw)
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return fallback
}

/** 归一化两态文案与颜色，保留空编码供编辑器诊断。 */
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
  }
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

/** 编码为空或规范化后重合时，两态无法区分。 */
export function panelStateValuesConflict(config: TwinPanelState): boolean {
  const on = valueKey(config.onValue)
  const off = valueKey(config.offValue)
  return on === null || off === null || on === off
}

/** 按显式编码匹配状态；不把缺失值或其他非零值猜成开关状态。 */
export function panelFieldState(
  config: TwinPanelState | undefined,
  value: unknown,
): PanelStateReading {
  const state = config ?? DEFAULT_PANEL_STATE
  const key = valueKey(value)
  if (key !== null && !panelStateValuesConflict(state)) {
    if (key === valueKey(state.onValue)) {
      return { state: 'on', label: state.onLabel, tone: state.onTone }
    }
    if (key === valueKey(state.offValue)) {
      return { state: 'off', label: state.offLabel, tone: state.offTone }
    }
  }
  return { state: 'unknown', label: state.unknownLabel, tone: 'neutral' }
}
