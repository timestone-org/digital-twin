/**
 * @fileoverview 契约：寻址键改名的草稿——逐键只写草稿、失焦才落，空名与重名一律落不
 * 下去且草稿一并清掉。
 *
 * ⚠ 逐键写回会让这一行每敲一个字就整行重建（键同时是 v-for 的 key），焦点当场丢掉。
 * ⚠ 重名不写回而不是「后来者覆盖」：归一化按键去重且留最先那一条，覆盖的那一份会在
 * 存盘那一刻凭空消失。
 */
import { describe, expect, it } from 'vitest'

import { useKeyDrafts } from '@/pages/Twin2dEditor/scripts/useKeyDrafts'

const MESSAGES = { empty: '不能为空', taken: '已经被占着' }

function drafts(keys: readonly string[] = ['a', 'b']) {
  return useKeyDrafts(() => keys, MESSAGES)
}

describe('草稿与落定', () => {
  it('没改过时显示文档里的键，也没有错', () => {
    const at = drafts()

    expect(at.textOf('a')).toBe('a')
    expect(at.errorOf('a')).toBe('')
  })

  it('逐键只写草稿，交出去的还是 null', () => {
    const at = drafts()

    at.edit('a', 'ab')

    expect(at.textOf('a')).toBe('ab')
    expect(at.textOf('b')).toBe('b')
  })

  it('落定交出新键并把草稿清掉', () => {
    const at = drafts()

    at.edit('a', ' ab ')

    expect(at.commit('a')).toBe('ab')
    expect(at.textOf('a')).toBe('a')
  })

  it('没改过的那一格落定交出 null', () => {
    expect(drafts().commit('a')).toBeNull()
  })

  it('改成同一个键不算改动', () => {
    const at = drafts()

    at.edit('a', 'a')

    expect(at.commit('a')).toBeNull()
  })
})

describe('落不下去的两种', () => {
  it('空名当场标红，落定时草稿拨回原键', () => {
    const at = drafts()

    at.edit('a', '  ')

    expect(at.errorOf('a')).toBe('不能为空')
    expect(at.commit('a')).toBeNull()
    expect(at.textOf('a')).toBe('a')
  })

  it('与另一条重名当场标红且落不下去', () => {
    const at = drafts()

    at.edit('a', 'b')

    expect(at.errorOf('a')).toBe('已经被占着')
    expect(at.commit('a')).toBeNull()
  })

  it('没在改的那一格不报错', () => {
    const at = drafts()

    at.edit('a', 'b')

    expect(at.errorOf('b')).toBe('')
  })
})

describe('外面换了一份表', () => {
  it('reset 清掉全部草稿', () => {
    const at = drafts()

    at.edit('a', 'zz')
    at.reset()

    expect(at.textOf('a')).toBe('a')
  })
})
