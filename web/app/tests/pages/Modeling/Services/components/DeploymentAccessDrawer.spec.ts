/** @fileoverview 部署调用说明按实际模型类型给出唯一入口。 */
import type { ModelingTask } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import DeploymentAccessDrawer from '@/pages/Modeling/Services/components/DeploymentAccessDrawer.vue'
import { deployment } from '@/testing/modelingTemplateFixtures'

it.each<{
  task: ModelingTask
  label: string
  action: string
  result: string
}>([
  {
    task: 'regression',
    label: '回归',
    action: 'predict',
    result: 'predictions',
  },
  {
    task: 'classification',
    label: '分类',
    action: 'predict',
    result: 'predictions',
  },
  {
    task: 'anomaly_detection',
    label: '异常检测',
    action: 'detect',
    result: 'is_anomaly',
  },
  {
    task: 'rule_calculation',
    label: '规则计算',
    action: 'calculate',
    result: '结构化结果',
  },
])(
  '$task 只展示 :$action 调用入口与结果说明',
  ({ task, label, action, result }) => {
    const wrapper = mount(DeploymentAccessDrawer, {
      props: {
        deployment: { ...deployment, task },
        stats: [],
        isLoading: false,
        error: null,
      },
      global: { stubs: { Teleport: true, DeploymentTrial: true } },
    })
    const endpoints = wrapper
      .findAll('p')
      .map((paragraph) => paragraph.text())
      .filter((text) => text.startsWith('POST '))
    expect(endpoints).toEqual([
      `POST /api/v1/platform/open-models/${deployment.code}:${action}`,
    ])
    expect(wrapper.text()).toContain(label)
    expect(wrapper.text()).toContain(result)
    expect(wrapper.text()).toContain('用户 APIKey')
    expect(wrapper.findComponent({ name: 'RuleResultGuide' }).exists()).toBe(
      task === 'rule_calculation',
    )
    wrapper.unmount()
  },
)
