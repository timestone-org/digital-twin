/**
 * @fileoverview 联动编辑面纯数据的三条口径：换动作类型时该保住的保住、
 * 跳转的目标是大屏不是节点、摘要要让人一眼看出这条会走人。
 */
import { describe, expect, it } from 'vitest'
import type { InteractionRule } from '@dt/contracts'

import {
  actionForType,
  ruleSummary,
  ruleTouchesNode,
} from '@/pages/DashboardEditor/scripts/interactionOptions'

/** 目标节点下拉的第一项，openModal 缺省落在它身上。 */
const FALLBACK_NODE = 'n1'

describe('换动作类型', () => {
  it('单目标换成按值分流时把已挑的大屏搬过来', () => {
    const next = actionForType(
      'navigateByValue',
      { type: 'navigate', target: 'd-2' },
      FALLBACK_NODE,
    )

    expect(next).toEqual({
      type: 'navigateByValue',
      routes: [{ value: '', target: 'd-2' }],
    })
  })

  it('按值分流换回单目标时取第一条路由的目标', () => {
    const next = actionForType(
      'navigate',
      {
        type: 'navigateByValue',
        routes: [
          { value: 'pv', target: 'd-pv' },
          { value: 'ac', target: 'd-ac' },
        ],
      },
      FALLBACK_NODE,
    )

    expect(next).toEqual({ type: 'navigate', target: 'd-pv' })
  })

  it('从显隐类换成跳转时目标是空的——绝不拿节点 id 当大屏兜底', () => {
    // ⚠ 兜底的那个值是**目标节点**下拉的第一项；塞进跳转就是一条跳去 404 的规则
    const next = actionForType(
      'navigate',
      { type: 'show', targets: ['n3'] },
      FALLBACK_NODE,
    )

    expect(next).toEqual({ type: 'navigate', target: '' })
  })
})

describe('规则跟节点的关系', () => {
  function navigateRule(target: string): InteractionRule {
    return {
      id: 'r1',
      source: { nodeId: 'btn', event: 'click' },
      action: { type: 'navigate', target },
    }
  }

  it('跳转的目标是大屏，不算「这个节点被这条规则控制」', () => {
    // 选中某个节点时的联动页只列跟它有关的规则；把大屏句柄当节点 id 比对的话，
    // 撞上就会列出一条跟这个节点毫无关系的规则
    expect(ruleTouchesNode(navigateRule('n3'), 'n3')).toBe(false)
    expect(ruleTouchesNode(navigateRule('n3'), 'btn')).toBe(true)
  })
})

describe('摘要', () => {
  const labelOf = (nodeId: string): string => `〈${nodeId}〉`

  it('挑了目标只说跳转，没挑就说没挑', () => {
    expect(ruleSummary(navigate('d-2'), labelOf)).toContain('跳转到大屏')
    expect(ruleSummary(navigate(''), labelOf)).toContain('未挑目标')
  })

  it('按值分流报有几条路由', () => {
    const rule: InteractionRule = {
      id: 'r2',
      source: { nodeId: 'cards', event: 'click' },
      action: {
        type: 'navigateByValue',
        routes: [
          { value: 'pv', target: 'd-pv' },
          { value: 'ac', target: 'd-ac' },
        ],
      },
    }

    expect(ruleSummary(rule, labelOf)).toContain('2 条')
  })

  function navigate(target: string): InteractionRule {
    return {
      id: 'r3',
      source: { nodeId: 'btn', event: 'click' },
      action: { type: 'navigate', target },
    }
  }
})
