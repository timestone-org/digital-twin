/** @fileoverview 归集、核算、追溯和诊断的确定性规则模板。 */
import type { ModelingGraph } from '@dt/contracts'

interface RuleTemplate {
  kind: string
  label: string
  hint: string
  fields: Record<string, string>
  parameters: Record<string, number>
  columns?: readonly string[]
}

const METERS = ['生产', '空调', '照明'].map((category) => ({
  category,
  column: `${category}电量`,
  unit: 'kWh',
  standard_coal_factor: '0.1229',
}))
const TOPOLOGY = [
  {
    source: '进线',
    target: '配电中心',
    column: '总供能',
    efficiency: '1',
    unit: 'kWh',
  },
  ...['生产', '空调', '照明'].map((target) => ({
    source: '配电中心',
    target,
    column: `${target}供能`,
    efficiency: '1',
    unit: 'kWh',
  })),
]

const RULES: readonly RuleTemplate[] = [
  {
    kind: 'hvac_compliance',
    label: '空调机组达标检测模型',
    hint: '按温度与湿度的达标范围逐项判定，返回达标状态及未达标项目。此模板检测当前状态；开机达标时长使用空调管理中的专用管线。',
    fields: { temperature: '温度', humidity: '湿度' },
    parameters: {
      temperature_min: 18,
      temperature_max: 26,
      humidity_min: 40,
      humidity_max: 65,
    },
  },
  {
    kind: 'efficiency_fluctuation',
    label: '能效波动分析模型',
    hint: '比较当前能效与明确提供的基准能效，计算波动百分比并按阈值判定。基准可由台账统计提供；零基准会明确返回无法核算。',
    fields: {
      current_efficiency: '当前能效',
      reference_efficiency: '基准能效',
    },
    parameters: { fluctuation_threshold_pct: 10 },
  },
  {
    kind: 'energy_aggregation',
    label: '能耗分类归集模型',
    hint: '按配置的能源类别或用途归集各表计期间用量，并使用显式折标系数输出分类明细与总折标煤量。示例系数须按业务核算口径确认后调整。',
    fields: {},
    parameters: {},
    columns: METERS.map((meter) => meter.column),
  },
  {
    kind: 'energy_trace',
    label: '能源流向追溯模型',
    hint: '配置来源、去向与计量列，逐条返回能源路径、转换损耗及节点收支平衡。示例为进线到配电中心，再分向生产、空调、照明。',
    fields: {},
    parameters: { balance_tolerance: 0.01 },
    columns: TOPOLOGY.map((edge) => edge.column),
  },
  {
    kind: 'unit_consumption',
    label: '单位能耗核算模型',
    hint: '按同一期间的能耗除以产量精确核算单位能耗；零产量明确返回不可核算。能耗使用期间消耗量，产量使用同期合格产量。',
    fields: { energy: '能耗', output: '产量' },
    parameters: { decimal_places: 6 },
  },
  {
    kind: 'efficiency_benchmark',
    label: '能效对标分析模型',
    hint: '比较同类工况下的实际单位能耗与对标单位能耗，输出比值、偏差与等级。对标值须由业务确定，不混用不同量纲或不同工况。',
    fields: {
      actual_intensity: '实际单位能耗',
      benchmark_intensity: '对标单位能耗',
    },
    parameters: { benchmark_good_ratio: 1, benchmark_warning_ratio: 1.1 },
  },
  {
    kind: 'equipment_efficiency',
    label: '设备能效评估模型',
    hint: '制冷量除以输入功率得到 COP，并与配置下限比较。两项须来自同一时段且使用相同功率单位；零功率明确返回不可评估。',
    fields: { useful_output: '制冷量', input_power: '输入功率' },
    parameters: { cop_min: 3.2 },
  },
  {
    kind: 'supply_diagnosis',
    label: '能源供应异常诊断模型',
    hint: '对电压、频率、压力与流量按上下限逐项诊断，返回命中的异常代码和判定依据。诊断描述指标越界，不推断未配置的故障根因。',
    fields: {
      voltage: '电压',
      frequency: '频率',
      pressure: '压力',
      flow: '流量',
    },
    parameters: {
      voltage_min: 209,
      voltage_max: 231,
      frequency_min: 49.5,
      frequency_max: 50.5,
      pressure_min: 0.45,
      pressure_max: 0.7,
      flow_min: 80,
      flow_max: 120,
    },
  },
]

function graphOf(rule: RuleTemplate): ModelingGraph {
  const config: Record<string, unknown> = {
    kind: rule.kind,
    fields: { ...rule.fields },
    parameters: { ...rule.parameters },
  }
  if (rule.kind === 'energy_aggregation')
    config['meters'] = structuredClone(METERS)
  if (rule.kind === 'energy_trace')
    config['topology'] = structuredClone(TOPOLOGY)
  return {
    format_version: '1.0',
    nodes: [
      {
        id: 's',
        operator: 'ledger_source',
        alias: '选择业务数据台账',
        config: {
          table_code: '',
          columns: [...(rule.columns ?? Object.values(rule.fields))],
          row_source: 'manual',
          since: '-30d',
        },
        position: { left: 80, top: 180 },
      },
      {
        id: 'm',
        operator: 'energy_rules',
        alias: rule.label,
        config,
        position: { left: 400, top: 180 },
      },
    ],
    edges: [
      {
        id: 's_frame_m_frame',
        from_node: 's',
        from_port: 'frame',
        to_node: 'm',
        to_port: 'frame',
      },
    ],
  }
}

export const ENERGY_RULE_TEMPLATES = RULES.map((rule) => ({
  key: `rule_${rule.kind}`,
  label: rule.label,
  hint: `选择台账并调整取数列和规则列映射。${rule.hint} 运行后可直接发布并部署，无需训练目标。`,
  build: () => graphOf(rule),
}))
