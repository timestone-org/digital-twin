/** @fileoverview 可视能源计量保持十进制文本，拒绝重复计量、不完整行与非法拓扑。 */
import { expect, it } from 'vitest'
import {
  defaultEnergyRows,
  energyPayload,
  energyRowOf,
  energyRowsError,
} from '@/pages/Modeling/Canvas/scripts/energyRuleRows'
import {
  mappingFields,
  parameterFields,
  recordOf,
  ruleConfigError,
  ruleOf,
  textOf,
} from '@/pages/Modeling/Canvas/scripts/energyRuleForm'

function topology(values: Record<string, unknown>[]) {
  return values.map((value, index) =>
    energyRowOf(value, `row-${index}`, 'topology'),
  )
}
function meters(values: Record<string, unknown>[]) {
  return values.map((value, index) =>
    energyRowOf(value, `row-${index}`, 'meters'),
  )
}
const edge = {
  source: '进线',
  target: '生产',
  column: '电量',
  unit: 'kWh',
  efficiency: '1',
}
const meter = {
  category: '生产',
  column: '电量',
  unit: 'kWh',
  standard_coal_factor: '0.1229',
}
it('缺省计量与流向可执行，十进制文本原样输出', () => {
  expect(energyRowsError(meters(defaultEnergyRows('meters')), 'meters')).toBe(
    '',
  )
  expect(
    energyRowsError(topology(defaultEnergyRows('topology')), 'topology'),
  ).toBe('')
  const rows = meters([{ ...meter, standard_coal_factor: '0.123456789012' }])
  expect(energyPayload(rows, 'meters')).toEqual([
    { ...meter, standard_coal_factor: '0.123456789012' },
  ])
  expect(energyPayload(topology([edge]), 'topology')).toEqual([edge])
})
it.each([
  [{}, '请完善'],
  [{ ...meter, category: 'a'.repeat(65) }, '过长'],
  [{ ...meter, column: 'a'.repeat(129) }, '过长'],
  [{ ...meter, unit: 'a'.repeat(33) }, '过长'],
  [{ ...meter, standard_coal_factor: '0' }, '之间'],
  [{ ...meter, standard_coal_factor: '1000001' }, '之间'],
  [{ ...meter, standard_coal_factor: 'bad' }, '十进制'],
  [{ ...meter, standard_coal_factor: '0.1234567890123' }, '12 位'],
])('非法计量行明确指出问题 %j', (value, message) => {
  expect(energyRowsError(meters([value]), 'meters')).toContain(message)
})
it('重复列和过多计量行被拒绝', () => {
  expect(energyRowsError(meters([meter, meter]), 'meters')).toContain(
    '不能重复',
  )
  expect(
    energyRowsError(meters(Array.from({ length: 33 }, () => meter)), 'meters'),
  ).toContain('32 行')
})
it('能源流向拒绝自环、多节点环、混合单位和重复边', () => {
  expect(
    energyRowsError(topology([{ ...edge, target: '进线' }]), 'topology'),
  ).toContain('不能相同')
  expect(
    energyRowsError(
      topology([
        edge,
        { ...edge, source: '生产', target: '进线', column: '回流' },
      ]),
      'topology',
    ),
  ).toContain('环路')
  expect(
    energyRowsError(
      topology([edge, { ...edge, target: '空调', column: '冷量', unit: 'MJ' }]),
      'topology',
    ),
  ).toContain('相同单位')
  expect(
    energyRowsError(
      topology([edge, { ...edge, column: '重复边' }]),
      'topology',
    ),
  ).toContain('重复连线')
  expect(
    energyRowsError(topology([{ ...edge, efficiency: '1.1' }]), 'topology'),
  ).toContain('不超过 1')
})
it('八类规则映射与参数仅选择当前业务所需内容', () => {
  expect(mappingFields('unit_consumption').map((field) => field.key)).toEqual([
    'energy',
    'output',
  ])
  expect(mappingFields('supply_diagnosis').map((field) => field.key)).toEqual([
    'voltage',
    'frequency',
    'pressure',
    'flow',
  ])
  expect(mappingFields('energy_aggregation')).toEqual([])
  for (const kind of [
    'hvac_compliance',
    'efficiency_fluctuation',
    'energy_aggregation',
    'energy_trace',
    'unit_consumption',
    'efficiency_benchmark',
    'equipment_efficiency',
    'supply_diagnosis',
  ])
    expect(ruleOf(kind).hint).not.toContain('请选择')
  expect(ruleOf('unknown').hint).toContain('请选择')
  expect(
    parameterFields(
      {
        $defs: {
          EnergyRuleParameters: {
            properties: {
              temperature_min: { type: 'number', default: 18 },
              decimal_places: { type: 'integer', default: 6 },
              cop_min: { type: 'number', default: 3.2 },
            },
          },
        },
      },
      'hvac_compliance',
    ).map((field) => field.key),
  ).toEqual(['temperature_min', 'decimal_places'])
})
it('业务映射重复与阈值倒置会显示就地错误', () => {
  expect(
    ruleConfigError(
      { fields: { temperature: '同一列', humidity: '同一列' } },
      'hvac_compliance',
      {},
    ),
  ).toContain('不能使用同一列')
  expect(
    ruleConfigError({ fields: { temperature: '' } }, 'hvac_compliance', {}),
  ).toContain('不能为空')
  const schema = {
    $defs: {
      EnergyRuleParameters: {
        properties: {
          temperature_min: { type: 'number', default: 18 },
          temperature_max: { type: 'number', default: 26 },
          benchmark_good_ratio: { type: 'number', default: 1 },
          benchmark_warning_ratio: { type: 'number', default: 1.1 },
        },
      },
    },
  }
  expect(
    ruleConfigError(
      { parameters: { temperature_min: 30 } },
      'hvac_compliance',
      schema,
    ),
  ).toContain('不能大于')
  expect(
    ruleConfigError(
      { parameters: { benchmark_good_ratio: 2 } },
      'efficiency_benchmark',
      schema,
    ),
  ).toContain('不能大于')
  expect(ruleConfigError({}, 'hvac_compliance', schema)).toBe('')
  expect(recordOf(null)).toEqual({})
  expect(recordOf([])).toEqual({})
  expect(textOf(3)).toBe('3')
})
