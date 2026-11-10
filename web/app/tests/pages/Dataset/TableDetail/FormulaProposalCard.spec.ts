/**
 * @fileoverview 公式提议卡：「新建一列」必须用警示色与「改现有列」区分开——新列的
 * 标识建好就改不了。写错 DtTag 的 prop 名时 typecheck 与 lint 都放行，只能在这里守。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { DtTag } from '@dt/ui'

import FormulaProposalCard from '@/pages/Dataset/TableDetail/components/FormulaProposalCard.vue'

function proposal(isExisting: boolean) {
  return {
    columnKey: 'ratio',
    formula: '{a}/{b}',
    reading: 'a 除以 b',
    isExisting,
  }
}

describe('提议卡的标签色', () => {
  it('新建一列用警示色，改现有列用信息色', () => {
    const fresh = mount(FormulaProposalCard, {
      props: { proposal: proposal(false) },
    })
    expect(fresh.getComponent(DtTag).props('intent')).toBe('warning')
    const existing = mount(FormulaProposalCard, {
      props: { proposal: proposal(true) },
    })
    expect(existing.getComponent(DtTag).props('intent')).toBe('info')
  })
})
