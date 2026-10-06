/** @fileoverview 知识库首次跨页浏览、有界条目渲染与选择保留。 */
import { createPinia } from 'pinia'
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { DtPagination } from '@dt/ui'
import type { KnowledgeBase } from '@/api/knowledge'
import KnowledgeBaseList from '@/pages/Knowledge/components/KnowledgeBaseList.vue'
import KnowledgeBaseItem from '@/pages/Knowledge/components/KnowledgeBaseItem.vue'

enableAutoUnmount(afterEach)
function bases(count: number): KnowledgeBase[] {
  return Array.from({ length: count }, (_, id) => ({
    id: `b${id}`,
    name: id === count - 1 ? '最早库' : `库${id}`,
    description: '',
    strategy: 'hybrid',
    embeddingModel: null,
    dimensions: null,
    documentCount: id,
    createdAt: '2026-09-01T00:00:00.000Z',
  }))
}
function render(count: number, selectedId = '') {
  return mount(KnowledgeBaseList, {
    props: { bases: bases(count), selectedId, loading: false },
    global: { plugins: [createPinia()] },
  })
}
describe('知识库分页浏览', () => {
  it('首次101库只渲染20条，经分页发现最早库并可选择', async () => {
    const wrapper = render(101)
    expect(wrapper.findAllComponents(KnowledgeBaseItem)).toHaveLength(20)
    const pagination = wrapper.getComponent(DtPagination)
    const lastPage = pagination
      .findAll('button')
      .find((button) => button.text() === '6')
    if (lastPage === undefined) throw new Error('第6页入口缺失')
    await lastPage.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAllComponents(KnowledgeBaseItem)).toHaveLength(1)
    const last = wrapper.getComponent(KnowledgeBaseItem)
    expect(last.text()).toContain('最早库')
    await last.get('button').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['b100']])
    await wrapper.setProps({ selectedId: 'b100', bases: bases(101) })
    expect(wrapper.getComponent(DtPagination).props('page')).toBe(6)
    expect(wrapper.getComponent(KnowledgeBaseItem).props('active')).toBe(true)
  })
  it('5000库仍只渲染20条，最后一页入口保持可达', () => {
    const wrapper = render(5000)
    expect(wrapper.findAllComponents(KnowledgeBaseItem)).toHaveLength(20)
    expect(wrapper.getComponent(DtPagination).props('total')).toBe(5000)
  })
  it('最后一页删除后夹回有效页，清空时不保留分页空壳', async () => {
    const wrapper = render(21, 'b20')
    expect(wrapper.getComponent(DtPagination).props('page')).toBe(2)
    await wrapper.setProps({ bases: bases(20), selectedId: '' })
    expect(wrapper.findAllComponents(KnowledgeBaseItem)).toHaveLength(20)
    await wrapper.setProps({ bases: [] })
    expect(wrapper.findComponent(DtPagination).exists()).toBe(false)
  })
})
