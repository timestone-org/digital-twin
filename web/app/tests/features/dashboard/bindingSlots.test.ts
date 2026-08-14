/**
 * @fileoverview 契约：绑定槽摊成面板行、数组槽的行号连续且从 0 起，
 * 删中间一行是把其后整体前移而不是留个洞（DASHBOARD_DESIGN §4.2）。
 */
import { describe, expect, it } from 'vitest'
import type { BindingPayload, BindingSpec } from '@dt/contracts'

import {
  arrayRowCount,
  rowFieldKey,
  slotGroups,
  slotRows,
  withRowRemoved,
} from '@/features/dashboard/bindingSlots'

const PLAIN: BindingSpec = { key: 'value', label: '数值', dataType: 'number' }

const ARRAY: BindingSpec = {
  key: 'rows',
  label: '多行',
  dataType: 'number',
  isArray: true,
  arrayFields: [
    { key: 'value', label: '数值', dataType: 'number' },
    { key: 'status', label: '状态', dataType: 'string' },
  ],
}

function binding(fieldKey: string, id = fieldKey): BindingPayload {
  return {
    id,
    nodeId: 'n1',
    fieldKey,
    sourceKind: 'static',
    nodeKey: null,
    staticValueJson: null,
    computeJson: null,
    detailJson: null,
    transformJson: null,
    createdAt: '',
    updatedAt: '',
  }
}

describe('槽键', () => {
  it('数组行的键是 `槽[行].子槽`', () => {
    expect(rowFieldKey('rows', 2, 'value')).toBe('rows[2].value')
  })
})

describe('数组槽的行数', () => {
  it('按已有绑定里出现过的最大行号加一', () => {
    const bindings = [binding('rows[0].value'), binding('rows[2].status')]

    expect(arrayRowCount(bindings, 'rows')).toBe(3)
  })

  it('一条都没有时是 0', () => {
    expect(arrayRowCount([binding('other')], 'rows')).toBe(0)
  })

  it('前缀相同但不是数组形状的键不算数', () => {
    expect(arrayRowCount([binding('rowsX')], 'rows')).toBe(0)
  })
})

describe('摊成面板行', () => {
  it('普通槽只有一行，键就是槽键', () => {
    expect(slotRows(PLAIN, 3)).toEqual([{ fieldKey: 'value', spec: PLAIN }])
  })

  it('数组槽每行摊出全部子槽', () => {
    expect(slotRows(ARRAY, 2).map((row) => row.fieldKey)).toEqual([
      'rows[0].value',
      'rows[0].status',
      'rows[1].value',
      'rows[1].status',
    ])
  })

  it('数组槽分组时每行一组，组里带行号', () => {
    const groups = slotGroups(ARRAY, 2)

    expect(groups).toHaveLength(2)
    expect(groups[0]?.rowIndex).toBe(0)
    expect(groups[1]?.rows.map((row) => row.fieldKey)).toEqual([
      'rows[1].value',
      'rows[1].status',
    ])
  })

  it('普通槽只有一组且没有行号', () => {
    const groups = slotGroups(PLAIN, 0)

    expect(groups).toHaveLength(1)
    expect(groups[0]?.rowIndex).toBeNull()
    expect(groups[0]?.title).toBeNull()
  })
})

describe('删一行', () => {
  it('其后各行整体前移，行号仍连续且从 0 起', () => {
    const bindings = [
      binding('rows[0].value'),
      binding('rows[1].value'),
      binding('rows[2].value'),
      binding('other'),
    ]

    expect(withRowRemoved(bindings, 'rows', 1).map((item) => item.fieldKey)).toEqual([
      'rows[0].value',
      'rows[1].value',
      'other',
    ])
  })

  it('前移不改 id——绑定 id 一经创建永不改变', () => {
    const bindings = [binding('rows[0].value', 'b0'), binding('rows[1].value', 'b1')]

    expect(withRowRemoved(bindings, 'rows', 0)).toEqual([
      expect.objectContaining({ id: 'b1', fieldKey: 'rows[0].value' }),
    ])
  })

  it('删最后一行时其余不动', () => {
    const bindings = [binding('rows[0].value'), binding('rows[1].value')]

    expect(withRowRemoved(bindings, 'rows', 1).map((item) => item.fieldKey)).toEqual([
      'rows[0].value',
    ])
  })
})
