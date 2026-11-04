/** @fileoverview 建模批量工具条的可访问反馈、停止边界和长名单结果。 */
import { mount } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import ModelingBatchBar from '@/pages/Modeling/components/ModelingBatchBar.vue'
import type { ModelingBatchState } from '@/pages/Modeling/scripts/modelingBatch'

const wrappers: { unmount: () => void }[] = []
function state(
  overrides: Partial<ModelingBatchState> = {},
): ModelingBatchState {
  return {
    label: '',
    isBusy: false,
    completed: 0,
    total: 0,
    outcomes: [],
    ...overrides,
  }
}
function render(
  props: {
    selectedCount?: number
    state?: ModelingBatchState
    scopeLabel?: string
  } = {},
  slot = '',
) {
  const wrapper = mount(ModelingBatchBar, {
    props: { selectedCount: 0, state: state(), ...props },
    slots: slot ? { default: slot } : {},
  })
  wrappers.push(wrapper)
  return wrapper
}
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
})

it('无选择和结果时隐藏，不显示伪进度', () => {
  const wrapper = render()
  expect(wrapper.find('section').exists()).toBe(false)
  expect(wrapper.find('[role="status"]').exists()).toBe(false)
})

it('选中项显示范围提示和业务操作插槽，未开始时没有进度', () => {
  const wrapper = render(
    { selectedCount: 3 },
    '<button>批量设置定时训练</button>',
  )
  expect(wrapper.get('section').attributes('aria-label')).toBe('批量操作')
  expect(wrapper.get('section').attributes('aria-busy')).toBe('false')
  expect(wrapper.text()).toContain('已选择 3 项')
  expect(wrapper.text()).toContain('仅对当前页选中项执行')
  expect(wrapper.text()).toContain('批量设置定时训练')
  expect(wrapper.find('[role="status"]').exists()).toBe(false)
})

it('自定义选择范围明确说明实际作用集合', () => {
  const wrapper = render({
    selectedCount: 2,
    scopeLabel: '仅对当前筛选出的工作流执行',
  })
  expect(wrapper.text()).toContain('仅对当前筛选出的工作流执行')
  expect(wrapper.text()).not.toContain('仅对当前页选中项执行')
})

it('执行时提供读屏进度，停止只发出后续停止事件且不能清除状态', async () => {
  const running = state({
    label: '批量删除',
    isBusy: true,
    completed: 1,
    total: 3,
    outcomes: [{ id: 'a', label: '甲', status: 'succeeded', message: '成功' }],
  })
  const wrapper = render({
    selectedCount: 2,
    state: running,
  })
  expect(wrapper.get('section').attributes('aria-busy')).toBe('true')
  const progress = wrapper.get('p[aria-live="polite"]')
  expect(progress.attributes('role')).toBe('status')
  expect(progress.text()).toContain('1/3 项已处理')
  expect(progress.text()).toContain('成功 1 项')
  const stop = wrapper
    .findAll('button')
    .find((button) => button.text() === '停止后续操作')
  const clear = wrapper
    .findAll('button')
    .find((button) => button.text() === '清除选择与结果')
  if (!stop || !clear) throw new Error('缺少批量控制按钮')
  expect(stop.element.type).toBe('button')
  await stop.trigger('click')
  expect(wrapper.emitted('stop')).toEqual([[]])
  expect(running.completed).toBe(1)
  expect(clear.element.disabled).toBe(true)
  await clear.trigger('click')
  expect(wrapper.emitted('clear')).toBeUndefined()
})

it('执行完成且选择已移除仍显示结果，清除交给调用方处理', async () => {
  const wrapper = render({
    state: state({
      label: '删除',
      completed: 1,
      total: 1,
      outcomes: [
        { id: 'a', label: '甲', status: 'succeeded', message: '成功' },
      ],
    }),
  })
  expect(wrapper.find('section').exists()).toBe(true)
  expect(wrapper.find('[aria-label="批量操作结果"]').exists()).toBe(false)
  expect(
    wrapper
      .findAll('button')
      .some((button) => button.text() === '停止后续操作'),
  ).toBe(false)
  await wrapper.get('button').trigger('click')
  expect(wrapper.emitted('clear')).toEqual([[]])
  expect(wrapper.find('section').exists()).toBe(true)
  await wrapper.setProps({ state: state() })
  expect(wrapper.find('section').exists()).toBe(false)
})

it('未知结果明确说明停止剩余项、先核查状态和不自动重试', () => {
  const wrapper = render({
    selectedCount: 3,
    state: state({
      completed: 3,
      total: 3,
      outcomes: [
        {
          id: 'a',
          label: '工作流甲',
          status: 'unknown',
          message: '响应未确认',
        },
        { id: 'b', label: '工作流乙', status: 'failed', message: '仍被引用' },
        {
          id: 'c',
          label: '工作流丙',
          status: 'skipped',
          message: '此项未提交',
        },
      ],
    }),
  })
  const warning = wrapper.get('.dt-notice')
  expect(warning.attributes('role')).toBe('status')
  expect(warning.text()).toContain('有操作结果待核查')
  expect(warning.text()).toContain('已停止提交剩余项')
  expect(warning.text()).toContain('请先检查实际状态')
  expect(warning.text()).toContain('系统不会自动重试')
  expect(wrapper.get('[aria-label="批量操作结果"]').text()).toContain(
    '结果待核查：响应未确认',
  )
  expect(wrapper.text()).toContain('失败：仍被引用')
  expect(wrapper.text()).toContain('未执行：此项未提交')
})

it('长名单保留全部失败原因并提供有界滚动区域，标签和消息只按文本渲染', () => {
  const outcomes = Array.from({ length: 120 }, (_, index) => ({
    id: `id-${index}`,
    label: `工作流${index}😀${'长名称'.repeat(40)}`,
    status: 'failed' as const,
    message: '<img src=x onerror=alert(1)> 无法删除',
  }))
  const wrapper = render({
    state: state({ total: 120, completed: 120, outcomes }),
  })
  const list = wrapper.get('[aria-label="批量操作结果"]')
  expect(list.classes()).toEqual(
    expect.arrayContaining(['max-h-44', 'overflow-y-auto']),
  )
  expect(list.findAll('li')).toHaveLength(120)
  expect(list.findAll('li')[119]?.text()).toContain('工作流119😀')
  expect(list.text()).toContain('<img src=x onerror=alert(1)>')
  expect(wrapper.find('img').exists()).toBe(false)
})

it('scope已切换但旧写入待核查时仍显示提示，不编造新scope进度', () => {
  const wrapper = render({
    state: state({
      outcomes: [
        {
          id: 'old',
          label: '上一页工作流',
          status: 'unknown',
          message: '写入响应未确认',
        },
      ],
    }),
  })
  expect(wrapper.get('section').text()).toContain('有操作结果待核查')
  expect(wrapper.get('[aria-label="批量操作结果"]').text()).toContain(
    '上一页工作流',
  )
  expect(wrapper.find('p[aria-live="polite"]').exists()).toBe(false)
})

it('结果先显示汇总且明细默认折叠，避免长名单挤占模型列表', () => {
  const wrapper = render({
    state: state({
      label: '批量删除',
      completed: 3,
      total: 3,
      outcomes: [
        { id: 'a', label: '甲', status: 'succeeded', message: '成功' },
        { id: 'b', label: '乙', status: 'failed', message: '仍被引用' },
        { id: 'c', label: '丙', status: 'skipped', message: '正在训练' },
      ],
    }),
  })
  expect(wrapper.get('p[role="status"]').text()).toContain('失败 1 项')
  expect(wrapper.get('p[role="status"]').text()).toContain('未执行 1 项')
  expect(wrapper.get('summary').text()).toContain('2 项')
  expect(wrapper.get('details').attributes('open')).toBeUndefined()
  expect(wrapper.get('[aria-label="批量操作结果"]').findAll('li')).toHaveLength(
    2,
  )
})
