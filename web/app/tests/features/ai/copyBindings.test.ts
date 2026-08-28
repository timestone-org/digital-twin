/**
 * @fileoverview 契约：照抄绑定按名字对，**对不上就跳过**，绝不退回按行号硬抄。
 *
 * 行号对齐是这套数组绑定最容易「每条都有值、全接错对象」的地方，而界面上看不出来。
 * 另守两条：抄的只是取数来源；盖掉目标已有绑定时要标出来。
 */
import { describe, expect, it } from 'vitest'
import type { BindingView } from '@dt/contracts'

import type { BindingRowInput } from '@/features/ai/bindingReport'
import {
  copyMatchOf,
  planCopyBindings,
  type CopySide,
} from '@/features/ai/copyBindings'

function row(slotKey: string, index: number, label: string): BindingRowInput {
  return {
    slotKey,
    index,
    fieldKey: `${slotKey}[${index}].value`,
    label,
    entityId: `${slotKey}-${index}`,
  }
}

function bound(fieldKey: string, nodeKey: string): BindingView {
  return {
    id: `b-${fieldKey}-${nodeKey}`,
    fieldKey,
    sourceKind: 'opcua',
    nodeKey,
    staticValueJson: null,
    computeJson: null,
    detailJson: null,
    transformJson: null,
  }
}

const FROM: CopySide = {
  rows: [
    row('itemValues', 0, '温度'),
    row('itemValues', 1, '压力'),
    row('itemValues', 2, '流量'),
  ],
  bindings: [
    bound('itemValues[0].value', 's:t1'),
    bound('itemValues[1].value', 's:p1'),
    bound('itemValues[2].value', 's:f1'),
  ],
}

/** 目标那侧行序被人调过：按名字对得上，按行号会全部错位。 */
const SHUFFLED: CopySide = {
  rows: [
    row('itemValues', 0, '压力'),
    row('itemValues', 1, '温度'),
    row('itemValues', 2, '流量'),
  ],
  bindings: [],
}

function plan(to: CopySide, match: 'by_label' | 'by_index' = 'by_label') {
  return planCopyBindings({ from: FROM, to, match, isDryRun: false })
}

describe('按名字对齐', () => {
  it('目标行序被调过时照样接对实体，而不是按行号硬抄', () => {
    const found = plan(SHUFFLED)
    const pairs = found.copied.map((one) => [one.from_field_key, one.node_key])
    expect(pairs).toEqual([
      ['itemValues[0].value', 's:t1'],
      ['itemValues[1].value', 's:p1'],
      ['itemValues[2].value', 's:f1'],
    ])
    expect(found.copied[0]?.to_field_key).toBe('itemValues[1].value')
  })

  it('目标处没有同名的行时进 skipped，不退回按行号', () => {
    const found = plan({
      rows: [row('itemValues', 0, '温度'), row('itemValues', 1, '电压')],
      bindings: [],
    })
    expect(found.copied.map((one) => one.from_field_key)).toEqual([
      'itemValues[0].value',
    ])
    expect(found.skipped).toEqual([
      { from_field_key: 'itemValues[1].value', reason: '目标处没有同名的行' },
      { from_field_key: 'itemValues[2].value', reason: '目标处没有同名的行' },
    ])
  })

  it('目标那侧有两行同名时不猜，两边都说得出为什么', () => {
    const found = plan({
      rows: [row('itemValues', 0, '温度'), row('itemValues', 1, '温度')],
      bindings: [],
    })
    expect(found.copied).toEqual([])
    expect(found.skipped[0]?.reason).toBe(
      '目标那一侧有多行同名，认不出该抄给哪一行',
    )
  })

  it('源那侧两行同名且都接了东西时同样不猜', () => {
    const found = planCopyBindings({
      from: {
        rows: [row('itemValues', 0, '温度'), row('itemValues', 1, '温度')],
        bindings: [
          bound('itemValues[0].value', 's:t1'),
          bound('itemValues[1].value', 's:t2'),
        ],
      },
      to: { rows: [row('itemValues', 0, '温度')], bindings: [] },
      match: 'by_label',
      isDryRun: false,
    })
    expect(found.copied).toEqual([])
    expect(found.skipped).toHaveLength(2)
    expect(found.skipped[0]?.reason).toBe(
      '源这一侧有多行同名，认不出该抄哪一行',
    )
  })

  it('同名的另一行没接过东西就不算含糊，照抄得了', () => {
    const found = planCopyBindings({
      from: {
        rows: [row('itemValues', 0, '温度'), row('itemValues', 1, '温度')],
        bindings: [bound('itemValues[0].value', 's:t1')],
      },
      to: { rows: [row('itemValues', 0, '温度')], bindings: [] },
      match: 'by_label',
      isDryRun: false,
    })
    expect(found.copied).toHaveLength(1)
    expect(found.skipped).toEqual([])
  })

  it('源这一行没有名字时按名字对不上，说清楚是为什么', () => {
    const found = planCopyBindings({
      from: {
        rows: [row('itemValues', 0, '  ')],
        bindings: [bound('itemValues[0].value', 's:t1')],
      },
      to: { rows: [row('itemValues', 0, '温度')], bindings: [] },
      match: 'by_label',
      isDryRun: false,
    })
    expect(found.skipped[0]?.reason).toBe('这一行没有名字，按名字对不上')
  })
})

describe('按行号对齐', () => {
  it('数的是「本槽里的第几个」，两个实体的文档序差着也对得上', () => {
    const found = planCopyBindings({
      from: {
        rows: [row('panelValues', 3, 'A 板 · 温度')],
        bindings: [bound('panelValues[3].value', 's:t1')],
      },
      to: { rows: [row('panelValues', 7, 'B 板 · 温度')], bindings: [] },
      match: 'by_index',
      isDryRun: false,
    })
    expect(found.copied[0]?.to_field_key).toBe('panelValues[7].value')
    expect(found.copied[0]?.matched_by).toBe('by_index')
  })

  it('序号数的是整张行表，空行不许让其后每一行错开一格', () => {
    const found = planCopyBindings({
      from: {
        rows: [row('itemValues', 0, '温度'), row('itemValues', 1, '压力')],
        bindings: [bound('itemValues[1].value', 's:p1')],
      },
      to: {
        rows: [row('itemValues', 0, '甲'), row('itemValues', 1, '乙')],
        bindings: [],
      },
      match: 'by_index',
      isDryRun: false,
    })
    expect(found.copied[0]?.to_field_key).toBe('itemValues[1].value')
  })

  it('不同槽的第 0 行是两个不相干的实体，不许互相对上', () => {
    const found = planCopyBindings({
      from: {
        rows: [row('itemValues', 0, '温度')],
        bindings: [bound('itemValues[0].value', 's:t1')],
      },
      to: { rows: [row('gaugeValues', 0, '温度')], bindings: [] },
      match: 'by_index',
      isDryRun: false,
    })
    expect(found.copied).toEqual([])
    expect(found.skipped[0]?.reason).toBe('目标处这个槽没有第这么多行')
  })
})

describe('抄什么、标什么', () => {
  it('源那边没接数据源的行不算候选，也不进 skipped', () => {
    const found = planCopyBindings({
      from: {
        rows: [row('itemValues', 0, '温度'), row('itemValues', 1, '压力')],
        bindings: [bound('itemValues[0].value', 's:t1')],
      },
      to: {
        rows: [row('itemValues', 0, '温度'), row('itemValues', 1, '压力')],
        bindings: [],
      },
      match: 'by_label',
      isDryRun: false,
    })
    expect(found.copied).toHaveLength(1)
    expect(found.skipped).toEqual([])
  })

  it('盖掉目标已有绑定时标出来', () => {
    const found = plan({
      rows: [row('itemValues', 0, '温度')],
      bindings: [bound('itemValues[0].value', 's:old')],
    })
    expect(found.copied[0]?.is_overwrite).toBe(true)
  })

  it('目标那一行原本空着就不是覆盖', () => {
    expect(plan(SHUFFLED).copied[0]?.is_overwrite).toBe(false)
  })

  it('只看不动手时照样把要抄的算出来，并标着是试算', () => {
    const found = planCopyBindings({
      from: FROM,
      to: SHUFFLED,
      match: 'by_label',
      isDryRun: true,
    })
    expect(found.is_dry_run).toBe(true)
    expect(found.copied).toHaveLength(3)
  })
})

describe('对齐方式入参', () => {
  it('不给就按名字', () => {
    expect(copyMatchOf(undefined)).toBe('by_label')
    expect(copyMatchOf(null)).toBe('by_label')
  })

  it('认得出的两种照收', () => {
    expect(copyMatchOf('by_index')).toBe('by_index')
  })

  it('认不出的直说，不默默当成按名字', () => {
    expect(() => copyMatchOf('by_name')).toThrow('by_name')
  })
})
