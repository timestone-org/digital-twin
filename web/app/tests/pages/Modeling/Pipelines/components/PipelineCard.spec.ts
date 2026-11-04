/** @fileoverview 工作流卡片的信息分层、完整文本与底部操作插槽。 */
import type { ModelingPipelineSummary } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import PipelineCard from '@/pages/Modeling/Pipelines/components/PipelineCard.vue'
const row: ModelingPipelineSummary = {
  id: 'p1',
  name: '一号冷机能耗预测',
  code: 'chiller_energy',
  description: '用温度和负荷预测冷机能耗，供班组比较不同工况。',
  node_count: 6,
  source_table_codes: ['chiller_log', 'energy_log'],
  created_by_name: null,
  created_at: '2026-11-03T01:00:00Z',
  updated_at: '2026-11-03T02:00:00Z',
}
it('卡片按标题、说明、配置、来源和更新时间分层，操作留在footer', () => {
  const wrapper = mount(PipelineCard, {
    props: { row },
    slots: { actions: '<button>底部操作</button>' },
    global: {
      stubs: {
        RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
      },
    },
  })
  expect(wrapper.get('.pipeline-card__name').text()).toBe(row.name)
  expect(wrapper.get('.pipeline-card__name').attributes('href')).toBe(
    '/modeling/pipelines/p1',
  )
  expect(wrapper.get('.pipeline-card__description').text()).toBe(
    row.description,
  )
  expect(wrapper.get('.pipeline-card__facts').text()).toContain('6 个算子')
  expect(wrapper.get('.pipeline-card__sources').text()).toBe(
    'chiller_log、energy_log',
  )
  expect(wrapper.get('.pipeline-card__updated').text()).toContain('最近更新')
  expect(wrapper.get('footer button').text()).toBe('底部操作')
  expect(wrapper.get('.pipeline-card__body').find('button').exists()).toBe(
    false,
  )
  wrapper.unmount()
})
it('空说明、零算子与未引用台账有明确状态，长文本保留完整title', () => {
  const longName = '冷机能耗分析'.repeat(24)
  const wrapper = mount(PipelineCard, {
    props: {
      row: {
        ...row,
        name: longName,
        description: null,
        node_count: 0,
        source_table_codes: [],
      },
    },
    global: { stubs: { RouterLink: { template: '<a><slot /></a>' } } },
  })
  expect(wrapper.get('.pipeline-card__name').attributes('title')).toBe(longName)
  expect(wrapper.text()).toContain('尚未填写工作流说明')
  expect(wrapper.text()).toContain('0 个算子')
  expect(wrapper.text()).toContain('未引用台账')
  wrapper.unmount()
})
