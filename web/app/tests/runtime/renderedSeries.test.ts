/** @fileoverview 渲染序列快照的身份隔离与清理。 */
import { describe, expect, it } from 'vitest'
import type { BindingSlot } from '@dt/runtime'
import { createRenderedSeries } from '@/runtime/renderedSeries'
import { createBinding } from '@/features/dashboard/editorDoc'

const binding = createBinding('n', 'series[0].value')
const slots: ReadonlyMap<string, BindingSlot> = new Map([
  [binding.fieldKey, { state: 'ok', value: 2, points: [{ t: 1, v: 2 }] }],
])

describe('渲染快照', () => {
  it('只读已经渲染的同节点同绑定，不借用旧来源或别的节点', () => {
    const cache = createRenderedSeries()
    expect(cache.read('n', binding)).toBeUndefined()
    cache.observe('n', [binding], slots)
    expect(cache.read('n', binding)).toBe(slots.get(binding.fieldKey))
    expect(cache.read('other', binding)).toBeUndefined()
    expect(cache.read('n', { ...binding, nodeKey: 'changed' })).toBeUndefined()
    cache.clear()
    expect(cache.read('n', binding)).toBeUndefined()
  })
  it('旧组件清理不删除新组件发布的结果', () => {
    const cache = createRenderedSeries()
    const old = cache.observe('n', [binding], new Map())
    const current = cache.observe('n', [binding], slots)
    old()
    expect(cache.read('n', binding)).toBeDefined()
    current()
    expect(cache.read('n', binding)).toBeUndefined()
  })
})
