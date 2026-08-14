/**
 * @fileoverview 契约：导入弹窗的两种落地方式——新建时抛新名字、覆盖时抛目标屏
 * id，且覆盖那一档必须把「就地换配置、不可撤销」写在界面上。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DashboardExportPayload } from '@dt/contracts'

import ImportDashboardDialog from '@/pages/Home/components/ImportDashboardDialog.vue'

const PACKAGE: DashboardExportPayload = {
  schemaVersion: 1,
  name: '光伏总览',
  description: null,
  designWidth: 2560,
  designHeight: 1440,
  themeJson: {},
  chromeJson: {},
  nodes: [],
}

function mountDialog(overrides: { conflict?: boolean } = {}) {
  return mount(ImportDashboardDialog, {
    props: {
      open: false,
      payload: PACKAGE,
      projectName: 'A 园区',
      conflict: overrides.conflict ?? false,
      loading: false,
      targets: [
        { id: 'd1', name: '总览' },
        { id: 'd2', name: '能耗' },
      ],
    },
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

describe('包的概览', () => {
  it('把包名、设计尺寸、节点数与目标项目都摆出来', async () => {
    const wrapper = mountDialog()

    await wrapper.setProps({ open: true })

    expect(wrapper.text()).toContain('光伏总览')
    expect(wrapper.text()).toContain('2560 × 1440')
    expect(wrapper.text()).toContain('0 个节点')
    expect(wrapper.text()).toContain('A 园区')
  })
})

describe('新建一张', () => {
  it('没同名时用包里的原名', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true })

    expect(wrapper.find('input').element.value).toBe('光伏总览')
  })

  it('有同名时自动加「副本」并说清为什么', async () => {
    const wrapper = mountDialog({ conflict: true })
    await wrapper.setProps({ open: true })

    expect(wrapper.find('input').element.value).toBe('光伏总览 副本')
    expect(wrapper.text()).toContain('已经有同名大屏')
  })

  it('提交时抛新名字、目标屏为 null', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true })
    await wrapper.find('input').setValue('  改个名  ')

    await clickText(wrapper, '导入')

    expect(wrapper.emitted('submit')).toEqual([
      [{ newName: '改个名', targetDashboardId: null }],
    ])
  })
})

describe('覆盖已有大屏', () => {
  it('切到覆盖档时说清就地换配置且不可撤销', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true })

    await clickText(wrapper, '覆盖已有大屏')

    expect(wrapper.text()).toContain('整体换成包里的内容')
    expect(wrapper.text()).toContain('不可撤销')
  })

  it('提交时抛目标屏 id，新名字留空', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true })
    await clickText(wrapper, '覆盖已有大屏')

    await clickText(wrapper, '覆盖导入')

    expect(wrapper.emitted('submit')).toEqual([
      [{ newName: '', targetDashboardId: 'd1' }],
    ])
  })

  it('项目里一张屏都没有时提示改用新建，且提交不出去', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true, targets: [] })
    await clickText(wrapper, '覆盖已有大屏')

    expect(wrapper.text()).toContain('还没有可覆盖的大屏')

    await clickText(wrapper, '覆盖导入')
    expect(wrapper.emitted('submit')).toBeUndefined()
  })
})

describe('关闭', () => {
  it('点取消抛 update:open(false)', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true })

    await clickText(wrapper, '取消')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
