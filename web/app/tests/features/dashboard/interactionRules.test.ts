/**
 * @fileoverview 规则解析契约：坏条目丢弃、好条目保留，一条脏规则不拖哑整屏。
 */
import { describe, expect, it } from 'vitest'

import { parseInteractionRules } from '@/features/dashboard/interactionRules'

const GOOD = {
  id: 'r1',
  source: { nodeId: 'btn', event: 'click' },
  action: { type: 'toggle', targets: ['panel'] },
}

describe('整体形状', () => {
  it('缺键或不是数组给空表', () => {
    expect(parseInteractionRules({})).toEqual([])
    expect(parseInteractionRules({ interactions: '坏' })).toEqual([])
    expect(parseInteractionRules({ interactions: { r: 1 } })).toEqual([])
  })

  it('好条目原样解析', () => {
    expect(parseInteractionRules({ interactions: [GOOD] })).toEqual([GOOD])
  })
})

describe('坏条目丢弃', () => {
  it('事件名不在闭合集合里的丢', () => {
    const bad = { ...GOOD, source: { nodeId: 'btn', event: 'hover' } }
    expect(parseInteractionRules({ interactions: [bad, GOOD] })).toEqual([GOOD])
  })

  it('targets 混入非字符串的丢', () => {
    const bad = { ...GOOD, action: { type: 'show', targets: ['a', 1] } }
    expect(parseInteractionRules({ interactions: [bad] })).toEqual([])
  })

  it('setActive 组形状坏的丢，好的整条保留', () => {
    const good = {
      id: 'r2',
      source: { nodeId: 'tabs', event: 'select' },
      action: {
        type: 'setActive',
        groups: [{ value: 'a', targets: ['t1'] }],
      },
    }
    const bad = {
      id: 'r3',
      source: { nodeId: 'tabs', event: 'select' },
      action: { type: 'setActive', groups: [{ value: 7, targets: [] }] },
    }
    expect(parseInteractionRules({ interactions: [good, bad] })).toEqual([good])
  })

  it('openModal 无 target 的丢；title 非字符串时不带 title', () => {
    const noTarget = {
      id: 'r4',
      source: { nodeId: 'btn', event: 'click' },
      action: { type: 'openModal' },
    }
    const numericTitle = {
      id: 'r5',
      source: { nodeId: 'btn', event: 'click' },
      action: { type: 'openModal', target: 'panel', title: 3 },
    }
    const parsed = parseInteractionRules({
      interactions: [noTarget, numericTitle],
    })
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.action).toEqual({ type: 'openModal', target: 'panel' })
  })
})
