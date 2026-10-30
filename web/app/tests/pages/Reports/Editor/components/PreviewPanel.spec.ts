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

it('无效、缺失和陈旧的指标有明确提示', () => {
  const wrapper = mount(PreviewPanel, {
    props: {
      preview: {
        ...preview,
        is_valid: false,
        metrics: [
          { name: '接口能耗', value: null, error: '字段未找到' },
          { name: '旧读数', value: '20', is_stale: true },
        ],
      },
    },
  })
  expect(wrapper.text()).toContain('数据核对未通过')
  expect(wrapper.text()).toContain('字段未找到')
  expect(wrapper.text()).toContain('使用了报告期之前的数据')
})

it('API 来源即使未插入正文也展示映射样例与核对时间', () => {
  const wrapper = mount(PreviewPanel, {
    props: {
      preview: {
        ...preview,
        checked_at: '2026-03-01T00:00:00Z',
        api_results: [
          {
            source_code: 'energy',
            name: '能耗接口',
            row_count: 20,
            columns: ['电量'],
            rows: [['12.5']],
          },
          {
            source_code: 'empty',
            name: '空接口',
            row_count: 0,
            columns: ['电量'],
            rows: [],
          },
        ],
      },
    },
    global: {
      stubs: {
        ReportTable: { props: ['node'], template: '<p>{{ node.rows }}</p>' },
      },
    },
  })
  expect(wrapper.text()).toContain('API · 能耗接口')
  expect(wrapper.text()).toContain('本次获取 20 行')
  expect(wrapper.text()).toContain('12.5')
  expect(wrapper.text()).toContain('核对时间')
  expect(wrapper.text()).toContain('本期暂无匹配数据')
})
