/**
 * @fileoverview 守演示绑定的槽键与真绑定同形——键的形状一旦分叉，预览里好好的
 * 一格到了画布上就喂不到值，而两边都不报错。
 */
import type { BindingSpec } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import { previewBindings } from '@/features/dashboard/previewBindings'

const SPECS: BindingSpec[] = [
  { key: 'total', label: '总量', dataType: 'number' },
  {
    key: 'rows',
    label: '行',
    dataType: 'number',
    isArray: true,
    arrayFields: [
      { key: 'value', label: '主读数', dataType: 'number' },
      { key: 'aux', label: '对比值', dataType: 'number' },
    ],
  },
]

describe('演示值摊成常量绑定', () => {
  it('没有 preview 段就一条都不造', () => {
    expect(previewBindings(SPECS, undefined)).toEqual([])
    expect(previewBindings(SPECS, { config: { title: '甲' } })).toEqual([])
  })

  it('普通槽一条，槽键就是槽名', () => {
    const [binding] = previewBindings(SPECS, { values: { total: 42 } })

    expect(binding?.fieldKey).toBe('total')
    expect(binding?.sourceKind).toBe('static')
    expect(binding?.staticValueJson).toBe(42)
  })

  it('数组槽按行摊开，槽键与画布上的逐字同形', () => {
    const bindings = previewBindings(SPECS, {
      values: { rows: [{ value: 1, aux: 2 }, { value: 3 }] },
    })

    expect(bindings.map((one) => one.fieldKey)).toEqual([
      'rows[0].value',
      'rows[0].aux',
      'rows[1].value',
    ])
    expect(bindings.map((one) => one.staticValueJson)).toEqual([1, 2, 3])
  })

  it('行是标量时整行一条，不硬套子槽名', () => {
    const bindings = previewBindings(SPECS, { values: { rows: ['甲', '乙'] } })

    expect(bindings.map((one) => one.fieldKey)).toEqual(['rows[0]', 'rows[1]'])
  })

  // ⚠ `preview.values` 是人手写的：键写错就该被丢掉，而不是造出一条
  //   永远喂不到任何模块的绑定
  it('清单里没有的槽名一律丢掉', () => {
    expect(previewBindings(SPECS, { values: { totl: 42 } })).toEqual([])
  })

  // ⚠ 常量绑定的读取器把 null 判成「没配常量值」的 error，预览上会画成一格红字，
  //   而作者的本意是「这一槽留空」
  it('留空的槽不造绑定，免得预览上出现一格红字', () => {
    expect(previewBindings(SPECS, { values: { total: null } })).toEqual([])
    expect(previewBindings(SPECS, { values: { total: undefined } })).toEqual([])
  })

  it('id 由槽键推出，同一份清单每次算出来一样', () => {
    const once = previewBindings(SPECS, { values: { total: 1 } })
    const twice = previewBindings(SPECS, { values: { total: 1 } })

    expect(once.map((one) => one.id)).toEqual(twice.map((one) => one.id))
    expect(new Set(once.map((one) => one.id)).size).toBe(once.length)
  })

  it('声明成数组的槽给了标量时不摊行，整槽一条', () => {
    const [binding] = previewBindings(SPECS, { values: { rows: 7 } })

    expect(binding?.fieldKey).toBe('rows')
  })
})
