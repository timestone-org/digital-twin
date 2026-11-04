/** @fileoverview 训练记录主查看入口、更多菜单和权限状态契约。 */
import type { ModelingRunSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtTooltip } from '@dt/ui'
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import RunActions from '@/pages/Modeling/Runs/components/RunActions.vue'
import { useAuthStore } from '@/stores/auth'
const RUN: ModelingRunSummary = {
  id: 'r1',
  pipeline_id: 'p1',
  status: 'succeeded',
  trigger: 'manual',
  started_at: null,
  finished_at: null,
  duration_ms: null,
  row_count: 10,
  is_source_truncated: false,
  is_keeping_frames: false,
  error_text: null,
  created_by_name: '分析员',
  created_at: '2026-11-03T00:00:00Z',
  publication_status: 'not_requested',
}
const wrappers: VueWrapper[] = []
beforeEach(() => {
  setActivePinia(createPinia())
  vi.spyOn(useAuthStore(), 'can').mockReturnValue(true)
})
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers.length = 0
  vi.restoreAllMocks()
})
function open(run = RUN, canPublish = true) {
  const wrapper = mount(RunActions, {
    props: { run, canPublish },
    attachTo: document.body,
    global: { stubs: { Teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}
async function openMenu(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('button[aria-label="训练记录更多操作"]').trigger('click')
  await flushPromises()
}
async function pick(wrapper: VueWrapper, name: string): Promise<void> {
  await openMenu(wrapper)
  const action = wrapper
    .findAll('[role="menuitem"]')
    .find((item) => item.text() === name)
  if (!action) throw new Error(`缺少菜单动作：${name}`)
  await action.trigger('click')
  await flushPromises()
}
it('操作区仅显示文字查看按钮与32px更多图标，发布状态不再混入操作', async () => {
  const wrapper = open({ ...RUN, publication_status: 'published' })
  const buttons = wrapper.findAll('button')
  expect(buttons).toHaveLength(2)
  expect(buttons[0]?.text()).toBe('查看结果')
  expect(buttons[0]?.attributes('aria-label')).toBe('查看训练结果')
  const more = wrapper.get('button[aria-label="训练记录更多操作"]')
  expect(more.classes()).toContain('dt-btn--icon-only')
  expect(more.classes()).toContain('dt-btn--sm')
  expect(wrapper.text()).not.toContain('已发布')
  expect(wrapper.find('.dt-tag').exists()).toBe(false)
  await openMenu(wrapper)
  expect(
    wrapper.findAll('[role="menuitem"]').map((item) => item.text()),
  ).toEqual(['发布模型', '删除记录'])
  expect(wrapper.findAll('[role="menuitem"]').at(-1)?.classes()).toContain(
    'dt-menu__item--danger',
  )
})
it('发布与删除从文字菜单转发当前训练记录，执行后关闭菜单', async () => {
  const wrapper = open()
  await pick(wrapper, '发布模型')
  expect(wrapper.emitted('publish')).toEqual([[RUN]])
  expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  await pick(wrapper, '删除记录')
  expect(wrapper.emitted('remove')).toEqual([[RUN]])
  expect(wrapper.find('[role="menu"]').exists()).toBe(false)
})
it.each(['pending', 'running', 'cancelling'] as const)(
  '在途%s仅提供查看结果，不出现无可用项的菜单',
  async (status) => {
    const target = { ...RUN, status }
    const wrapper = open(target)
    expect(wrapper.find('button[aria-label="训练记录更多操作"]').exists()).toBe(
      false,
    )
    await wrapper.get('button[aria-label="查看训练结果"]').trigger('click')
    expect(wrapper.emitted('detail')).toEqual([[target]])
  },
)
it.each([
  ['业务忙碌', false, 'not_requested'],
  ['正在发布', true, 'pending'],
] as const)(
  '%s时保留菜单禁用项，查看结果仍可用',
  async (_name, canPublish, publicationStatus) => {
    const target = { ...RUN, publication_status: publicationStatus }
    const wrapper = open(target, canPublish)
    await openMenu(wrapper)
    const items = wrapper.findAll('[role="menuitem"]')
    expect(items).toHaveLength(2)
    expect(
      items.every((item) => item.attributes('disabled') !== undefined),
    ).toBe(true)
    for (const item of items) await item.trigger('click')
    expect(wrapper.emitted('publish')).toBeUndefined()
    expect(wrapper.emitted('remove')).toBeUndefined()
    const detail = wrapper.get('button[aria-label="查看训练结果"]')
    expect(detail.attributes('disabled')).toBeUndefined()
    await detail.trigger('click')
    expect(wrapper.emitted('detail')).toEqual([[target]])
  },
)
it('发布权限不隐含删除权限', async () => {
  vi.mocked(useAuthStore().can).mockImplementation((codes) =>
    codes.includes(PERMISSION_CODES.modelingPublish),
  )
  const wrapper = open()
  await openMenu(wrapper)
  expect(
    wrapper.findAll('[role="menuitem"]').map((item) => item.text()),
  ).toEqual(['发布模型'])
})
it.each(['succeeded', 'failed', 'cancelled'] as const)(
  '管理权限可删除终态%s，但不隐含发布权限',
  async (status) => {
    vi.mocked(useAuthStore().can).mockImplementation((codes) =>
      codes.includes(PERMISSION_CODES.modelingManage),
    )
    const target = { ...RUN, status }
    const wrapper = open(target)
    await openMenu(wrapper)
    expect(
      wrapper.findAll('[role="menuitem"]').map((item) => item.text()),
    ).toEqual(['删除记录'])
  },
)
it('只读账号也能从训练记录直接查看结果，菜单不出现', async () => {
  vi.mocked(useAuthStore().can).mockReturnValue(false)
  const wrapper = open(RUN, false)
  expect(wrapper.find('button[aria-label="训练记录更多操作"]').exists()).toBe(
    false,
  )
  await wrapper.get('button[aria-label="查看训练结果"]').trigger('click')
  expect(wrapper.emitted('detail')).toEqual([[RUN]])
})
it('更多图标保留中文提示和菜单ARIA关联', async () => {
  const wrapper = open()
  const trigger = wrapper.get('button[aria-label="训练记录更多操作"]')
  expect(trigger.attributes('aria-expanded')).toBe('false')
  expect(trigger.attributes('aria-haspopup')).toBe('menu')
  const tip = wrapper.getComponent(DtTooltip)
  await tip.trigger('mouseenter')
  const tooltip = document.querySelector('[role="tooltip"]')
  expect(tooltip?.textContent).toBe('训练记录更多操作')
  expect(trigger.attributes('aria-describedby')).toBe(tooltip?.id)
  await openMenu(wrapper)
  expect(trigger.attributes('aria-expanded')).toBe('true')
  expect(wrapper.get('[role="dialog"]').attributes('id')).toBe(
    trigger.attributes('aria-controls'),
  )
})

it.each(['failed', 'cancelled'] as const)(
  '只有发布权限的%s记录没有可用菜单项',
  (status) => {
    vi.mocked(useAuthStore().can).mockImplementation((codes) =>
      codes.includes(PERMISSION_CODES.modelingPublish),
    )
    const wrapper = open({ ...RUN, status })
    expect(wrapper.find('button[aria-label="训练记录更多操作"]').exists()).toBe(
      false,
    )
    expect(wrapper.find('button[aria-label="查看训练结果"]').exists()).toBe(
      true,
    )
  },
)
