/**
 * @fileoverview DtTable 的行为契约：列定义驱动表头、单元格走具名插槽、
 * 排序只抛事件不自己排、aria-sort 与视觉箭头同步、行 key 取 id、
 * 铺满态把纵向滚动收进自己的容器。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { DtTableColumn } from '@dt/contracts'

import DtTable from '../../src/components/DtTable/DtTable.vue'

interface Row {
  id: string
  name: string
}

const COLUMNS: DtTableColumn[] = [
  { key: 'name', label: '名称', sortable: true },
  { key: 'extra', label: '附加', align: 'right', width: '8rem' },
]

const ROW_A: Row = { id: 'a', name: '甲' }
const ROW_B: Row = { id: 'b', name: '乙' }
const ROW_C: Row = { id: 'c', name: '丙' }
const ROWS: Row[] = [ROW_A, ROW_B]

function render(props: Record<string, unknown> = {}) {
  return mount(DtTable, {
    props: { columns: COLUMNS, rows: ROWS, ...props },
    slots: { 'cell-name': '<span class="probe">{{ params.row.name }}</span>' },
  })
}

describe('DtTable', () => {
  it('表头来自列定义，顺序一致', () => {
    const headers = render()
      .findAll('th')
      .map((th) => th.text())
    expect(headers).toEqual(['名称', '附加'])
  })

  it('给了插槽的列用插槽渲染', () => {
    expect(
      render()
        .findAll('.probe')
        .map((n) => n.text()),
    ).toEqual(['甲', '乙'])
  })

  it('没给插槽的列落到占位符，而不是渲染 undefined', () => {
    const cells = render().findAll('tbody tr:first-child td')
    expect(cells[1]?.text()).toBe('—')
  })

  it('列宽落到 col 上，不写死在每个单元格里', () => {
    const cols = render().findAll('col')
    expect(cols[1]?.attributes('style')).toContain('8rem')
  })

  it('对齐方式落到 th 与 td 上', () => {
    const wrapper = render()
    expect(wrapper.findAll('th')[1]?.classes()).toContain('is-right')
    expect(wrapper.findAll('td')[1]?.classes()).toContain('is-right')
  })

  it('最小宽度落到 table 上，窄屏靠外层横向滚动', () => {
    const wrapper = render({ minWidth: '70rem' })
    expect(wrapper.find('table').attributes('style')).toContain('70rem')
  })

  it('⚠ 默认不开固定列宽：开着会改掉全仓每一张表的列宽排布', () => {
    expect(render().find('table').classes()).not.toContain('is-fixed')
  })

  it('要了固定列宽才给——不给的话 column.width 只是个建议，浏览器按内容重排', () => {
    expect(render({ fixedLayout: true }).find('table').classes()).toContain(
      'is-fixed',
    )
  })

  it('caption 给了才渲染——读屏靠它知道这张表是什么', () => {
    expect(render().find('caption').exists()).toBe(false)
    expect(render({ caption: '用户列表' }).find('caption').text()).toBe(
      '用户列表',
    )
  })

  it('可排序列点一下抛升序', async () => {
    const wrapper = render()
    await wrapper.find('th button').trigger('click')
    expect(wrapper.emitted('update:sort')).toEqual([
      [{ key: 'name', desc: false }],
    ])
  })

  it('已经是升序时再点抛降序', async () => {
    const wrapper = render({ sort: { key: 'name', desc: false } })
    await wrapper.find('th button').trigger('click')
    expect(wrapper.emitted('update:sort')).toEqual([
      [{ key: 'name', desc: true }],
    ])
  })

  it('组件自己不排序——顺序完全由入参决定', async () => {
    const wrapper = render({ sort: { key: 'name', desc: true } })
    await wrapper.find('th button').trigger('click')
    expect(wrapper.findAll('.probe').map((n) => n.text())).toEqual(['甲', '乙'])
  })

  it('不可排序的列不给按钮，点表头也不抛事件', async () => {
    const wrapper = render()
    const plain = wrapper.findAll('th')[1]
    expect(plain?.find('button').exists()).toBe(false)
    await plain?.trigger('click')
    expect(wrapper.emitted('update:sort')).toBeUndefined()
  })

  it('aria-sort 跟着当前排序走——光有箭头图标读屏读不到', () => {
    const wrapper = render({ sort: { key: 'name', desc: true } })
    const headers = wrapper.findAll('th')
    expect(headers[0]?.attributes('aria-sort')).toBe('descending')
    expect(headers[1]?.attributes('aria-sort')).toBe('none')
  })

  it('缺省不铺满：高度由外层容器决定', () => {
    expect(render().find('.dt-table__scroll').classes()).not.toContain(
      'is-fill',
    )
  })

  it('铺满态把标记打在滚动容器上，表格在它内部滚而不是撑高外层', () => {
    const scroll = render({ fill: true }).find('.dt-table__scroll')
    expect(scroll.classes()).toContain('is-fill')
    // sticky 表头贴的是这个滚动容器的顶，换了容器也得还在
    expect(scroll.find('thead th').exists()).toBe(true)
  })

  it('删掉中间行后，剩下的行不换位——key 取 id 而不是下标', async () => {
    const wrapper = render({ rows: [ROW_A, ROW_B, ROW_C] })
    expect(wrapper.findAll('.probe').map((n) => n.text())).toEqual([
      '甲',
      '乙',
      '丙',
    ])
    await wrapper.setProps({ rows: [ROW_A, ROW_C] })
    expect(wrapper.findAll('.probe').map((n) => n.text())).toEqual(['甲', '丙'])
  })
})
