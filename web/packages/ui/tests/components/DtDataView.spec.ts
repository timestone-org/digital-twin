/**
 * @fileoverview DtDataView 的行为契约。
 *
 * 最要紧的一条：**两种视图必须用同一套单元格插槽**。这个组件存在的全部理由
 * 就是不让表格和卡片各写一份渲染；那条契约破了，它就只是多了一层包装。
 * 另两条：高度收敛（铺满外层、内部滚动）与分页器只在拿到分页信息时出现。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { DtDataColumn } from '@dt/contracts'

import DtDataView from '../../src/components/DtDataView/DtDataView.vue'

interface Row {
  id: string
  name: string
  note: string
}

const COLUMNS: DtDataColumn[] = [
  { key: 'name', label: '名称', card: 'title' },
  { key: 'note', label: '备注' },
  { key: 'actions', label: '操作', card: 'actions' },
]

const ROWS: Row[] = [
  { id: 'a', name: '甲', note: '第一条' },
  { id: 'b', name: '乙', note: '第二条' },
]

const SLOTS = {
  'cell-name': '<span class="c-name">{{ params.row.name }}</span>',
  'cell-note': '<span class="c-note">{{ params.row.note }}</span>',
  'cell-actions': '<button class="c-act">改</button>',
}

function render(props: Record<string, unknown> = {}) {
  return mount(DtDataView, {
    props: { columns: COLUMNS, rows: ROWS, view: 'table', ...props },
    slots: SLOTS,
    attachTo: document.body,
  })
}

// 分页器里的 DtSelect 把浮层 teleport 到 body，留着会串到下一条用例
afterEach(() => {
  document.body.innerHTML = ''
})

describe('DtDataView', () => {
  it('表格视图渲染 table', () => {
    const wrapper = render()
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.findAll('.c-name').map((n) => n.text())).toEqual([
      '甲',
      '乙',
    ])
  })

  it('卡片视图不渲染 table，但同一批数据都在', () => {
    const wrapper = render({ view: 'card' })
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.findAll('.c-name').map((n) => n.text())).toEqual([
      '甲',
      '乙',
    ])
  })

  it('两种视图用的是同一套单元格插槽，内容逐字一致', () => {
    const table = render({ view: 'table' })
    const card = render({ view: 'card' })
    const pick = (w: ReturnType<typeof render>, sel: string) =>
      w.findAll(sel).map((n) => n.text())
    for (const sel of ['.c-name', '.c-note', '.c-act']) {
      expect(pick(card, sel)).toEqual(pick(table, sel))
    }
  })

  it('卡片视图给每个字段配上列名，否则一堆值读不出是什么', () => {
    const wrapper = render({ view: 'card' })
    expect(wrapper.findAll('dt').map((n) => n.text())).toContain('备注')
  })

  it('标为 title / actions 的列不重复出现在字段区', () => {
    const labels = render({ view: 'card' })
      .findAll('dt')
      .map((n) => n.text())
    expect(labels).not.toContain('名称')
    expect(labels).not.toContain('操作')
  })

  it('切换器抛出目标视图', async () => {
    const wrapper = render()
    const buttons = wrapper.findAll('.dt-segmented__item')
    await buttons[1]?.trigger('click')
    expect(wrapper.emitted('update:view')).toEqual([['card']])
  })

  it('toggle=false 时不渲染切换器——多块数据共用页面上那一个', () => {
    const wrapper = render({ layout: { toggle: false } })
    expect(wrapper.find('.dt-segmented').exists()).toBe(false)
  })

  it('加载中只显示加载态，不把空列表当成没数据', () => {
    const wrapper = render({ loading: true, rows: [] })
    expect(wrapper.find('.dt-spinner').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('暂无数据')
  })

  it('出错时给原因与重试入口', async () => {
    const wrapper = render({ error: '网络不可达', rows: [] })
    expect(wrapper.text()).toContain('网络不可达')
    const retry = wrapper
      .findAll('button')
      .find((b) => b.text().includes('重试'))
    await retry?.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('空列表两种视图都给空态', () => {
    for (const view of ['table', 'card'] as const) {
      expect(render({ view, rows: [] }).text()).toContain('暂无数据')
    }
  })

  it('卡片视图也从出错态给重试入口，不是只有表格有', async () => {
    const wrapper = render({ view: 'card', error: '网络不可达', rows: [] })
    const retry = wrapper
      .findAll('button')
      .find((b) => b.text().includes('重试'))
    await retry?.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('卡片视图里没给插槽的列同样落到占位符，与表格一致', () => {
    const wrapper = render({
      view: 'card',
      columns: [...COLUMNS, { key: 'extra', label: '附加' }],
    })
    const values = wrapper.findAll('dd').map((n) => n.text())
    expect(values).toContain('—')
  })

  it('toolbar 与 summary 插槽渲染在同一条工具条上', () => {
    const wrapper = mount(DtDataView, {
      props: { columns: COLUMNS, rows: ROWS, view: 'table' },
      slots: {
        ...SLOTS,
        toolbar: '<input class="c-filter" />',
        summary: '共 2 条',
      },
    })
    expect(wrapper.find('.c-filter').exists()).toBe(true)
    expect(wrapper.text()).toContain('共 2 条')
  })

  it('空态标题可以按场景改', () => {
    const wrapper = render({ rows: [], empty: { title: '还没有账号' } })
    expect(wrapper.text()).toContain('还没有账号')
  })

  it('最小宽度透传给表格', () => {
    const wrapper = render({ layout: { minWidth: '70rem' } })
    expect(wrapper.find('table').attributes('style')).toContain('70rem')
  })

  it('卡片列数落到栅格类名上', () => {
    const wrapper = render({ view: 'card', layout: { cardColumns: 3 } })
    expect(wrapper.find('.dt-data-view__grid').classes()).toContain('is-cols-3')
  })

  it('排序事件原样透传给调用方', async () => {
    const wrapper = render({
      columns: [{ key: 'name', label: '名称', sortable: true }],
    })
    await wrapper.find('th button').trigger('click')
    expect(wrapper.emitted('update:sort')).toEqual([
      [{ key: 'name', desc: false }],
    ])
  })
})

describe('DtDataView 高度收敛', () => {
  it('缺省铺满：吃满外层给的高度，超出的部分在内部滚', () => {
    const wrapper = render()
    expect(wrapper.find('.dt-data-view').classes()).toContain('is-fill')
    expect(wrapper.find('.dt-table__scroll').classes()).toContain('is-fill')
  })

  it('铺满开关关掉后按内容高度渲染——一页里若干张小表要的是这个', () => {
    const wrapper = render({ layout: { fill: false } })
    expect(wrapper.find('.dt-data-view').classes()).not.toContain('is-fill')
    expect(wrapper.find('.dt-table__scroll').classes()).not.toContain('is-fill')
  })

  it('卡片视图同样跟着开关走，两种呈现不会一个铺满一个不铺', () => {
    expect(render({ view: 'card' }).find('.dt-data-view').classes()).toContain(
      'is-fill',
    )
    expect(
      render({ view: 'card', layout: { fill: false } })
        .find('.dt-data-view')
        .classes(),
    ).not.toContain('is-fill')
  })

  it('表体在卡片外框内部滚——外框自己不跟着长高', () => {
    const wrapper = render()
    const panel = wrapper.find('.dt-data-view__panel')
    expect(panel.exists()).toBe(true)
    expect(panel.find('.dt-table__scroll').exists()).toBe(true)
  })
})

describe('DtDataView 分页器', () => {
  const PAGER = { page: 2, size: 10, total: 95 }

  it('没给分页信息就不渲染分页器——不分页的用法不能凭空多出一条', () => {
    expect(render().find('.dt-pagination').exists()).toBe(false)
  })

  it('给了分页信息才渲染，并报出当前区间', () => {
    const wrapper = render({ pagination: PAGER })
    expect(wrapper.find('.dt-pagination').exists()).toBe(true)
    expect(wrapper.text()).toContain('第 11–20 条，共 95 条')
  })

  it('两种视图都有分页器，切到卡片不会把它弄丢', () => {
    const wrapper = render({ view: 'card', pagination: PAGER })
    expect(wrapper.find('.dt-pagination').exists()).toBe(true)
  })

  it('翻页事件透传给调用方', async () => {
    const wrapper = render({ pagination: PAGER })
    const next = wrapper.findAll('button').find((n) => n.text() === '下一页')
    await next?.trigger('click')
    expect(wrapper.emitted('update:page')).toEqual([[3]])
  })

  it('改每页条数时，页码与条数两个事件都透传给调用方', async () => {
    const wrapper = render({ pagination: PAGER })
    await wrapper.find('.dt-select__trigger').trigger('click')
    document.querySelector<HTMLElement>('.dt-select-menu__item')?.click()
    await flushPromises()
    expect(wrapper.emitted('update:size')).toEqual([[10]])
    expect(wrapper.emitted('update:page')).toEqual([[1]])
  })

  it('每页条数的备选值由调用方决定', async () => {
    const wrapper = render({
      pagination: { ...PAGER, size: 25, sizeOptions: [25, 50] },
    })
    await wrapper.find('.dt-select__trigger').trigger('click')
    expect(
      [...document.querySelectorAll('.dt-select-menu__item')].map((n) =>
        n.textContent?.trim(),
      ),
    ).toEqual(['25 条/页', '50 条/页'])
  })
})
