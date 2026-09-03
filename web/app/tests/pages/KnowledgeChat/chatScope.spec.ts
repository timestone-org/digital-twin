/**
 * @fileoverview 检索范围的纯逻辑：怎么显示、怎么摊、勾一下变成什么。
 *
 * ⚠ 最要紧的一条：`null`（全部）与「一个都没选」必须分得开。混了的表现是用户
 * 清空选择之后，检索悄悄扩回了他刚排除掉的那些库——而界面上看着一切正常。
 */
import { describe, expect, it } from 'vitest'
import type { KnowledgeChatScopeBase } from '@dt/contracts'

import type { KnowledgeBase } from '@/api/knowledge'
import {
  idsOf,
  scopeLabel,
  scopeOfIds,
  toggled,
} from '@/pages/KnowledgeChat/scripts/chatScope'

function baseOf(id: string, name: string): KnowledgeBase {
  return {
    id,
    name,
    description: '',
    strategy: 'hybrid',
    embeddingModel: null,
    dimensions: null,
    documentCount: 0,
    createdAt: '',
  }
}

function scopeOf(...names: string[]): KnowledgeChatScopeBase[] {
  return names.map((name, index) => ({
    base_id: `b${index + 1}`,
    name,
    is_missing: false,
  }))
}

const BASES = [baseOf('b1', '手册库'), baseOf('b2', '规程库')]

describe('范围怎么显示', () => {
  it('不限库时写「全部知识库」', () => {
    expect(scopeLabel(null)).toBe('全部知识库')
  })

  it('只选了一个就写那个库的名字', () => {
    expect(scopeLabel(scopeOf('手册库'))).toBe('手册库')
  })

  it('选了几个就写个数', () => {
    expect(scopeLabel(scopeOf('手册库', '规程库'))).toBe('2 个知识库')
  })

  it('只剩一个已删的库时也说得出，不显示空白', () => {
    const gone = [{ base_id: 'b9', name: '', is_missing: true }]

    expect(scopeLabel(gone)).toBe('1 个已删的库')
  })
})

describe('范围与 id 互摊', () => {
  it('不限库摊成 null，不是空表', () => {
    expect(idsOf(null)).toBeNull()
    expect(scopeOfIds(null, BASES)).toBeNull()
  })

  it('按 id 补出库名', () => {
    expect(scopeOfIds(['b2'], BASES)).toEqual([
      { base_id: 'b2', name: '规程库', is_missing: false },
    ])
  })

  it('清单里没有的照样留一条并标成已不存在', () => {
    expect(scopeOfIds(['b9'], BASES)).toEqual([
      { base_id: 'b9', name: '', is_missing: true },
    ])
  })
})

describe('勾一个库', () => {
  it('不限库时点一个 = 从「全都算」里去掉它', () => {
    expect(toggled(null, 'b1', BASES)).toEqual(['b2'])
  })

  it('没勾过的勾上', () => {
    expect(toggled(scopeOf('手册库'), 'b2', BASES)).toEqual(['b1', 'b2'])
  })

  it('⚠ 取消最后一个勾不变成「全部」：那正是他刚排除掉的那些库', () => {
    expect(toggled(scopeOf('手册库'), 'b1', BASES)).toEqual(['b1'])
  })
})
