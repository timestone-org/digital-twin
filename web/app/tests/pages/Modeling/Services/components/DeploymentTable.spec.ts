/**
 * @fileoverview 模型服务定宽表中的长名称、版本与不可用原因。
 */
import type { ModelDeployment, ModelingTask } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { DtIconButton } from '@dt/ui'
import { describe, expect, it } from 'vitest'

import DeploymentTable from '@/pages/Modeling/Services/components/DeploymentTable.vue'

const DEPLOYMENT: ModelDeployment = {
  id: 'd1',
  code: 'energy-forecast',
  model_version_id: 'v1',
  model_name: 'M'.repeat(128),
  model_version: 3,
  task: 'regression',
  name: 'N'.repeat(128),
  description: null,
  is_enabled: true,
  is_servable: false,
  unservable_reason: `missing_feature_${'K'.repeat(64)}`,
  max_rows_per_call: 200,
  rate_limit_per_minute: 60,
  key_count: 1,
  created_by_name: '张三',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

function open(row: ModelDeployment = DEPLOYMENT) {
  return mount(DeploymentTable, {
    props: { rows: [row], view: 'table', isLoading: false, error: null },
    global: {
      stubs: { PermGuard: { props: ['codes'], template: '<slot />' } },
    },
  })
}

describe('模型服务长文本', () => {
  it.each<{ task: ModelingTask; label: string }>([
    { task: 'regression', label: '回归' },
    { task: 'classification', label: '分类' },
    { task: 'anomaly_detection', label: '异常检测' },
    { task: 'rule_calculation', label: '规则计算' },
  ])('列表明确显示 $task 的模型类型', ({ task, label }) => {
    const wrapper = open({ ...DEPLOYMENT, task })
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toContain(
      '模型类型',
    )
    expect(wrapper.findAll('tbody td').map((cell) => cell.text())).toContain(
      label,
    )
    wrapper.unmount()
  })

  it('名称和版本不会跨列，完整内容仍可通过提示读取', () => {
    const wrapper = open()
    const cells = wrapper.findAll('tbody td')
    const names = [
      [0, DEPLOYMENT.name],
      [2, `${DEPLOYMENT.model_name} v${DEPLOYMENT.model_version}`],
    ] as const

    for (const [index, text] of names) {
      const content = cells[index]?.find('[title]')
      expect(content?.exists()).toBe(true)
      expect(content?.text()).toBe(text)
      expect(content?.attributes('title')).toBe(text)
      expect(content?.classes()).toEqual(
        expect.arrayContaining(['block', 'truncate']),
      )
    }
    wrapper.unmount()
  })

  it('不可用原因可在列内折行且不会吞掉状态徽标', () => {
    const wrapper = open()
    const reason = wrapper.get('.dt-ml-deploys__why')
    expect(reason.text()).toBe(DEPLOYMENT.unservable_reason)
    expect(reason.classes()).toEqual(
      expect.arrayContaining(['min-w-0', '[overflow-wrap:anywhere]']),
    )
    expect(wrapper.get('.dt-ml-deploys__state').classes()).toContain(
      'max-w-full',
    )
    expect(wrapper.text()).toContain('版本不可用')
    wrapper.unmount()
  })

  it('停用状态仍与版本不可用原因一起展示', () => {
    const wrapper = open({ ...DEPLOYMENT, is_enabled: false })
    expect(wrapper.text()).toContain('已停用')
    expect(wrapper.text()).toContain(DEPLOYMENT.unservable_reason)
    wrapper.unmount()
  })

  it('配置、删除和启停具有可访问名称，图标事件沿用原部署', async () => {
    const wrapper = open()
    expect(
      wrapper
        .findAllComponents(DtIconButton)
        .map((button) => [button.props('icon'), button.props('label')]),
    ).toEqual([
      ['pencil', '改配置'],
      ['power-off', '停用'],
      ['trash', '删掉'],
    ])
    await wrapper.get('button[aria-label="改配置"]').trigger('click')
    await wrapper.get('button[aria-label="停用"]').trigger('click')
    await wrapper.get('button[aria-label="删掉"]').trigger('click')
    expect(wrapper.emitted('edit')).toEqual([[DEPLOYMENT]])
    expect(wrapper.emitted('toggle')).toEqual([[DEPLOYMENT, false]])
    expect(wrapper.emitted('remove')).toEqual([[DEPLOYMENT]])
    expect(
      wrapper
        .findAllComponents(DtIconButton)
        .find((button) => button.props('label') === '删掉')
        ?.props('intent'),
    ).toBe('danger')
    expect(
      wrapper.findAll('button').some((button) => button.text() === '调用说明'),
    ).toBe(true)
    wrapper.unmount()
  })

  it('停用部署提供启用图标并发送新的启用值', async () => {
    const row = { ...DEPLOYMENT, is_enabled: false }
    const wrapper = open(row)
    const toggle = wrapper
      .findAllComponents(DtIconButton)
      .find((button) => button.props('label') === '启用')
    expect(toggle?.props('icon')).toBe('play')
    await wrapper.get('button[aria-label="启用"]').trigger('click')
    expect(wrapper.emitted('toggle')).toEqual([[row, true]])
    wrapper.unmount()
  })
})
