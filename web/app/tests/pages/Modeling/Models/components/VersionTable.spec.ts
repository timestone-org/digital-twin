/**
 * @fileoverview 模型版本长名称与完整不可用原因。
 */
import type { ModelingVersionSummary } from '@dt/contracts'
import { mount } from '@vue/test-utils'
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

function open() {
  return mount(VersionTable, {
    props: { rows: [VERSION], view: 'table', isLoading: false, error: null },
    global: {
      stubs: { PermGuard: { props: ['codes'], template: '<slot />' } },
    },
  })
}

describe('模型版本长文本', () => {
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
    const detail = wrapper
      .findAll('button')
      .find((button) => button.text() === '详情')
    expect(detail).toBeDefined()
    await detail?.trigger('click')
    expect(wrapper.emitted('detail')).toEqual([[VERSION]])
    wrapper.unmount()
  })
})
