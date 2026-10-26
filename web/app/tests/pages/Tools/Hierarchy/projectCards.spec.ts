/** @fileoverview 项目卡片整卡激活、选中反馈与加载期间禁用。 */
import { mount } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import Projects from '../../../../src/pages/Tools/Hierarchy/components/HierarchyProjects.vue'
import { useHierarchyDocument } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchyDocument'
import { useHierarchySaving } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchySaving'
import { useHierarchyProjects } from '../../../../src/pages/Tools/Hierarchy/scripts/useHierarchyProjects'
import { harness } from '../../../../src/testing/hierarchyHarness'

afterEach(() => localStorage.clear())

function setup() {
  const parent = harness(() => {
    const editor = useHierarchyDocument()
    return useHierarchyProjects(useHierarchySaving(editor, () => true))
  })
  parent.state.items.value = [
    {
      id: 'water',
      title: '水',
      node_count: 10,
      revision: 34,
      updated_at: '2026-10-26T00:00:00Z',
    },
  ]
  parent.state.total.value = 1
  const wrapper = mount(Projects, {
    props: { projects: parent.state, selected: 'water' },
  })
  return { parent, wrapper }
}

it('项目卡片自身可点击，名称和版本不再包含独立按钮', async () => {
  const { parent, wrapper } = setup()
  const card = wrapper.get('.dt-data-view__grid > button')
  expect(card.attributes('type')).toBe('button')
  expect(card.attributes('aria-label')).toBe('水')
  expect(card.attributes('aria-pressed')).toBe('true')
  expect(card.text()).toContain('10 个 · v34')
  expect(card.find('button').exists()).toBe(false)
  await card.trigger('click')
  expect(wrapper.emitted('open')).toEqual([['water']])
  await card.get('.project-summary__meta').trigger('click')
  expect(wrapper.emitted('open')).toEqual([['water'], ['water']])
  await wrapper.setProps({ selected: 'another' })
  expect(card.attributes('aria-pressed')).toBe('false')
  wrapper.unmount()
  parent.wrapper.unmount()
})

it('加载期间整卡禁用，表格视图保留项目和版本信息', async () => {
  const { parent, wrapper } = setup()
  parent.state.loading.value = true
  await wrapper.vm.$nextTick()
  const card = wrapper.get('.dt-data-view__grid > button')
  expect(card.attributes('disabled')).toBeDefined()
  await card.trigger('click')
  expect(wrapper.emitted('open')).toBeUndefined()
  parent.state.loading.value = false
  await wrapper.get('[aria-label="表格视图"]').trigger('click')
  expect(wrapper.text()).toContain('水')
  expect(wrapper.get('tbody').text()).toContain('10 个')
  expect(wrapper.get('tbody').text()).toContain('v34')
  await wrapper.get('tbody button').trigger('click')
  expect(wrapper.emitted('open')).toEqual([['water']])
  wrapper.unmount()
  parent.wrapper.unmount()
})
