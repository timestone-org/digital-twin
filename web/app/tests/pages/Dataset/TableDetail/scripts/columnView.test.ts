/**
 * @fileoverview 列配置那几格的取值口径：来源与聚合口径认不出时原样显示而不是
 * 藏起来、点位列的「来源详情」先说口径再说点位、顺序只按 order_index 排。
 */
import { describe, expect, it } from 'vitest'
import type { DatasetColumn } from '@dt/contracts'
import { DATASET_AGG_FUNCS } from '@dt/contracts'

import {
  AGG_OPTIONS,
  aggMeta,
  aggOptionsFor,
  sortByOrder,
  sourceDetail,
  sourceMeta,
  SOURCE_OPTIONS,
  typeLabel,
  TYPE_OPTIONS,
} from '@/pages/Dataset/TableDetail/scripts/columnView'

const STAMP = '2026-01-01T00:00:00.000Z'

function column(over: Partial<DatasetColumn> = {}): DatasetColumn {
  return {
    id: 'c1',
    table_id: 't1',
    key: 'inflow',
    name: '进水量',
    unit: 'm³',
    decimals: 2,
    data_type: 'number',
    source: 'manual',
    agg: 'avg',
    node_key: null,
    formula: null,
    formula_deps: null,
    order_index: 0,
    is_required: false,
    default_value: null,
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

describe('来源徽标', () => {
  it('三档来源各有自己的说法', () => {
    expect(sourceMeta('manual').label).toBe('人工录入')
    expect(sourceMeta('point').label).toBe('点位汇总')
    expect(sourceMeta('formula').label).toBe('公式计算')
  })

  it('⚠ 认不出的来源原样显示：显示成空白会被读成「这一列没配来源」', () => {
    const unknown = sourceMeta('modbus')
    expect(unknown.label).toBe('modbus')
    expect(unknown.hint).toContain('还不认识')
  })

  it('下拉选项由 contracts 的常量铺开，不是页面里另抄一份', () => {
    expect(SOURCE_OPTIONS.map((one) => one.value)).toEqual([
      'manual',
      'point',
      'formula',
    ])
  })
})

describe('聚合口径', () => {
  it('八档口径每一档都有一句能解释「这个数怎么算出来」的说明', () => {
    for (const agg of DATASET_AGG_FUNCS) {
      expect(aggMeta(agg).desc.length, agg).toBeGreaterThan(8)
    }
  })

  it('⚠ 认不出的口径退化成原始代码 + 通用说明，绝不隐藏这个选项', () => {
    const unknown = aggMeta('p95')
    expect(unknown.label).toBe('p95')
    expect(unknown.desc).toContain('后端新增')
  })

  it('增量说清了它是跨桶的，不是桶内首末之差', () => {
    expect(aggMeta('delta').desc).toContain('上一周期末值')
  })

  it('⚠ 编辑一列时，界面不认识的那一档也留在下拉里：不留就会被随手改掉', () => {
    const options = aggOptionsFor('p95')
    expect(options).toHaveLength(AGG_OPTIONS.length + 1)
    expect(options[options.length - 1]?.value).toBe('p95')
  })

  it('认得出的口径不多铺一条重复选项', () => {
    expect(aggOptionsFor('avg')).toHaveLength(AGG_OPTIONS.length)
  })

  it('下拉标签带上原始代码：文档、报错与导出表头里露出来的都是它', () => {
    expect(AGG_OPTIONS.map((one) => one.value)).toEqual([...DATASET_AGG_FUNCS])
    expect(AGG_OPTIONS[0]?.label).toContain('avg')
  })
})

describe('数据类型', () => {
  it('三档类型各有中文说法', () => {
    expect(TYPE_OPTIONS.map((one) => one.label)).toEqual([
      '数值',
      '文本',
      '布尔',
    ])
  })

  it('认不出的类型同样原样显示', () => {
    expect(typeLabel('json')).toBe('json')
  })
})

describe('来源详情那一格', () => {
  it('⚠ 点位列先摆聚合口径再摆点位：这一格的数是均值还是增量是头号疑问', () => {
    const detail = sourceDetail(
      column({ source: 'point', agg: 'delta', node_key: 'src1:meter.kwh' }),
    )
    expect(detail.aggLabel).toBe('增量')
    expect(detail.text).toBe('src1:meter.kwh')
    expect(detail.title.indexOf('增量')).toBeLessThan(
      detail.title.indexOf('src1:meter.kwh'),
    )
  })

  it('点位列还没绑点位时如实说，不显示成一个空格子', () => {
    const detail = sourceDetail(column({ source: 'point', node_key: null }))
    expect(detail.text).toBe('还没绑点位')
  })

  it('公式列摆公式原文，没写时也如实说', () => {
    expect(
      sourceDetail(column({ source: 'formula', formula: '{a}-{b}' })).text,
    ).toBe('{a}-{b}')
    expect(
      sourceDetail(column({ source: 'formula', formula: null })).text,
    ).toBe('还没写公式')
  })

  it('人工录入列不摆口径徽标——它压根没有聚合这回事', () => {
    expect(sourceDetail(column()).aggLabel).toBeNull()
    expect(sourceDetail(column()).text).toBe('人工填写')
  })
})

describe('列顺序', () => {
  it('按 order_index 排，不信任后端的返回次序', () => {
    const sorted = sortByOrder([
      column({ id: 'c2', order_index: 2 }),
      column({ id: 'c0', order_index: 0 }),
      column({ id: 'c1', order_index: 1 }),
    ])
    expect(sorted.map((one) => one.id)).toEqual(['c0', 'c1', 'c2'])
  })

  it('不就地改传进来的那份数组', () => {
    const given = [
      column({ id: 'c2', order_index: 2 }),
      column({ id: 'c0', order_index: 0 }),
    ]
    sortByOrder(given)
    expect(given.map((one) => one.id)).toEqual(['c2', 'c0'])
  })
})
