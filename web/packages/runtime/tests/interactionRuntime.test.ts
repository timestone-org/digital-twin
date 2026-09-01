/**
 * @fileoverview 联动引擎契约：易失覆盖不碰持久态、init 清零、互斥切换、
 * 弹窗目标失效不开、陈旧组 reconcile、跨屏跳转只搬运句柄。
 */
import { describe, expect, it, vi } from 'vitest'
import type { InteractionRule } from '@dt/contracts'

import {
  createInteractionRuntime,
  reconcileSetActiveGroups,
} from '../src/interactionRuntime'

const NODES = [
  { nodeId: 'btn', isVisible: true },
  { nodeId: 'panel', isVisible: false },
  { nodeId: 'tab-a', isVisible: true },
  { nodeId: 'tab-b', isVisible: true },
]

function toggleRule(): InteractionRule {
  return {
    id: 'r1',
    source: { nodeId: 'btn', event: 'click' },
    action: { type: 'toggle', targets: ['panel'] },
  }
}

describe('显隐', () => {
  it('无规则时按持久初始态；toggle 只改覆盖态', () => {
    const runtime = createInteractionRuntime()
    runtime.init([toggleRule()], NODES)

    expect(runtime.isVisible('panel')).toBe(false)
    runtime.dispatch('btn', { event: 'click' })
    expect(runtime.isVisible('panel')).toBe(true)
    runtime.dispatch('btn', { event: 'click' })
    expect(runtime.isVisible('panel')).toBe(false)
  })

  it('事件名或来源不匹配时不动', () => {
    const runtime = createInteractionRuntime()
    runtime.init([toggleRule()], NODES)

    runtime.dispatch('btn', { event: 'change' })
    runtime.dispatch('panel', { event: 'click' })
    expect(runtime.isVisible('panel')).toBe(false)
  })

  it('init 清掉覆盖态与弹窗', () => {
    const runtime = createInteractionRuntime()
    runtime.init([toggleRule()], NODES)
    runtime.dispatch('btn', { event: 'click' })
    expect(runtime.isVisible('panel')).toBe(true)

    runtime.init([toggleRule()], NODES)
    expect(runtime.isVisible('panel')).toBe(false)
    expect(runtime.activeModal.value).toBeNull()
  })

  it('不认识的节点算可见——渲染层不因脏规则藏掉好节点', () => {
    const runtime = createInteractionRuntime()
    runtime.init([], NODES)
    expect(runtime.isVisible('ghost')).toBe(true)
  })
})

describe('互斥切换', () => {
  const rule: InteractionRule = {
    id: 'r2',
    source: { nodeId: 'tabs', event: 'select' },
    action: {
      type: 'setActive',
      groups: [
        { value: 'a', targets: ['tab-a'] },
        { value: 'b', targets: ['tab-b'] },
      ],
    },
  }
  const nodes = [...NODES, { nodeId: 'tabs', isVisible: true }]

  it('命中的组显示、其余组隐藏', () => {
    const runtime = createInteractionRuntime()
    runtime.init([rule], nodes)

    runtime.dispatch('tabs', { event: 'select', value: 'a' })
    expect(runtime.isVisible('tab-a')).toBe(true)
    expect(runtime.isVisible('tab-b')).toBe(false)
  })

  it('初始选中在 init 时重放，互斥组一开屏就成立', () => {
    const runtime = createInteractionRuntime()
    runtime.init([rule], nodes, [{ nodeId: 'tabs', value: 'b' }])

    expect(runtime.isVisible('tab-a')).toBe(false)
    expect(runtime.isVisible('tab-b')).toBe(true)
  })
})

describe('弹窗', () => {
  it('开弹窗带标题；目标不存在时不开', () => {
    const runtime = createInteractionRuntime()
    runtime.init(
      [
        {
          id: 'r3',
          source: { nodeId: 'btn', event: 'click' },
          action: { type: 'openModal', target: 'panel', title: '详情' },
        },
        {
          id: 'r4',
          source: { nodeId: 'tab-a', event: 'click' },
          action: { type: 'openModal', target: 'deleted-node' },
        },
      ],
      NODES,
    )

    runtime.dispatch('tab-a', { event: 'click' })
    expect(runtime.activeModal.value).toBeNull()

    runtime.dispatch('btn', { event: 'click' })
    expect(runtime.activeModal.value).toEqual({
      nodeId: 'panel',
      title: '详情',
    })

    runtime.closeModal()
    expect(runtime.activeModal.value).toBeNull()
  })
})

describe('hasRules', () => {
  it('按来源与事件名过滤', () => {
    const runtime = createInteractionRuntime()
    runtime.init([toggleRule()], NODES)

    expect(runtime.hasRules('btn')).toBe(true)
    expect(runtime.hasRules('btn', 'click')).toBe(true)
    expect(runtime.hasRules('btn', 'select')).toBe(false)
    expect(runtime.hasRules('panel')).toBe(false)
  })
})

describe('reconcileSetActiveGroups', () => {
  it('丢掉 value 不在源选项集内的陈旧组，其余规则原样', () => {
    const rules: InteractionRule[] = [
      {
        id: 'r5',
        source: { nodeId: 'tabs', event: 'select' },
        action: {
          type: 'setActive',
          groups: [
            { value: 'a', targets: ['tab-a'] },
            { value: 'stale', targets: ['tab-b'] },
          ],
        },
      },
      toggleRule(),
    ]

    const next = reconcileSetActiveGroups(rules, (nodeId) =>
      nodeId === 'tabs' ? ['a', 'b'] : null,
    )

    const first = next[0]
    expect(first?.action.type).toBe('setActive')
    if (first?.action.type === 'setActive') {
      expect(first.action.groups.map((group) => group.value)).toEqual(['a'])
    }
    expect(next[1]).toBe(rules[1])
  })
})

describe('跨屏跳转', () => {
  function navigateRule(target: string): InteractionRule {
    return {
      id: 'r-nav',
      source: { nodeId: 'btn', event: 'click' },
      action: { type: 'navigate', target },
    }
  }

  function byValueRule(): InteractionRule {
    return {
      id: 'r-nav-v',
      source: { nodeId: 'btn', event: 'click' },
      action: {
        type: 'navigateByValue',
        routes: [
          { value: 'pv', target: 'd-pv' },
          { value: 'ac', target: 'd-ac' },
        ],
      },
    }
  }

  it('把句柄原样交给宿主，自己一点都不解释', () => {
    const navigate = vi.fn()
    const runtime = createInteractionRuntime({ navigate })
    runtime.init([navigateRule('d-2')], NODES)

    runtime.dispatch('btn', { event: 'click' })

    expect(navigate).toHaveBeenCalledWith('d-2')
  })

  it('没装导航口时静默不跳——设计态画布与独立渲染走这条', () => {
    const runtime = createInteractionRuntime()
    runtime.init([navigateRule('d-2')], NODES)

    expect(() => runtime.dispatch('btn', { event: 'click' })).not.toThrow()
  })

  it('目标是空串时不叫宿主：那是「还没挑目标」，不是一个能跳的地方', () => {
    const navigate = vi.fn()
    const runtime = createInteractionRuntime({ navigate })
    runtime.init([navigateRule('')], NODES)

    runtime.dispatch('btn', { event: 'click' })

    expect(navigate).not.toHaveBeenCalled()
  })

  it('按值分流取命中的那一条', () => {
    const navigate = vi.fn()
    const runtime = createInteractionRuntime({ navigate })
    runtime.init([byValueRule()], NODES)

    runtime.dispatch('btn', { event: 'click', value: 'ac' })

    expect(navigate).toHaveBeenCalledWith('d-ac')
  })

  it('值比不中任何一条就不跳，而不是回落到第一条', () => {
    const navigate = vi.fn()
    const runtime = createInteractionRuntime({ navigate })
    runtime.init([byValueRule()], NODES)

    runtime.dispatch('btn', { event: 'click', value: '不认识' })

    expect(navigate).not.toHaveBeenCalled()
  })

  it('没带值的事件一律不跳——整块可点的 click 不该撞上「值留空」的路由', () => {
    const navigate = vi.fn()
    const runtime = createInteractionRuntime({ navigate })
    runtime.init(
      [
        {
          id: 'r-blank',
          source: { nodeId: 'btn', event: 'click' },
          action: {
            type: 'navigateByValue',
            routes: [{ value: '', target: 'd-blank' }],
          },
        },
      ],
      NODES,
    )

    runtime.dispatch('btn', { event: 'click' })

    expect(navigate).not.toHaveBeenCalled()
  })

  it('数字值按字符串比，与互斥切换同一套口径', () => {
    const navigate = vi.fn()
    const runtime = createInteractionRuntime({ navigate })
    runtime.init(
      [
        {
          id: 'r-num',
          source: { nodeId: 'btn', event: 'click' },
          action: {
            type: 'navigateByValue',
            routes: [{ value: '7', target: 'd-7' }],
          },
        },
      ],
      NODES,
    )

    runtime.dispatch('btn', { event: 'click', value: 7 })

    expect(navigate).toHaveBeenCalledWith('d-7')
  })
})

describe('当前在哪一格', () => {
  /** 一条页签栏两格，各自指向一张屏。 */
  function tabsRule(): InteractionRule {
    return {
      id: 'r-tabs',
      source: { nodeId: 'btn', event: 'select' },
      action: {
        type: 'navigateByValue',
        routes: [
          { value: 'pv', target: 'd-pv' },
          { value: 'ac', target: 'd-ac' },
        ],
      },
    }
  }

  // 一条页签栏摆在几张屏上时，配置里那个静态下标只对其中一张是对的；
  // 高亮必须由「哪一条路由指向当前这张屏」推出来，否则在别的屏上就是
  // 「高亮停在别处、点自己那一格没反应」
  it('取指向当前这张屏的那条路由的值', () => {
    const runtime = createInteractionRuntime({ currentHandle: () => 'd-ac' })
    runtime.init([tabsRule()], NODES)

    expect(runtime.activeValueOf('btn')).toBe('ac')
  })

  it('没有一条路由指向本屏就推不出，给空串', () => {
    const runtime = createInteractionRuntime({ currentHandle: () => 'd-别的' })
    runtime.init([tabsRule()], NODES)

    expect(runtime.activeValueOf('btn')).toBe('')
  })

  it('宿主没给当前句柄时不猜，给空串', () => {
    const runtime = createInteractionRuntime({})
    runtime.init([tabsRule()], NODES)

    expect(runtime.activeValueOf('btn')).toBe('')
  })

  it('别的节点的规则不算在本节点头上', () => {
    const runtime = createInteractionRuntime({ currentHandle: () => 'd-ac' })
    runtime.init([tabsRule()], NODES)

    expect(runtime.activeValueOf('card')).toBe('')
  })

  it('单目标跳转推不出：它不带值，拿它当选中值会指到一格毫不相干的页签上', () => {
    const runtime = createInteractionRuntime({ currentHandle: () => 'd-1' })
    runtime.init(
      [
        {
          id: 'r-one',
          source: { nodeId: 'btn', event: 'select' },
          action: { type: 'navigate', target: 'd-1' },
        },
      ],
      NODES,
    )

    expect(runtime.activeValueOf('btn')).toBe('')
  })
})
