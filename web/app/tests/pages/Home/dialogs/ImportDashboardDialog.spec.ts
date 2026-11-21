/**
 * @fileoverview 契约：导入弹窗的两种落地方式——新建时抛新名字、覆盖时抛目标屏
 * id，且覆盖那一档必须把「就地换配置、不可撤销」写在界面上。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { DtSelect } from '@dt/ui'
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

    expect(
      wrapper.get<HTMLInputElement>('input[type=text]').element.value,
    ).toBe('光伏总览')
  })

  it('有同名时自动加「副本」并说清为什么', async () => {
    const wrapper = mountDialog({ conflict: true })
    await wrapper.setProps({ open: true })

    expect(
      wrapper.get<HTMLInputElement>('input[type=text]').element.value,
    ).toBe('光伏总览 副本')
    expect(wrapper.text()).toContain('已经有同名大屏')
  })

  it('提交时抛新名字、目标屏为 null', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true })
    await wrapper.find('input[type=text]').setValue('  改个名  ')

    await clickText(wrapper, '导入')

    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          newName: '改个名',
          targetDashboardId: null,
          includePointBindings: false,
        },
      ],
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
      [{ newName: '', targetDashboardId: 'd1', includePointBindings: false }],
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

describe('点位绑定', () => {
  it('默认忽略，勾选后保留，重新打开恢复默认', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true })
    expect(
      wrapper.get<HTMLInputElement>('input[type=checkbox]').element.checked,
    ).toBe(false)
    await wrapper.get('input[type=checkbox]').setValue(true)
    await clickText(wrapper, '导入')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      includePointBindings: true,
    })
    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    expect(
      wrapper.get<HTMLInputElement>('input[type=checkbox]').element.checked,
    ).toBe(false)
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

describe('旧包联动', () => {
  const legacy = '0195d258-1d43-7a6c-806c-092dddc12e1e'
  const linked: DashboardExportPayload = {
    ...PACKAGE,
    chromeJson: {
      interactions: [
        {
          id: '开关',
          source: { nodeId: legacy },
          action: { type: 'show', targets: [legacy] },
        },
        {
          id: '详情',
          source: { nodeId: 'label' },
          action: { type: 'openModal', target: legacy },
        },
      ],
    },
    nodes: [
      {
        clientKey: 'label',
        parentClientKey: null,
        moduleType: 'text',
        configJson: { __label: '运行状态' },
        bindings: [],
        x: 0,
        y: 0,
        w: 20,
        h: 20,
        zIndex: 0,
        isVisible: true,
      },
    ],
  }
  it('先列受影响规则，同一旧节点只选一次，确认前新建与覆盖都不能提交', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true, payload: linked })
    await clickText(wrapper, '导入')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.text()).toContain('开关')
    expect(wrapper.get('[role=combobox]').text()).toContain('选择包内节点')
    expect(wrapper.text()).toContain('详情')
    await clickText(wrapper, '覆盖已有大屏')
    await clickText(wrapper, '覆盖导入')
    expect(wrapper.emitted('submit')).toBeUndefined()
    const select = wrapper
      .findAllComponents(DtSelect)
      .find((item) => item.props('label') === '对应的包内节点')
    expect(select).toBeDefined()
    select?.vm.$emit('update:modelValue', 'label')
    await wrapper.vm.$nextTick()
    await clickText(wrapper, '覆盖导入')
    expect(wrapper.emitted('submit')?.[0]?.[0]).toMatchObject({
      interactionNodeMap: { [legacy]: 'label' },
      targetDashboardId: 'd1',
    })
  })
  it('更换文件与关闭会清掉同一旧引用的先前选择，取消不会提交', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true, payload: linked })
    const select = wrapper
      .findAllComponents(DtSelect)
      .find((item) => item.props('label') === '对应的包内节点')
    select?.vm.$emit('update:modelValue', 'label')
    await clickText(wrapper, '更换文件')
    expect(wrapper.emitted('choose-file')).toHaveLength(1)
    await wrapper.setProps({ payload: { ...linked, name: '另一份' } })
    await clickText(wrapper, '导入')
    expect(wrapper.emitted('submit')).toBeUndefined()
    await clickText(wrapper, '取消')
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
