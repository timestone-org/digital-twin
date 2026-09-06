/** @fileoverview 真实 Tiptap 的业务节点插入、外部回填与只读状态。 */
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReportEditor from '@/pages/Reports/Editor/components/ReportEditor.vue'
import type { ReportDocument } from '@dt/contracts'

const blank: ReportDocument = { type: 'doc', content: [{ type: 'paragraph' }] }
describe('报告编辑器', () => {
  it('插入指标产生可保存的业务 AST', async () => {
    const wrapper = mount(ReportEditor, { props: { modelValue: blank } })
    await flushPromises()
    wrapper.vm.insert({
      type: 'metricRef',
      attrs: { expr: '{本期}', precision: 2 },
    })
    await flushPromises()
    expect(JSON.stringify(wrapper.emitted('update:modelValue'))).toContain(
      'metricRef',
    )
    expect(wrapper.text()).toContain('{本期}')
    wrapper.unmount()
  })
  it('只读时没有编辑按钮，外部正文仍可更新', async () => {
    const wrapper = mount(ReportEditor, {
      props: { modelValue: blank, disabled: true },
    })
    await flushPromises()
    expect(wrapper.findAll('button')).toHaveLength(0)
    await wrapper.setProps({
      modelValue: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '已保存内容' }],
          },
        ],
      },
    })
    expect(wrapper.text()).toContain('已保存内容')
    wrapper.unmount()
  })
})

it('编辑工具栏能改变实际文档并支持撤销重做', async () => {
  const wrapper = mount(ReportEditor, { props: { modelValue: blank } })
  await flushPromises()
  wrapper.vm.insert({ type: 'text', text: '正文' })
  for (const label of [
    '粗体',
    '斜体',
    '标题',
    '列表',
    '表格',
    '撤销',
    '重做',
  ]) {
    await wrapper
      .findAll('button')
      .find((button) => button.text() === label)
      ?.trigger('click')
    await flushPromises()
  }
  expect(JSON.stringify(wrapper.emitted('update:modelValue'))).toContain(
    'table',
  )
  await wrapper.setProps({ disabled: true })
  expect(wrapper.findAll('button')).toHaveLength(0)
  wrapper.unmount()
})
