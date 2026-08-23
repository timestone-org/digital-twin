/**
 * @fileoverview 分段编辑面展示模型的契约：每档两格、兜底只有一格，字段标识与
 * 「插进哪一格」的约定逐字对上。
 *
 * ⚠ 「否则」那一档**没有条件**：给它配一个条件框会让人以为那里也能写判断，
 * 而后端的兜底位根本不收条件。
 */
import { describe, expect, it } from 'vitest'

import { toCards } from '@/pages/Dataset/TableDetail/scripts/branchCards'

const DRAFT = {
  arms: [
    { cond: '{a} > 8', value: '2' },
    { cond: '{a} > 6', value: '1' },
  ],
  otherwise: '0',
  form: 'IFS' as const,
}

describe('摊成卡片', () => {
  it('每一档一张卡，末尾再加一张「否则」', () => {
    const cards = toCards(DRAFT)
    expect(cards).toHaveLength(3)
    expect(cards.map((one) => one.isElse)).toEqual([false, false, true])
  })

  it('字段标识就是「插进哪一格」的约定', () => {
    const cards = toCards(DRAFT)
    expect(cards[0]?.fields.map((one) => one.id)).toEqual(['0.cond', '0.value'])
    expect(cards[1]?.fields.map((one) => one.id)).toEqual(['1.cond', '1.value'])
    expect(cards[2]?.fields.map((one) => one.id)).toEqual(['else'])
  })

  it('⚠ 兜底只有取值一格：它没有条件', () => {
    const cards = toCards(DRAFT)
    expect(cards[2]?.fields).toHaveLength(1)
    expect(cards[2]?.fields[0]?.tag).toBe('取')
  })

  it('各格铺的是草稿里的原文', () => {
    const cards = toCards(DRAFT)
    expect(cards[0]?.fields.map((one) => one.text)).toEqual(['{a} > 8', '2'])
    expect(cards[2]?.fields[0]?.text).toBe('0')
  })

  it('一档都没有时也留着兜底那一张', () => {
    const cards = toCards({ arms: [], otherwise: '{a} + {b}', form: 'IF' })
    expect(cards).toHaveLength(1)
    expect(cards[0]?.isElse).toBe(true)
  })

  it('每一格都有读屏名：分段面里没有可见 label', () => {
    for (const card of toCards(DRAFT)) {
      for (const field of card.fields) expect(field.label).not.toBe('')
    }
  })
})
