/** @fileoverview 画布顶栏的跳转入口：渲染成按钮本身，不在 <a> 里套 <button>。 */
import type { ModelingPipeline } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import WorkflowActions from '@/pages/Modeling/Canvas/components/WorkflowActions.vue'

const STAMP = '2026-01-01T00:00:00.000Z'

const PIPELINE: ModelingPipeline = {
  id: 'p1',
  code: 'energy_fit',
  name: '能耗回归',
  description: null,
  node_count: 0,
  source_table_codes: [],
  created_by_name: null,
  created_at: STAMP,
  updated_at: STAMP,
  graph: { format_version: '1', nodes: [], edges: [] },
}

beforeEach(() => {
  setActivePinia(createPinia())
})

it('训练记录与训练模型是一个可点的按钮，点了照样跳过去', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:any(.*)', component: { template: '<div />' } }],
  })
  await router.push('/modeling/pipelines/p1')
  const wrapper = mount(WorkflowActions, {
    props: { pipeline: PIPELINE, run: null, isReadonly: false },
    global: { plugins: [router] },
  })

  expect(wrapper.find('a button').exists()).toBe(false)
  await wrapper.get('button[aria-label="训练记录"]').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.fullPath).toBe(
    '/modeling/runs?pipeline_id=p1',
  )
  wrapper.unmount()
})
