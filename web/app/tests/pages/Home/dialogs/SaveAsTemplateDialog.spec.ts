/**
 * @fileoverview 契约：另存为模板弹窗按源屏预填名称与描述，`submit` 抛出的
 * 三项都去掉首尾空白，名字空着时点不动。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import type { DashboardSummary } from '@/api/dashboardWire'
import SaveAsTemplateDialog from '@/pages/Home/components/SaveAsTemplateDialog.vue'

const SOURCE: DashboardSummary = {
  id: 'd1',
  projectId: 'p1',
  name: '光伏总览',
  description: '园区光伏',
  designWidth: 1920,
  designHeight: 1080,
  rowVersion: 2,
  schemaVersion: 1,
  isPublic: false,
  nodeCount: 12,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
}

function mountDialog(open: boolean) {
  return mount(SaveAsTemplateDialog, {
    props: { open, dashboard: SOURCE, loading: false },
    global: { stubs: { Teleport: true } },
  })
}

async function clickText(
  wrapper: ReturnType<typeof mountDialog>,
  label: string,
): Promise<void> {
  const hit = wrapper
    .findAll('button')
    .find((button) => button.text().includes(label))
  expect(hit, `没有文案含「${label}」的按钮`).toBeDefined()
  await hit?.trigger('click')
}

describe('预填', () => {
  it('打开时按源屏预填模板名与描述', async () => {
    const wrapper = mountDialog(false)

    await wrapper.setProps({ open: true })

    expect(wrapper.findAll('input')[0]?.element.value).toBe('光伏总览 模板')
    expect(wrapper.find('textarea').element.value).toBe('园区光伏')
    expect(wrapper.text()).toContain('源屏：光伏总览')
  })

  it('说清模板存的是这一刻的整包，源屏改版不回溯', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({ open: true })

    expect(wrapper.text()).toContain('源屏之后改版不会回溯')
  })
})

describe('提交', () => {
  it('三项都去掉首尾空白再抛出去', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({ open: true })
    await wrapper.findAll('input')[0]?.setValue('  模板甲  ')
    await wrapper.findAll('input')[1]?.setValue('  能源  ')
    await wrapper.find('textarea').setValue('  用途  ')

    await clickText(wrapper, '保存模板')

    expect(wrapper.emitted('submit')).toEqual([
      [{ name: '模板甲', category: '能源', description: '用途' }],
    ])
  })

  it('名字空着时点不出 submit', async () => {
    const wrapper = mountDialog(false)
    await wrapper.setProps({ open: true })
    await wrapper.findAll('input')[0]?.setValue('  ')

    await clickText(wrapper, '保存模板')

    expect(wrapper.emitted('submit')).toBeUndefined()
  })

  it('点取消抛 update:open(false)', async () => {
    const wrapper = mountDialog(true)

    await clickText(wrapper, '取消')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
