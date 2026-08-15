/**
 * @fileoverview 契约：顶栏的六个动作各抛各的事件，撤销 / 重做 / 保存按可用性禁用。
 * ⚠ 诊断计数必须写在按钮上：面板默认收着，不给数字就没人知道它有内容。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TwinEditorToolbar from '@/pages/TwinEditor/components/TwinEditorToolbar.vue'

interface ToolbarProps {
  isDirty: boolean
  isSaving: boolean
  canUndo: boolean
  canRedo: boolean
  issueCount: number
  backLabel: string
}

function mountToolbar(over: Partial<ToolbarProps> = {}) {
  return mount(TwinEditorToolbar, {
    props: {
      isDirty: false,
      isSaving: false,
      canUndo: false,
      canRedo: false,
      issueCount: 0,
      backLabel: '返回大屏',
      ...over,
    },
  })
}

describe('返回与撤销重做', () => {
  it('返回键显示传进来的文案，点了抛 back', async () => {
    const wrapper = mountToolbar()

    expect(wrapper.find('[data-test="back"]').text()).toContain('返回大屏')
    await wrapper.find('[data-test="back"]').trigger('click')

    expect(wrapper.emitted('back')).toHaveLength(1)
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

  it('可以重做时点了抛 redo', async () => {
    const wrapper = mountToolbar({ canRedo: true })

    await wrapper.find('[data-test="redo"]').trigger('click')

    expect(wrapper.emitted('redo')).toHaveLength(1)
  })

  // ⚠ 没登记的图标名不报错、只是什么都不画，只能靠这一条兜
  it('每个键都真的画出了图标', () => {
    const wrapper = mountToolbar({ issueCount: 2 })
    const keys = ['back', 'undo', 'redo', 'issues', 'save']

    for (const key of keys) {
      expect(
        wrapper.find(`[data-test="${key}"]`).find('.dt-icon').exists(),
      ).toBe(true)
    }
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
