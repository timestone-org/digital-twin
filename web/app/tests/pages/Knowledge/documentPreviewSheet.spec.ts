/**
 * @fileoverview 工作簿原件的画法：多工作表、单元格摆法、行数上限。
 *
 * ⚠ 有一条盯的是「截断了却不说」：工作簿动辄几万行，只画前几百行是对的，
 * 但不说一句的话用户会以为这份表就到那里为止。
 * ⚠ 还有一条盯的是日期：跟着 `toLocaleDateString` 走的话，本机与 CI（中文
 * locale）显示的格式不同，钉住它的用例会在其中一处红。
 */
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import DocumentPreviewSheet from '@/pages/Knowledge/components/DocumentPreviewSheet.vue'

const excel = vi.hoisted(() => ({ default: vi.fn() }))
vi.mock('read-excel-file/browser', () => excel)

const SHEETS = [
  {
    sheet: '月度指标',
    data: [
      ['月份', '综合指数', '是否达标', '统计日'],
      ['2026-01', 0.3, false, new Date(Date.UTC(2026, 0, 31))],
      ['2026-02', 0.31, true, null],
    ],
  },
  {
    sheet: '口径说明',
    data: [
      ['列名', '含义'],
      ['综合指数', '加权平均'],
    ],
  },
]

beforeEach(() => {
  excel.default.mockReset()
  excel.default.mockResolvedValue(SHEETS)
})

async function render(): Promise<VueWrapper> {
  const wrapper = mount(DocumentPreviewSheet, {
    props: { blob: new Blob(['xlsx']) },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

describe('工作簿原件的画法', () => {
  it('摆出全部工作表的页签，默认停在第一张', async () => {
    const wrapper = await render()

    expect(wrapper.text()).toContain('月度指标')
    expect(wrapper.text()).toContain('口径说明')
    expect(wrapper.findAll('th').map((one) => one.text())).toEqual([
      '月份',
      '综合指数',
      '是否达标',
      '统计日',
    ])
  })

  it('⚠ 各类单元格各有各的摆法，日期按 ISO 摆而不跟 locale 走', async () => {
    const wrapper = await render()

    const cells = wrapper
      .findAll('tbody tr')
      .map((row) => row.findAll('td').map((one) => one.text()))
    expect(cells[0]).toEqual(['2026-01', '0.3', '否', '2026-01-31'])
    // 空格如实留空，不写成 null 也不写成 0
    expect(cells[1]).toEqual(['2026-02', '0.31', '是', ''])
  })

  it('换一张工作表就换一份表头与正文', async () => {
    const wrapper = await render()

    const tab = wrapper
      .findAll('button')
      .find((one) => one.text() === '口径说明')
    await tab?.trigger('click')
    await flushPromises()

    expect(wrapper.findAll('th').map((one) => one.text())).toEqual([
      '列名',
      '含义',
    ])
  })

  it('⚠ 超过上限的行不画，但要如实说还剩多少', async () => {
    const rows = Array.from({ length: 500 }, (_unused, at) => [
      `2026-${at}`,
      at,
    ])
    excel.default.mockResolvedValue([
      { sheet: '大表', data: [['月份', '值'], ...rows] },
    ])

    const wrapper = await render()

    expect(wrapper.findAll('tbody tr')).toHaveLength(399)
    expect(wrapper.text()).toContain('还有 101 行没画出来')
  })

  it('只有一张表时不摆页签——一个页签的切换器是纯噪音', async () => {
    excel.default.mockResolvedValue([SHEETS[0]])

    const wrapper = await render()

    expect(wrapper.text()).not.toContain('口径说明')
    expect(wrapper.find('.doc-sheet__tabs').exists()).toBe(false)
  })

  it('读不出来时说一句人话，而不是停在加载态', async () => {
    excel.default.mockRejectedValue(new Error('not a zip'))

    const wrapper = await render()

    expect(wrapper.text()).toContain('这份工作簿画不出来')
    expect(wrapper.find('.dt-spinner').exists()).toBe(false)
  })
})
