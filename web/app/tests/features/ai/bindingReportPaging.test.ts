/** @fileoverview 绑定清单的过滤、完整行续读与回执预算契约。 */
import { describe, expect, it } from 'vitest'
import type { BindingView } from '@dt/contracts'

import {
  rowsBindingReport,
  type BindingRowInput,
} from '@/features/ai/bindingReport'
import { bindingReportQuery } from '@/features/ai/bindingReportQuery'
import { createBinding } from '@/features/dashboard/editorDoc'

function rows(count: number): BindingRowInput[] {
  return Array.from({ length: count }, (_, index) => ({
    slotKey: 'partFieldValues',
    index,
    fieldKey: `partFieldValues[${String(index)}].value`,
    label: `制冷机1# · 温度${String(index)}`,
    entityId: `chiller-1::f${String(index)}`,
  }))
}

function read(
  input: readonly BindingRowInput[],
  args: Record<string, unknown> = {},
  bindings: readonly BindingView[] = [],
) {
  return rowsBindingReport({
    nodeId: 'n1',
    moduleType: 'twin-view',
    nodeLabel: '厂区',
    rows: input,
    bindings,
    query: bindingReportQuery(args),
  })
}

describe('绑定清单续读', () => {
  it('跨过150行继续读到末尾，没有丢行、重复或重编号', () => {
    const input = rows(163)
    const seen: number[] = []
    let report = read(input)
    expect(report).toMatchObject({
      total: 163,
      returned: 20,
      offset: 0,
      limit: 20,
      has_more: true,
      next_offset: 20,
      is_truncated: true,
    })
    for (let page = 0; page < 10; page += 1) {
      seen.push(
        ...report.slots.flatMap((slot) => slot.rows.map((row) => row.index)),
      )
      if (report.next_offset === null) break
      report = read(input, { offset: report.next_offset })
    }
    expect(seen).toHaveLength(163)
    expect(new Set(seen).size).toBe(163)
    expect(seen.slice(-3)).toEqual([160, 161, 162])
    expect(report).toMatchObject({
      returned: 3,
      has_more: false,
      next_offset: null,
    })
    expect(report.slots[0]?.rows[2]?.field_key).toBe(
      'partFieldValues[162].value',
    )
  })

  it('先筛设备和槽位再分页，保留已绑来源及未绑定的空字段', () => {
    const input = [
      {
        slotKey: 'panelValues',
        index: 0,
        fieldKey: 'panelValues[0].value',
        label: '信息牌',
        entityId: 'panel-1',
      },
      ...rows(3),
      {
        slotKey: 'partFieldValues',
        index: 3,
        fieldKey: 'partFieldValues[3].value',
        label: '制冷机10#',
        entityId: 'chiller-10::f0',
      },
    ]
    const binding = {
      ...createBinding('n1', 'partFieldValues[1].value'),
      sourceKind: 'opcua' as const,
      nodeKey: 'source:CHILLER1_TEMP',
    }
    const report = read(
      input,
      {
        entity_id: 'chiller-1',
        slot_key: 'partFieldValues',
        offset: 1,
        limit: 2,
      },
      [binding],
    )
    expect(report.total).toBe(3)
    expect(report.slots).toHaveLength(1)
    expect(report.slots[0]).toMatchObject({
      row_count: 4,
      rows: [
        {
          index: 1,
          field_key: 'partFieldValues[1].value',
          node_key: 'source:CHILLER1_TEMP',
        },
        { index: 2, field_key: 'partFieldValues[2].value', node_key: null },
      ],
    })
    expect(report.next_offset).toBeNull()
  })

  it.each([' 温度1 ', 'PARTFIELDVALUES[1]', 'CHILLER-1::F1'])(
    '关键词匹配名称、槽键或身份且忽略大小写：%s',
    (keyword) => {
      const report = read(rows(3), { keyword })
      expect(report.total).toBe(1)
      expect(report.slots[0]?.rows[0]?.index).toBe(1)
    },
  )

  it('完整字段身份只匹配该字段，设备身份边界不匹配相似前缀', () => {
    expect(read(rows(3), { entity_id: 'chiller-1::f2' }).total).toBe(1)
    expect(read(rows(3), { entity_id: 'chiller' }).total).toBe(0)
  })

  it.each([
    { slot_key: 'missing' },
    { keyword: '不存在' },
    { offset: 3 },
    { offset: 99 },
  ])('空结果或越过末页时不生成下一页：%o', (args) => {
    const report = read(rows(3), args)
    expect(report).toMatchObject({
      returned: 0,
      has_more: false,
      next_offset: null,
      is_truncated: false,
    })
    expect(report.slots.flatMap((slot) => slot.rows)).toEqual([])
  })

  it('空场景不伪造字段', () => {
    expect(read([])).toMatchObject({
      total: 0,
      returned: 0,
      slots: [],
      scalars: [],
      next_offset: null,
    })
  })

  it('长值按整行缩小回执，用实际返回行数续读且值保持完整', () => {
    const input = rows(20)
    const value = '精确常量'.repeat(400)
    const bindings = input.map((row) => ({
      ...createBinding('n1', row.fieldKey),
      staticValueJson: value,
    }))
    const first = read(input, {}, bindings)
    expect(first.returned).toBeGreaterThan(0)
    expect(first.returned).toBeLessThan(20)
    expect(first.next_offset).toBe(first.returned)
    expect(JSON.stringify(first, null, 1).length).toBeLessThanOrEqual(12_000)
    expect(
      first.slots[0]?.rows.every((row) => row.static_value === value),
    ).toBe(true)
    const next = read(input, { offset: first.next_offset }, bindings)
    expect(next.slots[0]?.rows[0]?.index).toBe(first.returned)
  })

  it('单条超预算明确报错，不返回残缺值或无法推进的续读位置', () => {
    const binding = {
      ...createBinding('n1', 'partFieldValues[0].value'),
      staticValueJson: '值'.repeat(20_000),
    }
    expect(() => read(rows(1), {}, [binding])).toThrow('单个绑定字段')
  })
})

describe('绑定清单参数', () => {
  it.each([undefined, null, '', '  '])('空筛选读取全部实体：%s', (value) => {
    expect(
      read(rows(3), { entity_id: value, keyword: value, slot_key: value })
        .total,
    ).toBe(3)
  })

  it.each([
    { offset: -1 },
    { offset: 0.5 },
    { offset: true },
    { offset: '1' },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
    { limit: 0 },
    { limit: 21 },
    { limit: 1.5 },
    { limit: true },
    { limit: null },
    { slot_key: [] },
    { entity_id: {} },
    { keyword: 1 },
  ])('拒绝错误筛选或窗口：%o', (args) => {
    expect(() => read(rows(3), args)).toThrow(
      /slot_key|entity_id|keyword|offset|limit/,
    )
  })
})
