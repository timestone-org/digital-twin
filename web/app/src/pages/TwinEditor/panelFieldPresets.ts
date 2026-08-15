/**
 * @fileoverview 信息牌上的常用测点：加一个字段本来要填标签、单位、小数位三处，
 * 而现场牌子上写的多半就是这十来种量。
 * ⚠ 只预填展示口径，**不碰取数**——点位仍要自己绑，预设猜不出该接哪个点。
 */

/** 一种常用测点的展示口径。 */
export interface PanelFieldPreset {
  /** 稳定 id，用作菜单项键与测试断言。 */
  id: string
  label: string
  unit: string
  /** 小数位；null = 原样上屏，不做四舍五入。 */
  decimals: number | null
}

/**
 * 工业现场牌面上最常出现的量。顺序按出现频次，不按字母序——
 * 菜单是拿来点的，不是拿来查字典的。
 */
export const PANEL_FIELD_PRESETS: readonly PanelFieldPreset[] = [
  { id: 'temperature', label: '温度', unit: '℃', decimals: 1 },
  { id: 'pressure', label: '压力', unit: 'MPa', decimals: 2 },
  { id: 'flow', label: '流量', unit: 'm³/h', decimals: 1 },
  { id: 'level', label: '液位', unit: 'm', decimals: 2 },
  { id: 'power', label: '功率', unit: 'kW', decimals: 1 },
  { id: 'current', label: '电流', unit: 'A', decimals: 2 },
  { id: 'voltage', label: '电压', unit: 'V', decimals: 1 },
  { id: 'speed', label: '转速', unit: 'r/min', decimals: 0 },
  { id: 'frequency', label: '频率', unit: 'Hz', decimals: 2 },
  { id: 'opening', label: '开度', unit: '%', decimals: 0 },
  { id: 'runtime', label: '运行时长', unit: 'h', decimals: 1 },
  { id: 'status', label: '状态', unit: '', decimals: null },
]
