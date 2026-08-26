/**
 * @fileoverview 契约：顶栏的五个动作各抛各的事件，撤销 / 重做 / 保存按可用性禁用。
 * ⚠ 诊断计数必须写在按钮上：面板默认收着，不给数字就没人知道它有内容。
 * ⚠ 图标名没登记时 DtIcon 静默不画，typecheck 与 lint 双双放行，只能在这里兜。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Twin2dToolbar from '@/pages/Twin2dEditor/components/Twin2dToolbar.vue'

interface ToolbarProps {
  isDirty: boolean
  isSaving: boolean
  canUndo: boolean
  canRedo: boolean
  issueCount: number
}

function mountToolbar(over: Partial<ToolbarProps> = {}) {
  return mount(Twin2dToolbar, {
    props: {
      isDirty: false,
      isSaving: false,
      canUndo: false,
      canRedo: false,
      issueCount: 0,
      ...over,
    },
  })
}

describe('撤销重做', () => {
  // ⚠ 返回入口由 AppShell 出，工具栏不自带一个——同一行上两个「返回」，
  // 点哪个都对但用户得先分辨一次
  it('工具栏里没有返回键', () => {
    expect(mountToolbar().find('[data-test="back"]').exists()).toBe(false)
  })

  it('没得撤销时撤销键禁用，点不出事件', async () => {
    const wrapper = mountToolbar()

    expect(
      wrapper.find('[data-test="undo"]').attributes('disabled'),
    ).toBeDefined()
    await wrapper.find('[data-test="undo"]').trigger('click')

    expect(wrapper.emitted('undo')).toBeUndefined()
  })

  it('可以撤销时点了抛 undo', async () => {
    const wrapper = mountToolbar({ canUndo: true })

    await wrapper.find('[data-test="undo"]').trigger('click')

    expect(wrapper.emitted('undo')).toHaveLength(1)
  })

  it('没得重做时重做键禁用', () => {
    expect(
      mountToolbar().find('[data-test="redo"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('可以重做时点了抛 redo', async () => {
    const wrapper = mountToolbar({ canRedo: true })

    await wrapper.find('[data-test="redo"]').trigger('click')

    expect(wrapper.emitted('redo')).toHaveLength(1)
  })

  it('撤销与重做键都带 aria-label', () => {
    const wrapper = mountToolbar()

    expect(wrapper.find('[data-test="undo"]').attributes('aria-label')).toBe(
      '撤销',
    )
    expect(wrapper.find('[data-test="redo"]').attributes('aria-label')).toBe(
      '重做',
    )
  })

  it('每个键都真的画出了图标', () => {
    const wrapper = mountToolbar({ issueCount: 2 })

    for (const key of ['undo', 'redo', 'fit', 'issues', 'save']) {
      expect(
        wrapper.find(`[data-test="${key}"]`).find('.dt-icon').exists(),
      ).toBe(true)
    }
  })
})

describe('适应画布', () => {
  // ⚠ 图没了永远比图变形更难自救：取景键任何时候都得点得动
  it('文档干净时也点得动', async () => {
    const wrapper = mountToolbar()

    expect(
      wrapper.find('[data-test="fit"]').attributes('disabled'),
    ).toBeUndefined()
    await wrapper.find('[data-test="fit"]').trigger('click')

    expect(wrapper.emitted('fit')).toHaveLength(1)
  })

  it('取景键带 aria-label', () => {
    expect(
      mountToolbar().find('[data-test="fit"]').attributes('aria-label'),
    ).toBe('适应画布')
  })
})

describe('保存', () => {
  it('没有改动时保存键禁用', () => {
    expect(
      mountToolbar().find('[data-test="save"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('有改动时点了抛 save', async () => {
    const wrapper = mountToolbar({ isDirty: true })

    await wrapper.find('[data-test="save"]').trigger('click')

    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('保存中按钮点不动，避免重复提交', async () => {
    const wrapper = mountToolbar({ isDirty: true, isSaving: true })

    await wrapper.find('[data-test="save"]').trigger('click')

    expect(wrapper.emitted('save')).toBeUndefined()
  })

  it('脏了才挂未保存标', () => {
    expect(mountToolbar().text()).not.toContain('未保存')
    expect(mountToolbar({ isDirty: true }).text()).toContain('未保存')
  })
})

describe('诊断计数', () => {
  it('按钮上写着问题条数', () => {
    const wrapper = mountToolbar({ issueCount: 3 })

    expect(wrapper.find('[data-test="issues"]').text()).toContain('3')
    expect(wrapper.find('[data-test="issues"]').attributes('aria-label')).toBe(
      '配置问题 3 条',
    )
  })

  it('点了抛 toggleIssues', async () => {
    const wrapper = mountToolbar({ issueCount: 1 })

    await wrapper.find('[data-test="issues"]').trigger('click')

    expect(wrapper.emitted('toggleIssues')).toHaveLength(1)
  })

  it('零问题时也能点开面板看一眼', async () => {
    const wrapper = mountToolbar()

    await wrapper.find('[data-test="issues"]').trigger('click')

    expect(wrapper.emitted('toggleIssues')).toHaveLength(1)
  })
})
