/**
 * @fileoverview 守 `defineCardPart` 只做的那两件事：键前缀化、条件补 kind。
 *
 * ⚠ 这两件都是**作者漏了不会报错**的：漏前缀 → 两个部件的 `color` 共用一个取值，
 * 改这个另一个跟着变；漏 kind 条件 → 别档的字段串到这一档的表单里。
 */
import { describe, expect, it } from 'vitest'

import {
  CARD_PART_KIND_KEY,
  defineCardPart,
  partConfigOf,
  partFieldKey,
} from '../../src/cardParts/define'

const NOOP = () => Promise.resolve({ default: {} })

function meter() {
  return defineCardPart({
    kind: 'meter',
    label: '进度条',
    icon: 'gauge',
    hint: '把读数画成一条占比。',
    slots: ['value', 'ratio'],
    fields: [
      { key: 'color', label: '颜色', type: 'color', default: '' },
      {
        key: 'showTarget',
        label: '显示目标线',
        type: 'boolean',
        default: false,
      },
      {
        key: 'target',
        label: '目标值',
        type: 'number',
        default: 0,
        when: { key: 'showTarget', in: [true] },
      },
    ],
    component: NOOP,
  })
}

describe('键前缀化', () => {
  it('顶层键都加上了档名前缀', () => {
    expect(meter().fields.map((one) => one.key)).toEqual([
      'meter-color',
      'meter-showTarget',
      'meter-target',
    ])
  })

  it('前缀用 `-` 不用 `.`——仓里有按点号切配置路径的地方', () => {
    expect(partFieldKey('meter', 'color')).toBe('meter-color')
  })

  // ⚠ 子作用域跟着前缀化的话，子字段的条件会指空，那个子字段就永远不出现
  it('object 的子字段与 array 的行字段一律不动', () => {
    const part = defineCardPart({
      kind: 'demo',
      label: '演示',
      icon: 'gauge',
      hint: '演示。',
      slots: [],
      fields: [
        {
          key: 'box',
          label: '盒',
          type: 'object',
          fields: [
            { key: 'size', label: '大小', type: 'number', default: 1 },
            {
              key: 'gap',
              label: '间距',
              type: 'number',
              default: 1,
              when: { key: 'size', in: [2] },
            },
          ],
        },
      ],
      component: NOOP,
    })
    const [box] = part.fields

    expect(box?.key).toBe('demo-box')
    expect(box?.fields?.map((one) => one.key)).toEqual(['size', 'gap'])
    expect(box?.fields?.[1]?.when).toEqual({ key: 'size', in: [2] })
  })
})

describe('kind 条件', () => {
  it('没有自己 when 的字段补上 kind 条件', () => {
    const [color] = meter().fields

    expect(color?.when).toEqual({ key: CARD_PART_KIND_KEY, in: ['meter'] })
  })

  /**
   * ⚠ 有自己 `when` 的字段**不再补** kind 条件——`ConfigFieldCondition` 只判一个键。
   * 它靠沿 `when` 链上溯拿到：`meter-target` → `meter-showTarget` → `kind`。
   * 所以那个 `when.key` 必须一起前缀化，否则指向一个不存在的键、条件恒不满足，
   * 那个字段**永远不出现**，而 typecheck 与 lint 双双放行。
   */
  it('作者自己写的 when 里那个键也前缀化，链式上溯才接得上', () => {
    const target = meter().fields.find((one) => one.key === 'meter-target')

    expect(target?.when).toEqual({ key: 'meter-showTarget', in: [true] })
  })

  it('链条真的接得上：那一环自己带着 kind 条件', () => {
    const fields = meter().fields
    const target = fields.find((one) => one.key === 'meter-target')
    const parent = fields.find((one) => one.key === target?.when?.key)

    expect(parent?.when).toEqual({ key: CARD_PART_KIND_KEY, in: ['meter'] })
  })
})

describe('去前缀', () => {
  it('只留这一档自己的键，且键名去掉前缀', () => {
    const row = {
      kind: 'meter',
      'meter-color': '#f00',
      'value-size': 24,
      label: '甲',
    }

    expect(partConfigOf('meter', row)).toEqual({ color: '#f00' })
  })

  it('这一档一个键都没配时给空对象，不给 undefined', () => {
    expect(partConfigOf('meter', { kind: 'meter' })).toEqual({})
  })

  // ⚠ 部件看得见别档的键，就会有人去读它，两档从此耦死
  it('别档的键一个都不漏进来', () => {
    const row = { 'badge-color': '#0f0', 'meter-color': '#f00' }

    expect(partConfigOf('badge', row)).toEqual({ color: '#0f0' })
  })
})
