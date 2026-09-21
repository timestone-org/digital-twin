/** @fileoverview 紧凑导航的开合、菜单内操作与路由切换行为。 */
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import AppCompactNav from '@/components/layout/AppCompactNav.vue'

const path = ref('/')
vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({
    get path() {
      return path.value
    },
  }),
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

enableAutoUnmount(afterEach)
beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  path.value = '/'
})
afterEach(() => vi.restoreAllMocks())

function render() {
  return mount(AppCompactNav, { global: { stubs: { teleport: true } } })
}

it('点击导航链接关闭菜单，点击菜单空白不关闭', async () => {
  const wrapper = render()
  await wrapper.get('[aria-label="打开主导航"]').trigger('click')
  await wrapper.get('aside').trigger('click')
  expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  await wrapper.get('a[href="/"]').trigger('click')
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
})

it('路由变化关闭菜单', async () => {
  const wrapper = render()
  await wrapper.get('[aria-label="打开主导航"]').trigger('click')
  path.value = '/profile'
  await wrapper.vm.$nextTick()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
})
