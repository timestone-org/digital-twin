/**
 * @fileoverview 数组行本地 key 的三条口径：跟行数增减、删行连着删那把 uid、
 * 换位连着换 uid——任何一条走样，行内本地态就会静默错位到别的行上。
 */
import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { useRowKeys } from '@/features/dashboard/rowKeys'

function setup(initial: number) {
  const count = ref(initial)
  const keys = useRowKeys(() => count.value)
  return { count, keys }
}

describe('跟着行数增减', () => {
  it('初始就发满与行数等长的一串 uid，且互不重复', () => {
    const { keys } = setup(3)

    expect(keys.keys.value).toHaveLength(3)
    expect(new Set(keys.keys.value).size).toBe(3)
  })

  it('行数变多补在尾部，已有的 uid 原地不动', async () => {
    const { count, keys } = setup(2)
    const before = [...keys.keys.value]

    count.value = 4
    await nextTick()

    expect(keys.keys.value).toHaveLength(4)
    expect(keys.keys.value.slice(0, 2)).toEqual(before)
  })

  it('行数变少从尾部截断', async () => {
    const { count, keys } = setup(3)
    const before = [...keys.keys.value]

    count.value = 1
    await nextTick()

    expect(keys.keys.value).toEqual([before[0]])
  })

  it('0 行就是空表', () => {
    expect(setup(0).keys.keys.value).toEqual([])
  })
})

describe('删行', () => {
  it('removeAt 删中间那把 uid，后面的整体前移', () => {
    const { keys } = setup(3)
    const [first, , third] = keys.keys.value

    keys.removeAt(1)

    expect(keys.keys.value).toEqual([first, third])
  })
})

describe('换位', () => {
  it('swapAt 交换两把 uid', () => {
    const { keys } = setup(3)
    const [a, b, c] = keys.keys.value

    keys.swapAt(0, 2)

    expect(keys.keys.value).toEqual([c, b, a])
  })

  it('任一下标越界一动不动', () => {
    const { keys } = setup(2)
    const before = [...keys.keys.value]

    keys.swapAt(0, 2)
    keys.swapAt(-1, 1)

    expect(keys.keys.value).toEqual(before)
  })
})

describe('定位', () => {
  it('indexOf 报出这把 uid 现在是第几行，找不到给 -1', () => {
    const { keys } = setup(2)
    const second = keys.keys.value[1]
    if (second === undefined) throw new Error('第二把 uid 不该缺席')

    expect(keys.indexOf(second)).toBe(1)
    expect(keys.indexOf('不存在的 key')).toBe(-1)
  })
})
