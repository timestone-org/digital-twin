/**
 * @fileoverview 新建染色规则与新建档位的模板。
 *
 * ⚠ 模板存进配置前会走一遍归一化：模板与归一化的缺省不一致时，新建的规则会在
 * 「存一次再读回来」之后悄悄变样，而界面上看不出是模板写错了。
 */
import { normalizePartTint } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import {
  blankTintStop,
  newTintRule,
} from '@/pages/TwinEditor/scripts/partTintOps'

describe('新建染色规则', () => {
  // 开了开关却什么都没有，用户会以为开关没生效
  it('预置一停一运行两档，不是空表', () => {
    const rule = newTintRule()

    expect(rule.mode).toBe('stops')
    expect(rule.stops.map((stop) => stop.equals)).toEqual(['0', '1'])
  })

  // ⚠ 模板与归一化的缺省漂开时，新建的规则会在存一次之后变样
  it('过一遍归一化逐字段不变', () => {
    const rule = newTintRule()

    expect(normalizePartTint(rule)).toEqual(rule)
  })

  it('每次都给一份新的档位，两个部件不共用同一批对象', () => {
    const [first] = newTintRule().stops
    const [second] = newTintRule().stops

    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })

  it('回落色留空 = 退回常态色', () => {
    expect(newTintRule().fallback).toBe('')
  })
})

describe('新建一档', () => {
  it('缺省是「任意数值」的区间档，先摆出来再让人填', () => {
    const stop = blankTintStop([])

    expect(stop).toMatchObject({ match: 'range', from: null, to: null })
  })

  // ⚠ 重名的两档在 v-for 的 key 上会撞，表现是「改这一档另一档跟着变」
  it('id 避开已有的，不与现存档位重名', () => {
    const taken = [blankTintStop([])]
    const next = blankTintStop([
      ...taken,
      { ...blankTintStop(taken), id: 'stop-2' },
    ])

    expect(next.id).toBe('stop-3')
  })

  it('序号被占满时继续往后找，不死循环', () => {
    const taken = ['stop-1', 'stop-2', 'stop-3'].map((id) => ({
      ...blankTintStop([]),
      id,
    }))

    expect(blankTintStop(taken).id).toBe('stop-4')
  })

  it('过一遍归一化逐字段不变', () => {
    const stop = blankTintStop([])
    const rule = normalizePartTint({ stops: [stop] })

    expect(rule?.stops[0]).toEqual(stop)
  })
})
