/**
 * @fileoverview 模型版本长名称与完整不可用原因。
 */
import type { ModelingTask, ModelingVersionSummary } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { DtIconButton } from '@dt/ui'
import { describe, expect, it } from 'vitest'

import VersionTable from '@/pages/Modeling/Models/components/VersionTable.vue'

const VERSION: ModelingVersionSummary = {
  id: 'v1',
  pipeline_id: 'p1',
  run_id: 'r1',
  version: 3,
  name: 'N'.repeat(128),
  algo: 'linear',
  task: 'regression',
  is_servable: false,
  serving_channel: 'json',
  unservable_reason: `missing_feature_${'K'.repeat(64)}`,
  feature_keys: ['temperature'],
  target_key: 'energy',
  created_by_name: null,
  created_at: '2026-01-01T00:00:00.000Z',
}

function open(row: ModelingVersionSummary = VERSION) {
  return mount(VersionTable, {
    props: {
      rows: [row],
      view: 'table',
      isLoading: false,
      error: null,
      pagination: { page: 1, size: 200, total: 1 },
    },
    global: {
      stubs: { PermGuard: { props: ['codes'], template: '<slot />' } },
    },
  })
}

describe('模型版本长文本', () => {
  it.each<{ task: ModelingTask; label: string }>([
    { task: 'regression', label: '回归' },
    { task: 'classification', label: '分类' },
    { task: 'anomaly_detection', label: '异常检测' },
    { task: 'rule_calculation', label: '规则计算' },
  ])('列表明确显示 $task 的模型类型', ({ task, label }) => {
    const wrapper = open({ ...VERSION, task })
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toContain(
      '模型类型',
    )
    expect(wrapper.findAll('tbody td').map((cell) => cell.text())).toContain(
      label,
    )
    wrapper.unmount()
  })

  it('长名称在列内截断且完整名称可读', () => {
    const wrapper = open()
    const name = wrapper.findAll('tbody td')[0]?.find('[title]')
    expect(name?.exists()).toBe(true)
    expect(name?.text()).toBe(VERSION.name)
    expect(name?.attributes('title')).toBe(VERSION.name)
    expect(name?.classes()).toEqual(
      expect.arrayContaining(['block', 'truncate']),
    )
    wrapper.unmount()
  })

  it('长标识的不可用原因保持全文并在状态列中折行', () => {
    const wrapper = open()
    const reason = wrapper.get('.dt-ml-versions__why [title]')
    expect(reason.text()).toBe(VERSION.unservable_reason)
    expect(reason.attributes('title')).toBe(VERSION.unservable_reason)
    expect(reason.classes()).toEqual(
      expect.arrayContaining(['min-w-0', '[overflow-wrap:anywhere]']),
    )
    expect(wrapper.get('.dt-ml-versions__why').classes()).toContain(
      'max-w-full',
    )
    expect(wrapper.text()).toContain('不可用')
    wrapper.unmount()
  })

  it('长名称不会改变详情动作传回的版本', async () => {
    const wrapper = open()
    await wrapper.get('button[aria-label="详情"]').trigger('click')
    expect(wrapper.emitted('detail')).toEqual([[VERSION]])
    wrapper.unmount()
  })

  it('辅助动作使用命名图标按钮，主要业务动作保留文字且事件目标不变', async () => {
    const wrapper = open({ ...VERSION, is_servable: true })
    const actions = [
      ['详情', 'eye', 'detail'],
      ['改名', 'pencil', 'rename'],
      ['下线', 'power-off', 'retire'],
      ['删除', 'trash', 'remove'],
    ]
    for (const [label, icon, event] of actions) {
      if (!label || !event) throw new Error('缺少动作定义')
      const control = wrapper
        .findAllComponents(DtIconButton)
        .find((item) => item.props('label') === label)
      expect(control?.props()).toMatchObject({ icon, size: 'sm' })
      await wrapper.get(`button[aria-label="${label}"]`).trigger('click')
      expect(wrapper.emitted(event)).toEqual([
        [{ ...VERSION, is_servable: true }],
      ])
    }
    expect(
      wrapper
        .findAllComponents(DtIconButton)
        .find((item) => item.props('label') === '删除')
        ?.props('intent'),
    ).toBe('danger')
    for (const label of ['发布模型', '绑公式']) {
      expect(
        wrapper.findAll('button').some((button) => button.text() === label),
      ).toBe(true)
      expect(
        wrapper
          .findAllComponents(DtIconButton)
          .some((button) => button.props('label') === label),
      ).toBe(false)
    }
    wrapper.unmount()
  })
})
