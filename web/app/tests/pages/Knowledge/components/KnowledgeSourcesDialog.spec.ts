/** @fileoverview 来源弹窗：同一个库换了对象身份（轮询刷新计数）不许重置表单。 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import * as api from '@/api/knowledge'
import type { KnowledgeBase } from '@/api/knowledge'
import KnowledgeSourcesDialog from '@/pages/Knowledge/components/KnowledgeSourcesDialog.vue'

enableAutoUnmount(afterEach)
beforeEach(() => {
  setActivePinia(createPinia())
})
afterEach(() => {
  vi.restoreAllMocks()
})

function base(over: Partial<KnowledgeBase> = {}): KnowledgeBase {
  return {
    id: 'b1',
    name: '库',
    description: '',
    strategy: 'hybrid',
    embeddingModel: null,
    dimensions: null,
    documentCount: 1,
    createdAt: '',
    ...over,
  }
}

describe('KnowledgeSourcesDialog', () => {
  it('同 id 的库对象被替换时不重拉、不重置', async () => {
    const list = vi.spyOn(api, 'listSources').mockResolvedValue([])
    const wrapper = mount(KnowledgeSourcesDialog, {
      props: { modelValue: true, base: base(), sourceKinds: ['platform'] },
      global: { stubs: { teleport: true } },
    })
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ base: base({ documentCount: 2 }) })
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(1)
  })
})
