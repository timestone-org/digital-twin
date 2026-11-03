/** @fileoverview 分类计量与有向能流的文本行转换、默认示例与边界检查。 */
import { recordOf, textOf } from './energyRuleForm'

export type EnergyRowsMode = 'meters' | 'topology'
export interface EnergyRow {
  id: string
  category: string
  source: string
  target: string
  column: string
  unit: string
  decimal: string
}
export function defaultEnergyRows(
  mode: EnergyRowsMode,
): Record<string, string>[] {
  if (mode === 'meters')
    return ['生产', '空调', '照明'].map((category) => ({
      category,
      column: `${category}电量`,
      unit: 'kWh',
      standard_coal_factor: '0.1229',
    }))
  return [
    {
      source: '进线',
      target: '配电中心',
      column: '总供能',
      unit: 'kWh',
      efficiency: '1',
    },
    ...['生产', '空调', '照明'].map((target) => ({
      source: '配电中心',
      target,
      column: `${target}供能`,
      unit: 'kWh',
      efficiency: '1',
    })),
  ]
}
export function energyRowOf(
  value: unknown,
  id: string,
  mode: EnergyRowsMode,
): EnergyRow {
  const row = recordOf(value)
  return {
    id,
    category: textOf(row['category']),
    source: textOf(row['source']),
    target: textOf(row['target']),
    column: textOf(row['column']),
    unit: textOf(row['unit'], 'kWh'),
    decimal: textOf(
      row[mode === 'meters' ? 'standard_coal_factor' : 'efficiency'],
      mode === 'meters' ? '0.1229' : '1',
    ),
  }
}
export function energyPayload(
  rows: readonly EnergyRow[],
  mode: EnergyRowsMode,
): Record<string, string>[] {
  return rows.map((row) =>
    mode === 'meters'
      ? {
          category: row.category,
          column: row.column,
          unit: row.unit,
          standard_coal_factor: row.decimal,
        }
      : {
          source: row.source,
          target: row.target,
          column: row.column,
          unit: row.unit,
          efficiency: row.decimal,
        },
  )
}
export function energyRowsError(
  rows: readonly EnergyRow[],
  mode: EnergyRowsMode,
): string {
  if (rows.length > 32) return '最多配置 32 行'
  for (const [index, row] of rows.entries()) {
    const message = rowError(row, mode)
    if (message) return `第 ${index + 1} 行：${message}`
  }
  if (new Set(rows.map((row) => row.column)).size !== rows.length)
    return '计量列不能重复使用'
  return mode === 'topology' ? topologyError(rows) : ''
}
function rowError(row: EnergyRow, mode: EnergyRowsMode): string {
  const names = mode === 'meters' ? [row.category] : [row.source, row.target]
  if ([...names, row.column, row.unit].some((value) => !value.trim()))
    return '请完善名称、计量列与单位'
  if (
    names.some((value) => value.length > 64) ||
    row.column.length > 128 ||
    row.unit.length > 32
  )
    return '名称、列名或单位过长'
  if (mode === 'topology' && row.source === row.target)
    return '来源节点与去向节点不能相同'
  return decimalError(row.decimal, mode)
}
function decimalError(decimal: string, mode: EnergyRowsMode): string {
  if (!/^\d+(\.\d{1,12})?$/.test(decimal))
    return '系数须为正十进制数，最多 12 位小数'
  const value = Number(decimal)
  if (value < 1e-12 || value > (mode === 'meters' ? 1000000 : 1))
    return mode === 'meters'
      ? '折标系数须在 0.000000000001 到 1000000 之间'
      : '传输效率须大于零且不超过 1'
  const digits = decimal.replace('.', '').replace(/^0+/, '').length
  if (digits > (mode === 'meters' ? 20 : 13)) return '系数的有效位数过多'
  return ''
}
function topologyError(rows: readonly EnergyRow[]): string {
  if (new Set(rows.map((row) => row.unit)).size > 1)
    return '所有能源流向必须使用相同单位'
  if (
    new Set(rows.map((row) => JSON.stringify([row.source, row.target])))
      .size !== rows.length
  )
    return '来源与去向之间不能重复连线'
  const nodes = new Set(rows.flatMap((row) => [row.source, row.target]))
  if (nodes.size > 32) return '能源流向最多包含 32 个节点'
  const remaining = new Set(nodes)
  const paths = new Map<string, number>()
  while (remaining.size > 0) {
    const ready = [...remaining].filter((node) =>
      rows.every((row) => row.target !== node || !remaining.has(row.source)),
    )
    if (ready.length === 0) return '能源流向不能包含环路'
    for (const node of ready) {
      const incoming = rows.filter((row) => row.target === node)
      paths.set(
        node,
        incoming.length
          ? incoming.reduce((sum, row) => sum + (paths.get(row.source) ?? 1), 0)
          : 1,
      )
      remaining.delete(node)
    }
  }
  const total = [...nodes]
    .filter((node) => rows.every((row) => row.source !== node))
    .reduce((sum, node) => sum + (paths.get(node) ?? 0), 0)
  return total > 256 ? '能源流向最多包含 256 条完整路径' : ''
}
