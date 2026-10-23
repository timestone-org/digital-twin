/** @fileoverview 规则模型公式说明保持业务公式与故障诊断边界。 */
import { describe, expect, it } from 'vitest'

import { formulaText } from '@/pages/Modeling/Canvas/scripts/formula'
import { formulasOf } from '@/pages/Modeling/Canvas/scripts/formulaCatalog'

describe('规则计算公式', () => {
  it.each([
    ['hvac_compliance', '达标范围逐项判断', 'pass'],
    ['efficiency_fluctuation', '相对基准的能效波动', 'reference'],
    ['energy_aggregation', '分类计量与折标归集', 'standard'],
    ['energy_trace', '路径能量与节点平衡', 'balance'],
    ['unit_consumption', '单位产量能耗', 'E / Q'],
    ['efficiency_benchmark', '单位能耗对标偏差', 'benchmark'],
    ['equipment_efficiency', '设备能效系数', 'COP'],
    ['supply_diagnosis', '能源供应指标越界诊断', 'abnormal'],
  ])('%s 显示对应业务公式', (kind, title, symbol) => {
    const spec = formulasOf('energy_rules', {
      blocks: [],
      ports: [],
      config: { kind },
    })[0]
    expect(spec?.title).toBe(title)
    expect(formulaText(spec?.symbolic ?? [])).toContain(symbol)
    expect(spec?.isOpen).toBe(false)
  })
  it('供应诊断只报告规则越界', () => {
    const spec = formulasOf('energy_rules', {
      blocks: [],
      ports: [],
      config: { kind: 'supply_diagnosis' },
    })[0]
    expect(spec?.notes.join('')).toContain('不推断未观测的故障根因')
  })
  it('配置缺席仍保留公式与下一步说明', () => {
    const spec = formulasOf('energy_rules', {
      blocks: [],
      ports: [],
      config: {},
    })[0]
    expect(spec?.symbolic.length).toBeGreaterThan(0)
    expect(spec?.fallback).toContain('规则配置')
  })
})
