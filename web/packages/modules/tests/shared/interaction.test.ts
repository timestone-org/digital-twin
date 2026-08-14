/**
 * @fileoverview 守行点击上抛器：带值的点击照常上抛，⚠ 空值一律不上抛——
 * 没有 value 的联动事件没有任何规则用得上它，上抛只会误触「无值」那条路径。
 */
import { describe, expect, it, vi } from 'vitest'

import {
  rowClickEmitter,
  type InteractionEmit,
} from '../../src/shared/interaction'

describe('rowClickEmitter', () => {
  it('带值的点击上抛 click 事件', () => {
    const emit = vi.fn<InteractionEmit>()

    rowClickEmitter(emit)('1 号泵')

    expect(emit).toHaveBeenCalledWith('interaction', {
      event: 'click',
      value: '1 号泵',
    })
  })

  it('空值不上抛', () => {
    const emit = vi.fn<InteractionEmit>()

    rowClickEmitter(emit)('')

    expect(emit).not.toHaveBeenCalled()
  })

  it('每次点击各上抛一次', () => {
    const emit = vi.fn<InteractionEmit>()
    const onRowClick = rowClickEmitter(emit)

    onRowClick('甲')
    onRowClick('乙')

    expect(emit).toHaveBeenCalledTimes(2)
  })
})
