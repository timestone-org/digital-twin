/**
 * @fileoverview 联动引擎契约：易失覆盖不碰持久态、init 清零、互斥切换、
 * 弹窗目标失效不开、陈旧组 reconcile。
 */
import { describe, expect, it } from 'vitest'
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
