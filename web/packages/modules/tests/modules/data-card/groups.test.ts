/**
 * @fileoverview 契约：卡片的分组与逐格告警。
 *
 * ⚠ 两条最要紧：组序是**用户摆出来的顺序**（重排会让「洗浴/空调/采暖」变成别的
 * 样子，而配置一字没动），以及选不中的组名要回落而不是显示空白。
 */
import { describe, expect, it } from 'vitest'

import {
  UNGROUPED_LABEL,
  evaluateCells,
  pickGroup,
  toCardGroups,
} from '../../../src/modules/data-card/groups'
import { normalizeValueRules } from '../../../src/shared/valueRules'

describe('分组', () => {
  it('按名字聚起来，组里带着原表下标', () => {
    expect(toCardGroups(['洗浴', '空调', '洗浴'])).toEqual([
      { name: '洗浴', indexes: [0, 2] },
      { name: '空调', indexes: [1] },
    ])
  })

  // ⚠ 按字典序重排会让组的顺序凭空变了，而用户并没有动过配置
  it('组序是首次出现的顺序，不排序', () => {
    expect(
      toCardGroups(['采暖', '洗浴', '空调']).map((one) => one.name),
    ).toEqual(['采暖', '洗浴', '空调'])
  })

  it('没起分组名的归到「其他」，空白也算没起', () => {
    expect(toCardGroups(['', '  ', undefined]).map((one) => one.name)).toEqual([
      UNGROUPED_LABEL,
    ])
  })

  it('一个格都没有时没有组', () => {
    expect(toCardGroups([])).toEqual([])
  })
})

describe('挑组', () => {
  const GROUPS = toCardGroups(['甲', '乙'])

  it('挑得中就用它', () => {
    expect(pickGroup(GROUPS, '乙')).toBe('乙')
  })

  // ⚠ 写错一个字就整块空白，而两侧都不报错
  it('挑不中回落到第一组，不显示空', () => {
    expect(pickGroup(GROUPS, '丙')).toBe('甲')
    expect(pickGroup(GROUPS, '')).toBe('甲')
  })

  it('没有组时给空串', () => {
    expect(pickGroup([], '甲')).toBe('')
  })
})

describe('逐格告警', () => {
  const RULES = normalizeValueRules([
    { op: 'gt', value: 55, level: 'danger', label: '高温', blink: true },
    { op: 'gt', value: 40, level: 'warning', label: '偏高' },
  ])

  it('按声明序取首个命中', () => {
    expect(
      evaluateCells([60, 45, 10], RULES).map((one) => one.hit?.label),
    ).toEqual(['高温', '偏高', undefined])
  })

  it('闪烁跟着命中的那一条走', () => {
    expect(evaluateCells([60, 45], RULES).map((one) => one.blink)).toEqual([
      true,
      false,
    ])
  })

  // ⚠ 十几格 × 八条规则每帧都算是白烧，而绝大多数卡片一条规则都没有
  it('规则表为空时逐格都不命中', () => {
    expect(evaluateCells([60, 45], [])).toEqual([
      { hit: null, blink: false },
      { hit: null, blink: false },
    ])
  })

  it('缺值与非数一律不命中', () => {
    expect(
      evaluateCells([undefined, '很热', null], RULES).map((one) => one.hit),
    ).toEqual([null, null, null])
  })
})
