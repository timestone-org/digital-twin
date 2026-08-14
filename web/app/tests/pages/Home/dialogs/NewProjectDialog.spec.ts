/**
 * @fileoverview 契约：新建项目弹窗的 props 进得去、`submit` 与 `update:open`
 * 出得来（这两处写错名字 typecheck 与 lint 都放行），且每次打开都重置表单。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import NewProjectDialog from '@/pages/Home/components/NewProjectDialog.vue'

function mountDialog(open: boolean) {
  return mount(NewProjectDialog, {
    props: { open, loading: false },
    global: { stubs: { Teleport: true } },
  })
}

function clickButton(
  wrapper: ReturnType<typeof mountDialog>,
  label: string,
): void {
  const hit = wrapper
    .findAll('button')
    .find((button) => button.text().includes(label))
  expect(hit, `没有文案含「${label}」的按钮`).toBeDefined()
  void hit?.trigger('click')
}

describe('渲染与关闭', () => {
  it('关着时不渲染弹窗内容', () => {
    expect(mountDialog(false).text()).not.toContain('新建项目')
  })

  it('打开时渲染标题与两个字段', () => {
    const wrapper = mountDialog(true)

    expect(wrapper.text()).toContain('新建项目')
    expect(wrapper.text()).toContain('项目名称')
    expect(wrapper.text()).toContain('描述')
  })

  it('点取消抛 update:open(false)', () => {
    const wrapper = mountDialog(true)

    clickButton(wrapper, '取消')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})

describe('提交', () => {
  it('名字与描述都去掉首尾空白再抛出去', async () => {
    const wrapper = mountDialog(true)
    await wrapper.find('input').setValue('  园区能源  ')
    await wrapper.find('textarea').setValue('  说明  ')

    clickButton(wrapper, '创建项目')

    expect(wrapper.emitted('submit')).toEqual([
      [{ name: '园区能源', description: '说明' }],
    ])
  })

  it('名字为空时提交按钮禁用，点不出 submit', async () => {
    const wrapper = mountDialog(true)
    await wrapper.find('input').setValue('   ')

    clickButton(wrapper, '创建项目')

    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('再次打开时清空上一次的输入，不把「再建一个」变成「改上一个」', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({ open: true })
    await wrapper.find('input').setValue('第一个')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(wrapper.find('input').element.value).toBe('')
  })
})
