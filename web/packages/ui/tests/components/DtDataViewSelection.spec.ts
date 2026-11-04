/** @fileoverview 数据视图的受控多选、当前页全选与卡片切换。 */
import type { DtDataColumn } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { DtDataView } from '../../src'
import type { DtDataViewSelection } from '../../src'

interface Row {
  id: string
  name: string
}
const ROWS: Row[] = [
  { id: 'a', name: '甲' },
  { id: 'b', name: '乙' },
]
const COLUMNS: DtDataColumn[] = [{ key: 'name', label: '名称', card: 'title' }]
const wrappers: { unmount: () => void }[] = []

function render(
  selection?: DtDataViewSelection<Row>,
  view: 'table' | 'card' = 'table',
) {
  const wrapper = mount(DtDataView, {
    props: { rows: ROWS, columns: COLUMNS, view },
    attrs: { selection },
    slots: { 'cell-name': '{{ params.row.name }}' },
    attachTo: document.body,
  })
  wrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
})

describe('当前页选择', () => {
  it('未开启时不添加复选框、选择列或卡片包装', () => {
    const table = render()
    const card = render(undefined, 'card')
    expect(table.find('input[type="checkbox"]').exists()).toBe(false)
    expect(table.findAll('th').map((cell) => cell.text())).toEqual(['名称'])
    expect(card.find('input[type="checkbox"]').exists()).toBe(false)
    expect(card.find('.dt-data-view__selectable-card').exists()).toBe(false)
    expect(card.get('.dt-data-view__grid').element.children).toHaveLength(2)
  })

  it('行选择只发送新ID，不修改调用方数组', async () => {
    const selectedIds = ['off-page']
    const wrapper = render({ selectedIds })
    await wrapper.get('input[aria-label="选择 a"]').setValue(true)
    expect(wrapper.emitted('update:selectedIds')).toEqual([[['off-page', 'a']]])
    expect(selectedIds).toEqual(['off-page'])
  })

  it('选中状态由调用方控制，取消单行保留其他ID', async () => {
    const wrapper = render({ selectedIds: ['off-page', 'a', 'b'] })
    await wrapper.get('input[aria-label="选择 a"]').setValue(false)
    expect(wrapper.emitted('update:selectedIds')).toEqual([[['off-page', 'b']]])
    await wrapper.setProps({ selection: { selectedIds: ['off-page', 'b'] } })
    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="选择 a"]').element
        .checked,
    ).toBe(false)
    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="选择 b"]').element
        .checked,
    ).toBe(true)
  })

  it('工具栏全选呈半选状态，仅影响当前页ID', async () => {
    const wrapper = render({ selectedIds: ['off-page', 'a'] })
    const all = wrapper.get<HTMLInputElement>('input[aria-label="选择本页"]')
    expect(all.element.checked).toBe(false)
    expect(all.element.indeterminate).toBe(true)
    await all.setValue(true)
    expect(wrapper.emitted('update:selectedIds')).toEqual([
      [['off-page', 'a', 'b']],
    ])
    await wrapper.setProps({
      selection: { selectedIds: ['off-page', 'a', 'b'] },
    })
    expect(all.element.checked).toBe(true)
    expect(all.element.indeterminate).toBe(false)
    await all.setValue(false)
    expect(wrapper.emitted('update:selectedIds')?.[1]).toEqual([['off-page']])
  })

  it('未知ID不使当前页全选或半选', async () => {
    const wrapper = render({ selectedIds: ['unknown'] })
    const all = wrapper.get<HTMLInputElement>('input[aria-label="选择本页"]')
    expect([all.element.checked, all.element.indeterminate]).toEqual([
      false,
      false,
    ])
    await all.setValue(true)
    expect(wrapper.emitted('update:selectedIds')).toEqual([
      [['unknown', 'a', 'b']],
    ])
  })

  it.each(['table', 'card'] as const)('空%s视图禁止全选', async (view) => {
    const wrapper = render({ selectedIds: [] }, view)
    await wrapper.setProps({ rows: [] })
    const all = wrapper.get<HTMLInputElement>('input[aria-label="选择本页"]')
    expect(all.element.disabled).toBe(true)
    await all.trigger('change')
    expect(wrapper.emitted('update:selectedIds')).toBeUndefined()
  })

  it('没有其他工具栏和切换器时仍显示本页选择', async () => {
    const wrapper = render({ selectedIds: [] })
    await wrapper.setProps({ layout: { toggle: false } })
    expect(wrapper.find('.dt-data-view__bar').exists()).toBe(true)
    expect(wrapper.find('.dt-segmented').exists()).toBe(false)
  })

  it('切换表格和默认卡片保留选中状态', async () => {
    const wrapper = render({ selectedIds: ['a'] })
    await wrapper.setProps({ view: 'card' })
    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="选择 a"]').element
        .checked,
    ).toBe(true)
    await wrapper.get('input[aria-label="选择 b"]').setValue(true)
    expect(wrapper.emitted('update:selectedIds')).toEqual([[['a', 'b']]])
    await wrapper.setProps({
      selection: { selectedIds: ['a', 'b'] },
      view: 'table',
    })
    expect(
      wrapper.get<HTMLInputElement>('input[aria-label="选择本页"]').element
        .checked,
    ).toBe(true)
  })

  it('开启选择的默认卡片继续使用单元格插槽和缺省占位', async () => {
    const wrapper = render({ selectedIds: [] }, 'card')
    await wrapper.setProps({
      columns: [...COLUMNS, { key: 'extra', label: '附加' }],
    })
    expect(
      wrapper.findAll('.dt-data-view__card-title').map((title) => title.text()),
    ).toEqual(['甲', '乙'])
    expect(wrapper.findAll('dd').map((cell) => cell.text())).toEqual(['—', '—'])
  })
})
