/**
 * @fileoverview 下拉选项纯逻辑：过滤命中 label 与 value、移动高亮时跳过禁用项。
 */
import { describe, expect, it } from 'vitest'
import type { DtSelectOption } from '@dt/contracts'

import {
  filterOptions,
  firstEnabled,
  indexOfValue,
  lastEnabled,
  nextEnabled,
} from '../../../src/components/DtSelect/options'

const OPTIONS: DtSelectOption[] = [
  { value: 'user:view', label: '查看用户' },
  { value: 'user:manage', label: '管理用户', disabled: true },
  { value: 'role:manage', label: '管理角色' },
]

describe('filterOptions', () => {
  it('空关键词给回全部', () => {
    expect(filterOptions(OPTIONS, '')).toHaveLength(3)
    expect(filterOptions(OPTIONS, '   ')).toHaveLength(3)
  })

  it('按 label 匹配', () => {
    expect(filterOptions(OPTIONS, '角色').map((o) => o.value)).toEqual([
      'role:manage',
    ])
  })

  it('也按 value 匹配——权限码这类选项，人记得住的是取值', () => {
    expect(filterOptions(OPTIONS, 'user:').map((o) => o.value)).toEqual([
      'user:view',
      'user:manage',
    ])
  })

  it('忽略大小写', () => {
    expect(filterOptions(OPTIONS, 'ROLE')).toHaveLength(1)
  })

  it('没命中给空数组，不是给全部', () => {
    expect(filterOptions(OPTIONS, '不存在')).toEqual([])
  })
})

describe('移动高亮', () => {
  it('第一个/最后一个都跳过禁用项', () => {
    const allDisabled: DtSelectOption[] = [
      { value: 'a', label: 'A', disabled: true },
    ]
    expect(firstEnabled(OPTIONS)).toBe(0)
    expect(lastEnabled(OPTIONS)).toBe(2)
    expect(firstEnabled(allDisabled)).toBe(-1)
    expect(lastEnabled(allDisabled)).toBe(-1)
  })

  it('向下跳过禁用项——停在禁用项上回车没反应，用户会以为键盘坏了', () => {
    expect(nextEnabled(OPTIONS, 0, 1)).toBe(2)
  })

  it('向上同样跳过', () => {
    expect(nextEnabled(OPTIONS, 2, -1)).toBe(0)
  })

  it('到头绕回', () => {
    expect(nextEnabled(OPTIONS, 2, 1)).toBe(0)
    expect(nextEnabled(OPTIONS, 0, -1)).toBe(2)
  })

  it('空列表给 -1，不死循环', () => {
    expect(nextEnabled([], -1, 1)).toBe(-1)
  })

  it('全禁用时给 -1', () => {
    const all: DtSelectOption[] = [
      { value: 'a', label: 'A', disabled: true },
      { value: 'b', label: 'B', disabled: true },
    ]
    expect(nextEnabled(all, 0, 1)).toBe(-1)
  })
})

describe('indexOfValue', () => {
  it('找得到给下标，找不到给 -1', () => {
    expect(indexOfValue(OPTIONS, 'role:manage')).toBe(2)
    expect(indexOfValue(OPTIONS, 'nope')).toBe(-1)
  })
})
