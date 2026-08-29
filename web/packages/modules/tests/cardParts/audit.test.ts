/**
 * @fileoverview 守自检本身：**每条都得先证明它逮得住**，否则契约测试里那句
 * `expect(...).toEqual([])` 只是一句空转的漂亮话。
 *
 * 本仓吃过这个亏——每日闸门的变异测试从没真跑过，红了十几天没人看见。所以这里
 * 逐条造一个真有问题的输入，断言它被逮出来；再造一个干净的，断言它放行。
 */
import { describe, expect, it } from 'vitest'

import {
  danglingPartConditions,
  duplicateFieldKeys,
  fieldsWithoutKindCondition,
  incompleteParts,
  strayPartSlots,
} from '../../src/cardParts/audit'
import { CARD_PART_KIND_KEY, defineCardPart } from '../../src/cardParts/define'
import type {
  CardPartDefinition,
  CardPartInput,
} from '../../src/cardParts/types'

const NOOP = () => Promise.resolve({ default: {} })

function part(over: Partial<CardPartInput> = {}): CardPartDefinition {
  return defineCardPart({
    kind: 'meter',
    label: '进度条',
    icon: 'gauge',
    hint: '把读数画成一条占比。',
    slots: ['value'],
    fields: [{ key: 'color', label: '颜色', type: 'color', default: '' }],
    component: NOOP,
    ...over,
  })
}

describe('必填项', () => {
  it('齐了就放行', () => {
    expect(incompleteParts([part()])).toEqual([])
  })

  it('缺 icon 逮得住——菜单里没图标且不报错', () => {
    expect(incompleteParts([part({ icon: '' })])).toEqual(['meter.icon'])
  })

  it('缺 hint 逮得住——用户与模型都猜不出什么时候用它', () => {
    expect(incompleteParts([part({ hint: '  ' })])).toEqual(['meter.hint'])
  })

  it('加载器不是函数逮得住', () => {
    const broken = {
      ...part(),
      component: null,
    } as unknown as CardPartDefinition

    expect(incompleteParts([broken])).toEqual(['meter.component'])
  })
})

describe('字段键重名', () => {
  it('两个部件各有自己的前缀，不重名', () => {
    expect(duplicateFieldKeys([part(), part({ kind: 'badge' })])).toEqual([])
  })

  // ⚠ 重名的后果是两个部件共用一个取值：改这个的颜色，另一个跟着变
  it('同档登记两次导致的重名逮得住', () => {
    expect(duplicateFieldKeys([part(), part()])).toEqual(['meter-color'])
  })
})

describe('指空的条件', () => {
  it('正常的链条放行', () => {
    expect(danglingPartConditions([part()], [CARD_PART_KIND_KEY])).toEqual([])
  })

  // ⚠ 指空 = 条件恒不满足 = 那个字段永远不出现，而两侧都不报错
  it('when 指向一个并不存在的键时逮得住', () => {
    const typo = part({
      fields: [
        { key: 'a', label: 'A', type: 'boolean', default: false },
        {
          key: 'b',
          label: 'B',
          type: 'number',
          default: 0,
          when: { key: 'aa', in: [true] },
        },
      ],
    })

    expect(danglingPartConditions([typo], [CARD_PART_KIND_KEY])).toEqual([
      'meter-b → meter-aa',
    ])
  })

  it('外层键（kind 与格级那几个）不算指空', () => {
    expect(danglingPartConditions([part()], [CARD_PART_KIND_KEY])).toEqual([])
  })
})

describe('子槽声明', () => {
  it('声明的槽都真有时放行', () => {
    expect(strayPartSlots([part()], ['value', 'aux'])).toEqual([])
  })

  // ⚠ 绑点面板提示接 A、部件其实读 B，用户接了半天没有值
  it('声明了一个不存在的槽时逮得住', () => {
    const bad = part({ slots: ['level'] as never })

    expect(strayPartSlots([bad], ['value', 'aux'])).toEqual(['meter.level'])
  })
})

describe('kind 条件挂得到', () => {
  it('直接挂的挂得到', () => {
    expect(fieldsWithoutKindCondition(part())).toEqual([])
  })

  it('沿 when 链上溯挂得到', () => {
    const chained = part({
      fields: [
        { key: 'on', label: '开', type: 'boolean', default: false },
        {
          key: 'size',
          label: '大小',
          type: 'number',
          default: 1,
          when: { key: 'on', in: [true] },
        },
      ],
    })

    expect(fieldsWithoutKindCondition(chained)).toEqual([])
  })

  // ⚠ 挂不到的字段在所有档下都出现：选了「进度条」却看见「徽章」的颜色
  it('手写的字段绕开 defineCardPart 时逮得住', () => {
    const raw: CardPartDefinition = {
      ...part(),
      fields: [{ key: 'meter-color', label: '颜色', type: 'color' }],
    }

    expect(fieldsWithoutKindCondition(raw)).toEqual(['meter-color'])
  })

  // ⚠ 清单是人写的，`a → b → a` 这种环写得出来；不记走过的键就是死循环
  it('条件成环时判成挂不到，而不是转不出来', () => {
    const looped: CardPartDefinition = {
      ...part(),
      fields: [
        {
          key: 'meter-a',
          label: 'A',
          type: 'boolean',
          when: { key: 'meter-b', in: [true] },
        },
        {
          key: 'meter-b',
          label: 'B',
          type: 'boolean',
          when: { key: 'meter-a', in: [true] },
        },
      ],
    }

    expect(fieldsWithoutKindCondition(looped)).toEqual(['meter-a', 'meter-b'])
  })
})
