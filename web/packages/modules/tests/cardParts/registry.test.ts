/**
 * @fileoverview 守部件分发表：登记、覆盖告警、以及「查不到时说得出查不到」。
 *
 * ⚠ `getCardPart` 返回 undefined 而调用方不画占位，就是「我加了部件但没反应」——
 * 那是这套系统里最难查的一类故障，所以这里连「查不到」这件事本身都要钉住。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defineCardPart } from '../../src/cardParts/define'
import {
  __resetCardParts,
  getCardPart,
  listCardParts,
  missingCardParts,
  registerCardPart,
  setCardPartWarn,
} from '../../src/cardParts/registry'
import type { CardPartInput } from '../../src/cardParts/types'

function part(kind: string, over: Partial<CardPartInput> = {}) {
  return defineCardPart({
    kind,
    label: kind,
    icon: 'gauge',
    hint: '演示。',
    slots: [],
    fields: [],
    component: () => Promise.resolve({ default: {} }),
    ...over,
  })
}

afterEach(__resetCardParts)

describe('登记', () => {
  it('登记后按档查得到', () => {
    const meter = part('meter')
    registerCardPart(meter)

    expect(getCardPart('meter')).toBe(meter)
  })

  it('没登记过的档查出来是 undefined，不抛', () => {
    expect(getCardPart('meter')).toBeUndefined()
  })

  it('没有 kind 的定义当场抛，不静默塞进表里', () => {
    expect(() => registerCardPart(part(' '))).toThrow(/kind/)
  })

  it('同档后登记者生效，并经告警槽提一句', () => {
    const sink = vi.fn()
    setCardPartWarn(sink)
    registerCardPart(part('meter'))
    const second = part('meter')
    registerCardPart(second)

    expect(getCardPart('meter')).toBe(second)
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('同一个定义重复登记不告警——热替换会这么干', () => {
    const sink = vi.fn()
    setCardPartWarn(sink)
    const meter = part('meter')
    registerCardPart(meter)
    registerCardPart(meter)

    expect(sink).not.toHaveBeenCalled()
  })

  it('顺序即登记先后——「加部件」菜单按它摆', () => {
    registerCardPart(part('value'))
    registerCardPart(part('meter'))

    expect(listCardParts().map((one) => one.kind)).toEqual(['value', 'meter'])
  })
})

describe('自检', () => {
  // ⚠ 模块把内置部件的字段静态并进 configSchema，运行期却查不到组件的话，
  //   属性面板上摆着一档、选了画不出来
  it('列出还没登记的那些档', () => {
    registerCardPart(part('value'))

    expect(missingCardParts(['value', 'meter'])).toEqual(['meter'])
  })

  it('全都登记过时是空表', () => {
    registerCardPart(part('value'))

    expect(missingCardParts(['value'])).toEqual([])
  })
})
