/** @fileoverview 报告试算的空数据和降级结果呈现。 */
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import type { ReportPreview } from '@dt/contracts'

import PreviewPanel from '@/pages/Reports/Editor/components/PreviewPanel.vue'

const preview: ReportPreview = {
  is_valid: true,
  period: '2026-03',
  timezone: 'Asia/Shanghai',
  metrics: [],
  warnings: [],
  nodes: {
    chart: {
      kind: 'line',
      title: '空图表',
      series: [{ name: '供水温度', points: [] }],
    },
    table: {
      kind: 'dsTable',
      title: '空表格',
      columns: ['时间', 'F1'],
      rows: [],
    },
    condition: { kind: 'condText', text: '' },
  },
}

it('图表和表格没有数据时不留空白卡片', () => {
  const wrapper = mount(PreviewPanel, { props: { preview } })

  expect(wrapper.text().match(/当前报告期暂无可展示数据/g)).toHaveLength(2)
})

it('有数据时把图表和表格交给各自的渲染器', () => {
  const populated: ReportPreview = {
    ...preview,
    nodes: {
      chart: {
        kind: 'line',
        title: '趋势',
        series: [
          {
            name: '供水温度',
            points: [{ ts: '2026-03-01T00:00:00Z', value: '18.5' }],
          },
        ],
      },
      table: {
        kind: 'dsTable',
        title: '明细',
        columns: ['时间', 'F1'],
        rows: [['2026-03-01', '18.5']],
      },
    },
  }
  const wrapper = mount(PreviewPanel, {
    props: { preview: populated },
    global: {
      stubs: {
        ReportChart: { template: '<div data-test="chart" />' },
        ReportTable: { template: '<div data-test="table" />' },
      },
    },
  })

  expect(wrapper.find('[data-test="chart"]').exists()).toBe(true)
  expect(wrapper.find('[data-test="table"]').exists()).toBe(true)
  expect(wrapper.text()).not.toContain('当前报告期暂无可展示数据')
})
