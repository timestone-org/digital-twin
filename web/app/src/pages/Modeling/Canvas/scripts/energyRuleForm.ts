/** @fileoverview 能源规则的业务标签、条件字段与可视计量行校验。 */
import type { FormField } from './schemaForm'
import { fieldsOf } from './schemaForm'

interface RulePresentation {
  hint: string
  columns: readonly (readonly [string, string])[]
  parameters: readonly string[]
}
const RULES: Readonly<Record<string, RulePresentation>> = {
  hvac_compliance: {
    hint: '按本次温湿度判断是否达标，不预测开机达标时长。',
    columns: [
      ['temperature', '温度'],
      ['humidity', '湿度'],
    ],
    parameters: [
      'temperature_min',
      'temperature_max',
      'humidity_min',
      'humidity_max',
    ],
  },
  efficiency_fluctuation: {
    hint: '比较同口径的当前能效与基准能效，输出变化百分比。',
    columns: [
      ['current_efficiency', '当前能效'],
      ['reference_efficiency', '基准能效'],
    ],
    parameters: ['fluctuation_threshold_pct'],
  },
  energy_aggregation: {
    hint: '归集同期间的消耗量；累计表读数应先计算差值。折标系数须按现场业务确认。',
    columns: [],
    parameters: [],
  },
  energy_trace: {
    hint: '按有向流量核对来源、去向与计量差额；所有边使用相同能源单位。',
    columns: [],
    parameters: ['balance_tolerance'],
  },
  unit_consumption: {
    hint: '单位能耗 = 同期间能耗 ÷ 产量；产量必须大于零。',
    columns: [
      ['energy', '能耗'],
      ['output', '产量'],
    ],
    parameters: [],
  },
  efficiency_benchmark: {
    hint: '比较实际与对标单位能耗；比值越低越好。',
    columns: [
      ['actual_intensity', '实际单位能耗'],
      ['benchmark_intensity', '对标单位能耗'],
    ],
    parameters: ['benchmark_good_ratio', 'benchmark_warning_ratio'],
  },
  equipment_efficiency: {
    hint: '设备能效 = 有效输出 ÷ 输入功率；使用同期间、相同功率单位的数据。',
    columns: [
      ['useful_output', '制冷量'],
      ['input_power', '输入功率'],
    ],
    parameters: ['cop_min'],
  },
  supply_diagnosis: {
    hint: '检测已测量指标是否越界，不推断未观测到的故障原因。',
    columns: [
      ['voltage', '电压'],
      ['frequency', '频率'],
      ['pressure', '压力'],
      ['flow', '流量'],
    ],
    parameters: [
      'voltage_min',
      'voltage_max',
      'frequency_min',
      'frequency_max',
      'pressure_min',
      'pressure_max',
      'flow_min',
      'flow_max',
    ],
  },
}
const PARAMETER_LABELS: Readonly<Record<string, string>> = {
  temperature_min: '温度下限（℃）',
  temperature_max: '温度上限（℃）',
  humidity_min: '湿度下限（%）',
  humidity_max: '湿度上限（%）',
  fluctuation_threshold_pct: '波动阈值（%）',
  benchmark_good_ratio: '良好比值上限',
  benchmark_warning_ratio: '预警比值上限',
  cop_min: '能效最低值（COP）',
  balance_tolerance: '流量平衡容差',
  voltage_min: '电压下限（V）',
  voltage_max: '电压上限（V）',
  frequency_min: '频率下限（Hz）',
  frequency_max: '频率上限（Hz）',
  pressure_min: '压力下限（MPa）',
  pressure_max: '压力上限（MPa）',
  flow_min: '流量下限',
  flow_max: '流量上限',
  decimal_places: '结果小数位数',
}

export function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return {}
  return Object.fromEntries(Object.entries(value))
}
export function textOf(value: unknown, fallback = ''): string {
  return typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : fallback
}
export function ruleOf(kind: string): RulePresentation {
  return (
    RULES[kind] ?? {
      hint: '请选择可用的规则类型。',
      columns: [],
      parameters: [],
    }
  )
}
export function mappingFields(kind: string): FormField[] {
  return fieldsOf({
    properties: Object.fromEntries(
      ruleOf(kind).columns.map(([key, label]) => [
        key,
        {
          type: 'string',
          title: label,
          default: label,
          minLength: 1,
          maxLength: 128,
          'x-dt-widget': 'column',
          description: `选择用于“${label}”的上游数据列`,
        },
      ]),
    ),
  })
}
export function parameterFields(
  schema: Record<string, unknown>,
  kind: string,
): FormField[] {
  const definitions = recordOf(schema['$defs'])
  const parameters = recordOf(definitions['EnergyRuleParameters'])
  const keys = new Set([...ruleOf(kind).parameters, 'decimal_places'])
  return fieldsOf(parameters)
    .filter((field) => keys.has(field.key))
    .map((field) => ({
      ...field,
      label: PARAMETER_LABELS[field.key] ?? field.label,
    }))
}
export function ruleConfigError(
  config: Record<string, unknown>,
  kind: string,
  schema: Record<string, unknown>,
): string {
  const mappings = recordOf(config['fields'])
  const columns = ruleOf(kind).columns.map(([key, fallback]) =>
    textOf(mappings[key], fallback),
  )
  if (columns.some((column) => column.trim() === '')) return '业务列名不能为空'
  if (columns.length !== new Set(columns).size)
    return '不同业务指标不能使用同一列'
  const parameters = recordOf(config['parameters'])
  const fields = parameterFields(schema, kind)
  const valueOf = (key: string) =>
    parameters[key] ?? fields.find((field) => field.key === key)?.fallback
  for (const field of fields.filter((item) => item.key.endsWith('_min'))) {
    const lower = valueOf(field.key)
    const upper = valueOf(field.key.replace(/_min$/, '_max'))
    if (typeof lower === 'number' && typeof upper === 'number' && lower > upper)
      return `${field.label}不能大于对应上限`
  }
  const good = valueOf('benchmark_good_ratio')
  const warning = valueOf('benchmark_warning_ratio')
  return typeof good === 'number' &&
    typeof warning === 'number' &&
    good > warning
    ? '良好比值上限不能大于预警比值上限'
    : ''
}

/** 改一项能源规则参数；换了规则类型就一并清掉不再适用的列映射，一次写入。 */
export function changeEnergyConfig(
  config: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...config, [key]: value }
  if (key === 'kind' && config['kind'] !== value) next['fields'] = {}
  return next
}
