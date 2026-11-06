/** @fileoverview 预测后处理三个算子的公式代入态。 */
import { describe, expect, it } from 'vitest'

import type { FormulaNode } from '@/pages/Modeling/Canvas/scripts/formula'
import { formulasOf } from '@/pages/Modeling/Canvas/scripts/formulaCatalog'

function textOf(nodes: readonly FormulaNode[] | null): string {
  return (nodes ?? [])
    .flatMap((item) => (item.node === 'run' ? item.terms : []))
    .map((term) => term.text)
    .join('')
}

function filled(code: string, config: Record<string, unknown>): string {
  const [spec] = formulasOf(code, { blocks: [], ports: [], config })
  return textOf(spec?.filled ?? null)
}

describe('后处理公式', () => {
  it('限幅只设一端时说明另一端不设', () => {
    const text = filled('clamp_prediction', { lower: 0, upper: null })

    expect(text).toContain('0')
    expect(text).toContain('不设上限')
  })

  it('条件替换代入比较符与两个数', () => {
    expect(
      filled('replace_prediction', { op: 'lte', threshold: 5, value: 1 }),
    ).toBe('当ŷ≤5时取1')
  })

  it('取整代入位数与方式', () => {
    expect(filled('round_prediction', { decimals: 2, mode: 'ceil' })).toBe(
      '保留2位小数，向上取整',
    )
  })

  it.each(['clamp_prediction', 'replace_prediction', 'round_prediction'])(
    '%s 缺参数时说清代不进',
    (code) => {
      const [spec] = formulasOf(code, { blocks: [], ports: [], config: {} })

      expect(spec?.filled).toBeNull()
      expect(spec?.fallback).not.toBeNull()
    },
  )
})
