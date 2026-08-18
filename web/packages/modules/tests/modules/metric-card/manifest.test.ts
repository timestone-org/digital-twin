/**
 * @fileoverview 守实时数值模块的清单声明：绑定槽的形状、行数跟着指标走、
 * 自报逐格状态，以及枚举取值与组件里的白名单是同一份。
 * ⚠ 这几条写错都不报错：绑点面板会摆出永远喂不到东西的行，或者整块被浮层盖住。
 */
import { describe, expect, it } from 'vitest'

import manifest from '../../../src/modules/metric-card/manifest'
import {
  METRIC_SLOT_KEY,
  metricFieldKey,
} from '../../../src/modules/metric-card/metrics'

function field(key: string) {
  return manifest.configSchema.find((item) => item.key === key)
}

function itemField(key: string) {
  return field('items')?.itemSchema?.find((item) => item.key === key)
}

function optionValues(key: string): unknown[] {
  return (field(key)?.options ?? []).map((option) => option.value)
}

describe('实时数值清单的身份', () => {
  it('是数据模块，套卡片框，不是容器也不钉区域', () => {
    expect(manifest.type).toBe('metric-card')
    expect(manifest.category).toBe('数据')
    expect(manifest.chrome).toBeUndefined()
    expect(manifest.isContainer).toBeUndefined()
    expect(manifest.region).toBeUndefined()
  })

  it('自报逐格交代状态：坏掉一格不该把另外几格一起盖住', () => {
    expect(manifest.ownsStatusDisplay).toBe(true)
  })

  it('格内点击与整块可点同时开，格内因此必须吞冒泡', () => {
    expect(manifest.emitsInteractions).toBe(true)
    expect(manifest.hostClickable).toBe(true)
  })

  it('每个顶层配置字段都有缺省，摊得出一份完整配置', () => {
    const missing = manifest.configSchema
      .filter((item) => item.default === undefined)
      .map((item) => item.key)

    expect(missing).toEqual([])
  })
})

describe('实时数值清单的绑定槽', () => {
  it('是行钉在指标上的数组槽——绑一部分指标是常态', () => {
    expect(manifest.bindings).toHaveLength(1)
    expect(manifest.bindings[0]).toMatchObject({
      key: METRIC_SLOT_KEY,
      isArray: true,
      isEntityPinned: true,
    })
    expect(manifest.bindings[0]?.arrayFields).toEqual([
      { key: 'value', label: '读数', dataType: 'number' },
    ])
  })

  it('行数跟着指标列表走，面板因此不摆「新增一行」', () => {
    const counts = manifest.bindingRowCounts?.({
      items: [{ label: 'A' }, { label: 'B' }],
    })

    expect(counts).toEqual({ [METRIC_SLOT_KEY]: 2 })
  })

  it('没配过指标时也要给 0，不许把槽键漏掉', () => {
    expect(manifest.bindingRowCounts?.({})).toEqual({ [METRIC_SLOT_KEY]: 0 })
  })

  it('行名与行 id 都给，两个同名指标才分得开', () => {
    const labels = manifest.bindingRowLabels?.({
      items: [{ label: '温度', key: 'T1' }],
    })

    expect(labels?.[metricFieldKey(0)]).toEqual({ title: '温度', id: 'T1' })
  })
})

describe('实时数值清单的取值范围', () => {
  it('三档排布与组件里的白名单逐一对上', () => {
    expect(optionValues('layout')).toEqual(['auto', 'grid', 'list'])
    expect(optionValues('align')).toEqual(['left', 'center'])
    expect(optionValues('density')).toEqual(['compact', 'normal', 'loose'])
  })

  it('值的三档类型与取值逻辑里的白名单逐一对上', () => {
    expect((itemField('kind')?.options ?? []).map((one) => one.value)).toEqual([
      'number',
      'boolean',
      'text',
    ])
  })

  it('阈值边界刻意不给缺省：给了就等于每个指标出厂自带告警线', () => {
    for (const key of [
      'dangerBelow',
      'warnBelow',
      'warnAbove',
      'dangerAbove',
    ]) {
      expect(itemField(key)?.default).toBeUndefined()
    }
  })

  it('只有开关量那一档才摆真假文案，数值档才摆小数位', () => {
    expect(itemField('trueText')?.when).toEqual({
      key: 'kind',
      in: ['boolean'],
    })
    expect(itemField('precision')?.when).toEqual({
      key: 'kind',
      in: ['number'],
    })
  })

  it('列数只在网格档露出来，自动档的列数由项数定', () => {
    expect(field('columns')?.when).toEqual({ key: 'layout', in: ['grid'] })
  })

  it('出厂带一项指标：空列表是一块看着像坏了的白板', () => {
    expect(field('items')?.default).toHaveLength(1)
    expect(field('items')?.minItems).toBe(1)
  })
})
