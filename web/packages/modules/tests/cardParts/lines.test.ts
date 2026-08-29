/**
 * @fileoverview 契约：扁平部件表怎么摊成行。
 *
 * ⚠ 摆错行在界面上只是「怎么挤到一起去了」，很难反推是哪一条规则错的，
 * 所以每一条分支都在这里钉住。
 */
import { describe, expect, it } from 'vitest'

import { readPlace, toCardLines } from '../../src/cardParts/lines'
import type { CardPartPlace } from '../../src/cardParts/define'

/** 用占位档本身当部件，读出来的行结构一眼看得懂。 */
function lines(places: readonly CardPartPlace[]) {
  return toCardLines(places, (one) => one).map((line) => ({
    block: line.block?.part ?? null,
    left: line.left.map((one) => one.part),
    right: line.right.map((one) => one.part),
  }))
}

describe('占位档', () => {
  it('三档各自认得出来', () => {
    expect(readPlace('block')).toBe('block')
    expect(readPlace('left')).toBe('left')
    expect(readPlace('right')).toBe('right')
  })

  // ⚠ 认不出时扔掉那一件就是「我加的部件不见了」，而配置里明明有
  it('没配过、或认不出的一律当整行，不丢件', () => {
    expect(readPlace(undefined)).toBe('block')
    expect(readPlace('middle')).toBe('block')
  })
})

describe('成行', () => {
  it('一件都没有时没有行', () => {
    expect(lines([])).toEqual([])
  })

  it('整行档各占一行', () => {
    expect(lines(['block', 'block'])).toEqual([
      { block: 'block', left: [], right: [] },
      { block: 'block', left: [], right: [] },
    ])
  })

  it('左右配对成一行', () => {
    expect(lines(['left', 'right'])).toEqual([
      { block: null, left: ['left'], right: ['right'] },
    ])
  })

  // ⚠ info-list 的 left/left2/right/right2 是四件封顶，这里不封顶
  it('同一簇能摆多件，一行三件也摆得下', () => {
    expect(lines(['left', 'left', 'right'])).toEqual([
      { block: null, left: ['left', 'left'], right: ['right'] },
    ])
  })

  it('只有右件时左簇是空的，它仍靠右', () => {
    expect(lines(['right'])).toEqual([
      { block: null, left: [], right: ['right'] },
    ])
  })

  // ⚠ 不断开的话「读数｜进度条」与下一组「名称｜徽标」会挤成一行四件
  it('右件之后再来左件，起新的一行', () => {
    expect(lines(['left', 'right', 'left', 'right'])).toEqual([
      { block: null, left: ['left'], right: ['right'] },
      { block: null, left: ['left'], right: ['right'] },
    ])
  })

  it('整行档把前后两组配对切开', () => {
    expect(lines(['left', 'right', 'block', 'left', 'right'])).toEqual([
      { block: null, left: ['left'], right: ['right'] },
      { block: 'block', left: [], right: [] },
      { block: null, left: ['left'], right: ['right'] },
    ])
  })

  it('原表下标带得回去——右栏选中靠它对回原件', () => {
    const out = toCardLines(['block', 'left', 'right'] as const, (one) => one)

    expect(out[0]?.block?.index).toBe(0)
    expect(out[1]?.left[0]?.index).toBe(1)
    expect(out[1]?.right[0]?.index).toBe(2)
  })
})
